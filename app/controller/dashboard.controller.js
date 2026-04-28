import { normalizeEmail, sameDashboardPayload, SHARE_ROLES } from '../utils/common.utils.js';
import mongoose from 'mongoose';

import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import emailHtml from '../template/email-body.utils.js';
import dashboardServices from '../services/dashboard.services.js';
import authServices from '../services/auth.services.js';

// Dashboard handlers - create, get, share, versioning, sync
function withSharedFlag(dashboard) {
  if (!dashboard || typeof dashboard !== 'object') return dashboard;
  return { ...dashboard, isShared: Boolean(dashboard.parent_id) };
}

async function syncSharedLayoutsToParent({ parentId, layouts, name, baseName }) {
  if (!parentId || !mongoose.Types.ObjectId.isValid(String(parentId))) return;

  const parentDashboard = await dashboardServices.findDashboardByIdLean(parentId);
  if (!parentDashboard) return;

  const ownerId = parentDashboard.userId;
  const ownerLineage = parentDashboard.lineageId || parentDashboard._id;
  const safeLayouts =
    layouts && typeof layouts === 'object' && !Array.isArray(layouts) ? layouts : {};
  const safeName = typeof name === 'string' ? name.trim() : '';
  const safeBaseName = typeof baseName === 'string' ? baseName.trim() : '';
  const setPayload = { layouts: safeLayouts };
  if (safeName) setPayload.name = safeName;
  if (safeBaseName) setPayload.baseName = safeBaseName;

  await dashboardServices.updateManyDashboards(
    {
      userId: ownerId,
      $or: [{ lineageId: ownerLineage }, { _id: ownerLineage }],
    },
    { $set: setPayload }
  );
}

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
      const enriched = withSharedFlag(d);
      if (String(d.userId) === myId) {
        return { ...enriched, effectiveRole: 'Editor' };
      }
      const entry = (d.sharedWith || []).find(x => String(x.userId) === myId);
      return { ...enriched, effectiveRole: entry?.role || null };
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

