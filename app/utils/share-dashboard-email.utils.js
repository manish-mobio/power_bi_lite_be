import { normalizeEmail, RESET_TOKEN_TTL_MINUTES } from './common.utils.js';
import constants from './constant.utils.js';
import emailHtml from '../template/email-body.utils.js';
import mailService from '../services/mail.service.js';

function resolveWebBaseUrl(mailContext = {}) {
  let webBaseUrl = '';
  try {
    const origin = mailContext.origin ? String(mailContext.origin) : '';
    const referer = mailContext.referer ? String(mailContext.referer) : '';
    webBaseUrl = origin ? new URL(origin).origin : referer ? new URL(referer).origin : '';
  } catch {
    /* ignore */
  }
  const envBase = process.env.FRONTEND_BASE_URL
    ? String(process.env.FRONTEND_BASE_URL).replace(/\/$/, '')
    : '';
  return webBaseUrl || envBase;
}

/**
 * Sends share notification emails (SMTP). Not a DB layer — kept out of services.
 */
async function sendDashboardShareEmails({
  dashboardId,
  dashboardName,
  mailContext,
  myId,
  mapByUserId,
  updatedUserIds,
  findRecipientUsers,
}) {
  const fromAddr = normalizeEmail(process.env.EMAIL_FROM);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const mailEnabled = Boolean(fromAddr && smtpUser && smtpPass);

  if (!mailEnabled) {
    console.log(
      '[share] Mail skipped: set EMAIL_FROM, SMTP_USER, SMTP_PASS (and optionally SMTP_HOST / SMTP_PORT)'
    );
    return;
  }

  const nodemailer = await import('nodemailer').catch(e => {
    console.error('[share] nodemailer import failed:', e?.message || e);
    return null;
  });
  const nm = nodemailer?.default;
  if (!nm) {
    console.warn('[share] Install nodemailer: npm i nodemailer (in backend)');
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465 || String(process.env.SMTP_SECURE || '') === '1';
  const host = String(process.env.SMTP_HOST || '').trim();

  const escapeHtml = str =>
    String(str ?? '').replace(/[&<>"']/g, c => {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[c] || c;
    });

  const webBaseUrl = resolveWebBaseUrl(mailContext);
  const dashboardLink = `${webBaseUrl}/dashboard/${dashboardId}`;

  let transporter;
  if (process.env.SMTP_SERVICE === 'gmail' || /@gmail\.com$/i.test(String(smtpUser))) {
    transporter = nm.createTransport({
      service: 'gmail',
      auth: { user: smtpUser, pass: smtpPass },
    });
  } else if (host) {
    transporter = nm.createTransport({
      host,
      port,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
      ...(port === 587 ? { requireTLS: true } : {}),
    });
  } else {
    transporter = nm.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  const recipients = [...updatedUserIds].filter(userId => userId && userId !== myId);

  const recipientUsers = await findRecipientUsers(recipients);

  for (const u of recipientUsers || []) {
    const sharedEntry = mapByUserId.get(String(u._id));
    const role = sharedEntry?.role || 'Viewer';
    const name = dashboardName || constants.SHARE_DASHBOARD_FALLBACK_NAME;
    try {
      const subject = constants.SHARE_DASHBOARD_EMAIL_SUBJECT;
      const safeName = escapeHtml(name);
      const safeRole = escapeHtml(role);
      const text = `You have been granted access to "${name}" as ${role}.\n\nOpen the dashboard: ${dashboardLink}`;

      await transporter.sendMail({
        from: fromAddr,
        to: u.email,
        subject,
        text,
        html: emailHtml(safeName, safeRole, dashboardLink),
      });
    } catch (mailErr) {
      console.error('[share] mail failed', {
        to: u.email,
        error: mailErr?.message || String(mailErr),
      });
    }
  }
}

async function sendResetPasswordMail(Email, resetLink) {
  const text = `Reset your password using this link: ${resetLink}. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.`;
  await mailService.sendMail({
    to: Email,
    subject: constants.RESET_PASSWORD_MAIL,
    text,
    html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>`,
  });
}
export { sendDashboardShareEmails, sendResetPasswordMail };
