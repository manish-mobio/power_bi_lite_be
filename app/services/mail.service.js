import nodemailer from 'nodemailer';

function buildTransport() {
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '').trim();
  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  const smtpService = String(process.env.SMTP_SERVICE || '').trim().toLowerCase();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = smtpPort === 465 || String(process.env.SMTP_SECURE || '') === '1';

  if (!smtpUser || !smtpPass) {
    throw new Error('SMTP credentials are missing');
  }

  if (smtpService) {
    return nodemailer.createTransport({
      service: smtpService,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  return nodemailer.createTransport({
    host: smtpHost || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
    ...(smtpPort === 587 ? { requireTLS: true } : {}),
  });
}

async function sendMail({ to, subject, text, html }) {
  const from = String(process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim();
  if (!from) {
    throw new Error('EMAIL_FROM or SMTP_USER must be configured');
  }

  const transporter = buildTransport();
  return transporter.sendMail({ from, to, subject, text, html });
}

export default {
  sendMail,
};