async function enrichSharedWith(sharedWith = []) {
  const normalized = (Array.isArray(sharedWith) ? sharedWith : [])
    .map(entry => {
      const userId = entry?.userId ? String(entry.userId) : '';
      if (!userId) return null;
      return {
        userId,
        role: SHARE_ROLES.has(entry?.role) ? entry.role : 'Viewer',
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) return [];

  const uniqueIds = [...new Set(normalized.map(entry => entry.userId))];
  const users = await authServices.findAuthUsersByIds(uniqueIds, '_id email name');
  const userMap = new Map((users || []).map(user => [String(user._id), user]));

  return normalized.map(entry => {
    const user = userMap.get(entry.userId);
    return {
      userId: entry.userId,
      role: entry.role,
      email: user?.email || '',
      name: user?.name || '',
    };
  });
}

async function enrichDashboardForResponse(dashboard) {
  if (!dashboard) return dashboard;
  return {
    ...withSharedFlag(dashboard),
    sharedWith: await enrichSharedWith(dashboard.sharedWith),
  };
}

function getSharePermissionContext(dashboard, userId) {
  const myId = String(userId);
  const isOwner = String(dashboard?.userId) === myId;
  const myEntry = (dashboard?.sharedWith || []).find(x => String(x.userId) === myId);
  const effectiveRole = isOwner ? 'Editor' : myEntry?.role || null;

  return {
    isOwner,
    effectiveRole,
    canManageSharing: effectiveRole === 'Editor',
  };
}

async function resolveShareUsers(shares = [], actorUserId, roleRequired = true) {
  const myId = String(actorUserId);
  const shareMap = new Map();

  for (const share of Array.isArray(shares) ? shares : []) {
    const email = normalizeEmail(share?.email);
    let targetUserId = share?.userId ? String(share.userId) : '';

    if (!targetUserId && email) {
      const user = await authServices.findOneAuthUserByEmail(email);
      if (!user?._id) continue;
      targetUserId = String(user._id);
    }

    if (!targetUserId || targetUserId === myId) continue;

    if (roleRequired) {
      if (!SHARE_ROLES.has(share?.role)) continue;
      shareMap.set(targetUserId, { userId: targetUserId, role: share.role });
    } else {
      shareMap.set(targetUserId, { userId: targetUserId });
    }
  }

  return shareMap;
}

async function resolveShareTargetsFromBody(body, actorUserId) {
  const myId = String(actorUserId);
  const targets = new Set();

  const directIds = [body?.userId, ...(Array.isArray(body?.userIds) ? body.userIds : [])]
    .filter(Boolean)
    .map(value => String(value));

  for (const userId of directIds) {
    if (userId !== myId) targets.add(userId);
  }

  const shareMap = await resolveShareUsers(body?.shares || [], actorUserId, false);
  for (const userId of shareMap.keys()) {
    if (userId !== myId) targets.add(userId);
  }

  return targets;
}

async function persistDashboardShares(dashboard, sharedPayload) {
  const lineage = dashboard.lineageId || dashboard._id;

  await dashboardServices.updateManyDashboards(
    {
      userId: dashboard.userId,
      $or: [{ lineageId: lineage }, { _id: lineage }],
    },
    { $set: { sharedWith: sharedPayload } }
  );

  return dashboardServices.findDashboardByIdLean(dashboard._id);
}

async function sendShareNotifications({
  req,
  dashboardId,
  dashboardName,
  myId,
  currentShareMap,
  nextShareMap,
  changedUserIds,
}) {
  if (!changedUserIds?.size) return;

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
    return null;
  });
  const nm = nodemailer?.default;
  if (!nm) {
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

  let webBaseUrl = '';
  try {
    const origin = req.headers?.origin ? String(req.headers.origin) : '';
    const referer = req.headers?.referer ? String(req.headers.referer) : '';
    webBaseUrl = origin ? new URL(origin).origin : referer ? new URL(referer).origin : '';
  } catch {
    /* ignore */
  }
  webBaseUrl = webBaseUrl || String(process.env.FRONTEND_BASE_URL || '').replace(/\/$/, '');
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
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      requireTLS: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  const recipients = [...changedUserIds].filter(userId => userId && userId !== myId);
  const recipientUsers = await authServices.findAuthUsersByIds(recipients, '_id email');

  for (const user of recipientUsers || []) {
    const nextEntry = nextShareMap.get(String(user._id));
    if (!nextEntry) continue;

    const previousRole = currentShareMap.get(String(user._id));
    const role = nextEntry.role || 'Viewer';
    const dashboardTitle = dashboardName || constants.SHARE_DASHBOARD_FALLBACK_NAME;
    const actionLabel = previousRole ? 'updated' : 'granted';

    try {
      const subject = constants.SHARE_DASHBOARD_EMAIL_SUBJECT;
      const safeName = escapeHtml(dashboardTitle);
      const safeRole = escapeHtml(role);
      const text = `Your access to "${dashboardTitle}" was ${actionLabel} as ${role}.\n\nOpen the dashboard: ${dashboardLink}`;

      await transporter.sendMail({
        from: fromAddr,
        to: user.email,
        subject,
        text,
        html: emailHtml(safeName, safeRole, dashboardLink),
      });
    } catch (mailErr) {
      console.error('[share] mail failed', {
        to: user.email,
        error: mailErr?.message || String(mailErr),
      });
    }
  }
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

    const responseDashboard = await enrichDashboardForResponse(dashboard);

    return res.status(HTTP_STATUS.OK).json({
      ...responseDashboard,
      effectiveRole,
      pendingCollaboratorSync,
    });
  } catch (error) {
    next(error);
  }
}

