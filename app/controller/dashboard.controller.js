import { normalizeEmail, sameDashboardPayload } from '../utils/common.utils.js';
import mongoose from 'mongoose';

import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import emailHtml from '../template/email-body.utils.js';
import dashboardServices from '../services/dashboard.services.js';
import authServices from '../services/auth.services.js';

// Dashboard handlers - create, get, share, versioning, sync
async function handleGetDashboards(req, res, next) {
  try {
    const myId = String(req.user.id);
    const data = await dashboardServices.findDashboardsLean(
      {
        $or: [{ userId: req.user.id }, { 'sharedWith.userId': req.user.id }],
      },
      { updatedAt: -1 }
    );

    // Attach the role the current user has for each dashboard
    const withRole = (data || []).map(d => {
      if (String(d.userId) === myId) {
        return { ...d, effectiveRole: 'Editor' };
      }
      const entry = (d.sharedWith || []).find(x => String(x.userId) === myId);
      return { ...d, effectiveRole: entry?.role || null };
    });

    return res.status(HTTP_STATUS.OK).json(withRole);
  } catch (error) {
    next(error);
  }
}

// Helper to find a dashboard by ID and check if the user has access (owner or shared).
async function findDashboardWithAccess(id, userId) {
  const myId = String(userId);
  const dashboard = await dashboardServices.findDashboardByIdLean(id);

  if (!dashboard) return null;

  if (String(dashboard.userId) === myId) return dashboard;

  const sw = dashboard.sharedWith || [];
  if (sw.some(x => String(x.userId) === myId)) return dashboard;

  const ownerId = dashboard.userId;
  const lk = dashboard.lineageId || dashboard._id;

  const sibling = await dashboardServices.findSharedDashboard({
    ownerId,
    lk,
    userId,
  });

  if (sibling) return dashboard;

  return null;
}

// Get a single dashboard by ID, including the effective role of the current user (owner/editor/viewer).
async function handleGetDashboardById(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_DASHBOARD_ID });
    }
    const myId = String(req.user.id);

    const dashboard = await findDashboardWithAccess(id, req.user.id);
    if (!dashboard) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.DASHBOARD_NOT_FOUND });
    }

    let effectiveRole = null;
    if (String(dashboard.userId) === myId) effectiveRole = 'Editor';
    else {
      const entry = (dashboard.sharedWith || []).find(x => String(x.userId) === myId);
      effectiveRole = entry?.role || null;
    }

    let pendingCollaboratorSync = false;
    if (String(dashboard.userId) === myId) {
      const ol = dashboard.lineageId || dashboard._id;
      const ownerLatest = await dashboardServices.findDashboardByIdAndSort(
        {
          userId: dashboard.userId,
          $or: [{ lineageId: ol }, { _id: ol }],
        },
        { versionNumber: -1, updatedAt: -1 }
      );
      if (ownerLatest) {
        const latestFork = await dashboardServices.findDashboardByIdAndSort(
          {
            ownerLineageId: ol,
            userId: { $ne: dashboard.userId },
          },
          { updatedAt: -1 }
        );
        if (latestFork) {
          pendingCollaboratorSync = !sameDashboardPayload(ownerLatest, latestFork);
        }
      }
    }

    return res.status(HTTP_STATUS.OK).json({
      ...dashboard,
      effectiveRole,
      pendingCollaboratorSync,
    });
  } catch (error) {
    next(error);
  }
}