async function handleShareMutation(req, res, next, mode) {
  try {
    const { id } = req.params;
    const myId = String(req.user.id);

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_DASHBOARD_ID });
    }

    const dashboard = await dashboardServices.findDashboardByIdLean(id);
    if (!dashboard) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.DASHBOARD_NOT_FOUND });
    }

    const { canManageSharing } = getSharePermissionContext(dashboard, req.user.id);
    if (!canManageSharing) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: constants.ONLY_EDITORS_CAN_SHARE });
    }

    const currentShareMap = new Map(
      (dashboard.sharedWith || []).map(entry => [String(entry.userId), entry.role || 'Viewer'])
    );
    let nextShareMap = new Map(
      (dashboard.sharedWith || []).map(entry => [
        String(entry.userId),
        { userId: String(entry.userId), role: entry.role || 'Viewer' },
      ])
    );
    let changedUserIds = new Set();
    let action = mode;

    if (mode === 'post') {
      const { shares } = req.body || {};
      if (!Array.isArray(shares) || shares.length === 0) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: constants.SHARES_MUST_BE_A_NON_EMPTY_ARRAY });
      }

      const requestedShares = await resolveShareUsers(shares, req.user.id, true);
      for (const [userId, share] of requestedShares.entries()) {
        if (currentShareMap.get(userId) !== share.role) changedUserIds.add(userId);
        nextShareMap.set(userId, share);
      }
      action = 'merge';
    }

    if (mode === 'put') {
      const { shares, replaceExisting, mode: updateMode } = req.body || {};

      if (updateMode === 'remove') {
        const revokedUserIds = await resolveShareTargetsFromBody(req.body || {}, req.user.id);
        if (revokedUserIds.size === 0) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json({ error: constants.SHARE_UPDATE_PAYLOAD_REQUIRED });
        }

        for (const userId of revokedUserIds) {
          if (nextShareMap.delete(userId)) changedUserIds.add(userId);
        }
        action = 'remove';
      } else {
        if (!Array.isArray(shares)) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json({ error: constants.SHARES_MUST_BE_AN_ARRAY });
        }

        const requestedShares = await resolveShareUsers(shares, req.user.id, true);
        const shouldReplace = updateMode === 'replace' || replaceExisting !== false;

        if (shouldReplace) {
          nextShareMap = new Map(requestedShares);

          const allUserIds = new Set([...currentShareMap.keys(), ...requestedShares.keys()]);
          for (const userId of allUserIds) {
            const currentRole = currentShareMap.get(userId) || null;
            const nextRole = requestedShares.get(userId)?.role || null;
            if (currentRole !== nextRole) changedUserIds.add(userId);
          }
          action = 'replace';
        } else {
          for (const [userId, share] of requestedShares.entries()) {
            if (currentShareMap.get(userId) !== share.role) changedUserIds.add(userId);
            nextShareMap.set(userId, share);
          }
          action = 'merge';
        }
      }
    }

    if (mode === 'delete') {
      const revokedUserIds = await resolveShareTargetsFromBody(req.body || {}, req.user.id);

      if (revokedUserIds.size === 0) {
        nextShareMap = new Map();
        changedUserIds = new Set(currentShareMap.keys());
        action = 'revoke_all';
      } else {
        for (const userId of revokedUserIds) {
          if (nextShareMap.delete(userId)) changedUserIds.add(userId);
        }
        action = 'remove';
      }
    }

    const sharedPayload = [...nextShareMap.values()].map(entry => ({
      userId: entry.userId,
      role: entry.role,
    }));

    const updatedDashboard = await persistDashboardShares(dashboard, sharedPayload);

    if (action === 'merge' || action === 'replace') {
      await sendShareNotifications({
        req,
        dashboardId: id,
        dashboardName: dashboard.name,
        myId,
        currentShareMap,
        nextShareMap,
        changedUserIds: new Set(
          [...changedUserIds].filter(userId => nextShareMap.has(userId) && userId !== myId)
        ),
      });
    }

    const responseDashboard = await enrichDashboardForResponse(updatedDashboard);

    return res.status(HTTP_STATUS.OK).json({
      ok: true,
      action,
      dashboard: responseDashboard,
      sharedWith: responseDashboard.sharedWith,
    });
  } catch (error) {
    console.error('Share error:', error);
    next(error);
  }
}

// Share a dashboard by email or user ID, with specified roles (Viewer/Editor)
async function handleShareDashboard(req, res, next) {
  return handleShareMutation(req, res, next, 'post');
}

async function handleUpdateDashboardSharing(req, res, next) {
  return handleShareMutation(req, res, next, 'put');
}

async function handleDeleteDashboardSharing(req, res, next) {
  return handleShareMutation(req, res, next, 'delete');
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
        parent_id: null,
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
        parent_id: prev.parent_id || null,
        lineageId: prev.lineageId || prev._id,
        ownerLineageId: forkDoc ? prev.ownerLineageId : prevLineage,
        versionNumber: vn,
      });
      if (created?.parent_id) {
        await syncSharedLayoutsToParent({
          parentId: created.parent_id,
          layouts,
          name: created.name,
          baseName: created.baseName,
        });
      }
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
        parent_id: ownerL,
        lineageId: null,
        ownerLineageId: ownerL,
        versionNumber: 1,
      });
      await dashboardServices.updateDashboardById(created._id, {
        lineageId: created._id,
      });
      if (created?.parent_id) {
        await syncSharedLayoutsToParent({
          parentId: created.parent_id,
          layouts,
          name: created.name,
          baseName: created.baseName,
        });
      }
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
      parent_id: basePrev.parent_id || ownerL,
      lineageId: basePrev.lineageId || basePrev._id,
      ownerLineageId: ownerL,
      versionNumber: vn,
    });
    if (created?.parent_id) {
      await syncSharedLayoutsToParent({
        parentId: created.parent_id,
        layouts,
        name: created.name,
        baseName: created.baseName,
      });
    }
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
  handleDeleteDashboardSharing,
  handleGetDashboards,
  handleGetDashboardById,
  handleGetDashboardVersions,
  handlePostDashboard,
  handleSyncDashboard,
  handleShareDashboard,
  handleUpdateDashboardSharing,
};