// Share a dashboard by email or user ID, with specified roles (Viewer/Editor)
async function handleShareDashboard(req, res, next) {
  try {
    const { id } = req.params;
    const myId = String(req.user.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_DASHBOARD_ID });
    }

    const { shares } = req.body || {};
    if (!Array.isArray(shares) || shares.length === 0) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.SHARES_MUST_BE_A_NON_EMPTY_ARRAY });
    }

    const dashboard = await dashboardServices.findDashboardByIdLean(id);
    if (!dashboard)
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.DASHBOARD_NOT_FOUND });

    // Owner is treated as Editor for permissions
    const isOwner = String(dashboard.userId) === myId;
    const myEntry = (dashboard.sharedWith || []).find(x => String(x.userId) === myId);
    const effectiveRole = isOwner ? 'Editor' : myEntry?.role || null;
    if (effectiveRole !== 'Editor') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: constants.ONLY_EDITORS_CAN_SHARE });
    }

    const allowedRoles = new Set(['Viewer', 'Editor']);
    const nextShared = Array.isArray(dashboard.sharedWith) ? [...dashboard.sharedWith] : [];

    const mapByUserId = new Map(
      nextShared.map(x => [String(x.userId), { userId: x.userId, role: x.role }])
    );
    const updatedUserIds = new Set();
    for (const s of shares) {
      const role = s?.role;
      const email = normalizeEmail(s?.email);
      const userId = s?.userId !== null ? String(s.userId) : undefined;

      if (!allowedRoles.has(role)) continue;

      let targetUserId = userId;

      if (!targetUserId && email) {
        const u = await authServices.findOneAuthUserByEmail(email);
        if (!u) continue;
        targetUserId = String(u._id);
      }

      if (!targetUserId) continue;
      if (targetUserId === myId) continue;

      mapByUserId.set(targetUserId, { userId: targetUserId, role });

      // ✅ Track only current request users
      updatedUserIds.add(targetUserId);
    }

    const sharedPayload = [...mapByUserId.values()].map(x => ({
      userId: x.userId,
      role: x.role,
    }));
    dashboard.sharedWith = sharedPayload;

    const lineage = dashboard.lineageId || dashboard._id;
    // Propagate shares to every version in this lineage for the owner.
    // (Filter must use lineageId / _id — not a bogus "lineage" field — or updateMany matches 0 docs.)
    await dashboardServices.updateManyDashboards(
      {
        userId: dashboard.userId,
        $or: [{ lineageId: lineage }, { _id: lineage }],
      },
      { $set: { sharedWith: sharedPayload } }
    );

    // Best-effort email notifications (share already persisted above)
    const fromAddr = normalizeEmail(process.env.EMAIL_FROM);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const mailEnabled = Boolean(fromAddr && smtpUser && smtpPass);

    if (mailEnabled) {
      const nodemailer = await import('nodemailer').catch(e => {
        console.error('[share] nodemailer import failed:', e?.message || e);
        return null;
      });
      const nm = nodemailer?.default;
      if (!nm) {
        console.warn('[share] Install nodemailer: npm i nodemailer (in backend)');
      } else {
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

        let webBaseUrl = '';
        try {
          const origin = req.headers?.origin ? String(req.headers.origin) : '';
          const referer = req.headers?.referer ? String(req.headers.referer) : '';
          webBaseUrl = origin ? new URL(origin).origin : referer ? new URL(referer).origin : '';
        } catch {
          /* ignore */
        }
        webBaseUrl = webBaseUrl || String(process.env.FRONTEND_BASE_URL).replace(/\/$/, '');
        const dashboardLink = `${webBaseUrl}/dashboard/${id}`;

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
          // Google Workspace / Gmail app passwords: explicit SMTP when not using @gmail.com
          transporter = nm.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false,
            requireTLS: true,
            auth: { user: smtpUser, pass: smtpPass },
          });
        }

        const recipients = [...updatedUserIds].filter(userId => userId && userId !== myId);

        const recipientUsers = await authServices.findAuthUsersByIds(recipients, '_id email');
        for (const u of recipientUsers || []) {
          const sharedEntry = mapByUserId.get(String(u._id));
          const role = sharedEntry?.role || 'Viewer';
          const dashboardName = dashboard.name || constants.SHARE_DASHBOARD_FALLBACK_NAME;
          try {
            const subject = constants.SHARE_DASHBOARD_EMAIL_SUBJECT;
            const safeName = escapeHtml(dashboardName);
            const safeRole = escapeHtml(role);
            const text = `You have been granted access to "${dashboardName}" as ${role}.\n\nOpen the dashboard: ${dashboardLink}`;

            const info = await transporter.sendMail({
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
    } else {
      console.log(
        '[share] Mail skipped: set EMAIL_FROM, SMTP_USER, SMTP_PASS (and optionally SMTP_HOST / SMTP_PORT)'
      );
    }

    return res.status(HTTP_STATUS.OK).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
// Helper to compare the main dashboard payload (charts, layouts, logo) for sync purposes

async function handlePostDashboard(req, res, next) {
  try {
    const myId = String(req.user.id);
    const {
      name = 'My Dashboard',
      charts = [],
      layouts = {},
      logo,
      collection: collectionField,
      previousDashboardId,
    } = req.body || {};

    const baseNameInput = String(name || '').trim() || 'My Dashboard';
    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').slice(0, 19);

    let prev = null;
    if (previousDashboardId && mongoose.Types.ObjectId.isValid(String(previousDashboardId))) {
      prev = await dashboardServices.findDashboardByIdLean(previousDashboardId);
    }

    if (!prev) {
      const created = await dashboardServices.createDashboard({
        userId: req.user.id,
        name: `${baseNameInput} (v1) ${ts}`,
        baseName: baseNameInput,
        charts,
        layouts,
        ...(logo !== null && typeof logo === 'string' ? { logo } : {}),
        ...(collectionField !== null ? { collection: String(collectionField) } : {}),
        sharedWith: [],
        lineageId: null,
        ownerLineageId: null,
        versionNumber: 1,
      });
      await dashboardServices.updateDashboardById(created._id, {
        lineageId: created._id,
        ownerLineageId: created._id,
      });
      const out = await dashboardServices.findDashboardByIdLean(created._id);
      return res.status(HTTP_STATUS.CREATED).json(out);
    }

    const prevOwnerId = String(prev.userId);
    const isOwnerOfPrev = prevOwnerId === myId;
    const isSharedEditor =
      !isOwnerOfPrev &&
      (prev.sharedWith || []).some(x => String(x.userId) === myId && x.role === 'Editor');

    if (!isOwnerOfPrev && !isSharedEditor) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: constants.CANNOT_SAVE_DASHBOARD });
    }

    const prevLineage = prev.lineageId || prev._id;

    if (isOwnerOfPrev) {
      const vn = (prev.versionNumber || 1) + 1;
      const nextName = `${baseNameInput} (v${vn}) ${ts}`;
      const forkDoc =
        prev.ownerLineageId && String(prev.ownerLineageId) !== String(prev.lineageId || prev._id);
      const created = await dashboardServices.createDashboard({
        userId: req.user.id,
        name: nextName,
        baseName: baseNameInput,
        charts,
        layouts,
        ...(logo !== null && typeof logo === 'string' ? { logo } : {}),
        ...(collectionField !== null ? { collection: String(collectionField) } : {}),
        // Important: prevent "owner -> child" propagation.
        // After sharing, owner-created versions must not be visible to shared editors.
        sharedWith: [],
        lineageId: prev.lineageId || prev._id,
        ownerLineageId: forkDoc ? prev.ownerLineageId : prevLineage,
        versionNumber: vn,
      });
      return res.status(HTTP_STATUS.CREATED).json(created);
    }

    const ownerL = prevLineage;
    const existingFork = await dashboardServices.findDashboardByIdAndSort(
      {
        userId: req.user.id,
        ownerLineageId: ownerL,
      },
      { versionNumber: -1 }
    );

    if (!existingFork) {
      const created = await dashboardServices.createDashboard({
        userId: req.user.id,
        name: `${baseNameInput} (v1) ${ts}`,
        baseName: baseNameInput,
        charts,
        layouts,
        ...(logo !== null && typeof logo === 'string' ? { logo } : {}),
        ...(collectionField !== null ? { collection: String(collectionField) } : {}),
        sharedWith: [],
        lineageId: null,
        ownerLineageId: ownerL,
        versionNumber: 1,
      });
      await dashboardServices.updateDashboardById(created._id, {
        lineageId: created._id,
      });
      const out = await dashboardServices.findDashboardByIdLean(created._id);
      return res.status(HTTP_STATUS.CREATED).json(out);
    }

    const basePrev = existingFork;
    const vn = (basePrev.versionNumber || 1) + 1;
    const nextName = `${basePrev.baseName || baseNameInput} (v${vn}) ${ts}`;
    const created = await dashboardServices.createDashboard({
      userId: req.user.id,
      name: nextName,
      baseName: baseNameInput,
      charts,
      layouts,
      ...(logo !== null && typeof logo === 'string' ? { logo } : {}),
      ...(collectionField !== null ? { collection: String(collectionField) } : {}),
      sharedWith: [],
      lineageId: basePrev.lineageId || basePrev._id,
      ownerLineageId: ownerL,
      versionNumber: vn,
    });
    return res.status(HTTP_STATUS.CREATED).json(created);
  } catch (error) {
    next(error);
  }
}

// Sync changes from shared editor versions
async function handleSyncDashboard(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_DASHBOARD_ID });
    }

    const dashboard = await findDashboardWithAccess(id, req.user.id);
    if (!dashboard)
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.DASHBOARD_NOT_FOUND });
    if (String(dashboard.userId) !== String(req.user.id)) {
      return res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: constants.ONLY_OWNER_CAN_SYNC_SHARED_CHANGES });
    }

    const ol = dashboard.lineageId || dashboard._id;
    const ownerId = dashboard.userId;

    const ownerLatest = await dashboardServices.findDashboardByIdAndSort(
      {
        userId: ownerId,
        $or: [{ lineageId: ol }, { _id: ol }],
      },
      { versionNumber: -1, updatedAt: -1 }
    );

    if (!ownerLatest) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: constants.DASHBOARD_LINEAGE_NOT_FOUND });
    }

    const latestFork = await dashboardServices.findDashboardByIdAndSort(
      {
        ownerLineageId: ol,
        userId: { $ne: ownerId },
      },
      { updatedAt: -1 }
    );

    if (!latestFork) {
      return res.status(HTTP_STATUS.OK).json({
        ok: true,
        message: constants.SYNC_NO_COLLABORATOR_VERSIONS,
        dashboard: ownerLatest,
      });
    }

    if (sameDashboardPayload(ownerLatest, latestFork)) {
      return res.status(HTTP_STATUS.OK).json({
        ok: true,
        message: constants.SYNC_ALREADY_MATCHES_LATEST_COLLABORATOR,
        dashboard: ownerLatest,
      });
    }

    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').slice(0, 19);
    const vn = (ownerLatest.versionNumber || 1) + 1;
    const rawName = ownerLatest.baseName || ownerLatest.name || 'My Dashboard';
    const base = ownerLatest.baseName
      ? ownerLatest.baseName
      : String(rawName)
          .replace(/\s+\(v\d+\)\s+.+$/, '')
          .trim() || rawName;
    const nextName = `${base} (v${vn}) ${ts}`;

    const mergedPayload = await dashboardServices.buildDashboardPayload({
      ownerId,
      nextName,
      base,
      latestFork,
      ol,
      vn,
    });
    const mergedDb = await dashboardServices.createDashboard(mergedPayload);
    return res.status(HTTP_STATUS.CREATED).json({ ok: true, dashboard: mergedDb });
  } catch (error) {
    console.error('Sync error:', error);
    next(error);
  }
}

// get dashboard versions for a given dashboard ID
async function handleGetDashboardVersions(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_DASHBOARD_ID });
    }
    const dashboard = await findDashboardWithAccess(id, req.user.id);
    if (!dashboard) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.DASHBOARD_NOT_FOUND });
    }

    const ownerId = String(dashboard.userId);
    const myId = String(req.user.id);

    if (ownerId === myId) {
      const L = dashboard.lineageId || dashboard._id;
      const versions = await dashboardServices.findDashboardByIdAndSort(
        {
          userId: req.user.id,
          $or: [{ lineageId: L }, { _id: L }],
        },
        { versionNumber: -1, updatedAt: -1 }
      );
      return res.status(HTTP_STATUS.OK).json(versions);
    }

    const ownerL = dashboard.lineageId || dashboard._id;
    const versions = await dashboardServices.findDashboardByIdAndSort(
      {
        userId: req.user.id,
        ownerLineageId: ownerL,
      },
      { versionNumber: -1, updatedAt: -1 }
    );
    return res.status(HTTP_STATUS.OK).json(versions);
  } catch (error) {
    next(error);
  }
}

export {
  handleGetDashboards,
  handleGetDashboardById,
  handleGetDashboardVersions,
  handlePostDashboard,
  handleSyncDashboard,
  handleShareDashboard,
};
