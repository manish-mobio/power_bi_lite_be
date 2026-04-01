import userTbl from "../models/index.js";
import dashboardTbl from "../models/dashboard.js";
import Collection from "../models/collection.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import AuthUser from "../models/authUser.js";
import { clearAuthCookie, setAuthCookie } from "../middleware/auth.js";

async function handleGetData(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 1000;
    const data = await userTbl.find({}).limit(limit).lean();
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

async function handleGetDashboards(req, res, next) {
  try {
    const myId = String(req.user.id);
    const data = await dashboardTbl
      .find({
        $or: [{ userId: req.user.id }, { 'sharedWith.userId': req.user.id }],
      })
      .sort({ updatedAt: -1 })
      .lean();

    // Attach the role the current user has for each dashboard
    const withRole = (data || []).map((d) => {
      if (String(d.userId) === myId) {
        return { ...d, effectiveRole: 'Editor' };
      }
      const entry = (d.sharedWith || []).find(
        (x) => String(x.userId) === myId
      );
      return { ...d, effectiveRole: entry?.role || null };
    });

    return res.status(200).json(withRole);
  } catch (error) {
    next(error);
  }
}

async function handleGetDashboardById(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid dashboard ID' });
    }
    const myId = String(req.user.id);
    const dashboard = await dashboardTbl
      .findOne({
        _id: id,
        $or: [{ userId: req.user.id }, { 'sharedWith.userId': req.user.id }],
      })
      .lean();
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    let effectiveRole = null;
    if (String(dashboard.userId) === myId) effectiveRole = 'Editor';
    else {
      const entry = (dashboard.sharedWith || []).find(
        (x) => String(x.userId) === myId
      );
      effectiveRole = entry?.role || null;
    }

    return res.status(200).json({ ...dashboard, effectiveRole });
  } catch (error) {
    next(error);
  }
}

async function handleSearchUsers(req, res, next) {
  try {
    const myId = String(req.user.id);
    const q = normalizeEmail(req.query.email);
    if (!q) return res.status(200).json([]);

    // Partial match on registered emails
    const users = await AuthUser.find({
      email: { $regex: q, $options: 'i' },
      _id: { $ne: myId },
    })
      .select('_id email name')
      .limit(10)
      .lean();

    return res.status(200).json(
      (users || []).map((u) => ({
        id: u._id,
        email: u.email,
        name: u.name || '',
      }))
    );
  } catch (error) {
    next(error);
  }
}

async function handleShareDashboard(req, res, next) {
  try {
    const { id } = req.params;
    const myId = String(req.user.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid dashboard ID' });
    }

    const { shares } = req.body || {};
    if (!Array.isArray(shares) || shares.length === 0) {
      return res
        .status(400)
        .json({ error: 'shares must be a non-empty array' });
    }

    const dashboard = await dashboardTbl
      .findById(id)
      .lean();
    if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });

    // Owner is treated as Editor for permissions
    const isOwner = String(dashboard.userId) === myId;
    const myEntry = (dashboard.sharedWith || []).find(
      (x) => String(x.userId) === myId
    );
    const effectiveRole = isOwner ? 'Editor' : myEntry?.role || null;
    if (effectiveRole !== 'Editor') {
      return res.status(403).json({ error: 'Only editors can share' });
    }

    const allowedRoles = new Set(['Viewer', 'Editor']);
    const nextShared = Array.isArray(dashboard.sharedWith)
      ? [...dashboard.sharedWith]
      : [];

    const mapByUserId = new Map(
      nextShared.map((x) => [String(x.userId), { userId: x.userId, role: x.role }])
    );
    const updatedUserIds = new Set();
    for (const s of shares) {
      const role = s?.role;
      const email = normalizeEmail(s?.email);
      const userId = s?.userId != null ? String(s.userId) : undefined;

      if (!allowedRoles.has(role)) continue;

      let targetUserId = userId;

      if (!targetUserId && email) {
        const u = await AuthUser.findOne({ email }).select('_id').lean();
        if (!u) continue;
        targetUserId = String(u._id);
      }

      if (!targetUserId) continue;
      if (targetUserId === myId) continue;

      mapByUserId.set(targetUserId, { userId: targetUserId, role });

      // ✅ Track only current request users
      updatedUserIds.add(targetUserId);
    }

    // Keep as array of {userId, role}. Use Mongoose ObjectIds on save.
    dashboard.sharedWith = [...mapByUserId.values()].map((x) => ({
      userId: x.userId,
      role: x.role,
    }));

    await dashboardTbl.findByIdAndUpdate(id, { sharedWith: dashboard.sharedWith });

    // Best-effort email notifications (share already persisted above)
    const fromAddr = normalizeEmail(process.env.EMAIL_FROM);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const mailEnabled = Boolean(fromAddr && smtpUser && smtpPass);

    if (mailEnabled) {
      const nodemailer = await import('nodemailer').catch((e) => {
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

        const escapeHtml = (str) =>
          String(str ?? '').replace(/[&<>"']/g, (c) => {
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
          webBaseUrl = origin
            ? new URL(origin).origin
            : referer
              ? new URL(referer).origin
              : '';
        } catch {
          /* ignore */
        }
        webBaseUrl =
          webBaseUrl ||
          String(
            process.env.FRONTEND_BASE_URL ||
            process.env.CLIENT_BASE_URL ||
            'http://localhost:3000'
          ).replace(/\/$/, '');
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
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: { user: smtpUser, pass: smtpPass },
          });
        }

        const recipients = [...updatedUserIds].filter(
          (userId) => userId && userId !== myId
        );
        

        const recipientUsers = await AuthUser.find({
          _id: { $in: recipients },
        })
          .select('_id email')
          .lean();
        
        for (const u of recipientUsers || []) {
          const sharedEntry = mapByUserId.get(String(u._id));
          const role = sharedEntry?.role || 'Viewer';
          const dashboardName = dashboard.name || 'a shared dashboard';
          try {
            const subject = 'You have been invited to view a dashboard';
            const safeName = escapeHtml(dashboardName);
            const safeRole = escapeHtml(role);
            const text = `You have been granted access to "${dashboardName}" as ${role}.\n\nOpen the dashboard: ${dashboardLink}`;
            const html = `
              <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5;">
                <p style="margin: 0 0 12px;">Hello,</p>
                <p style="margin: 0 0 12px;">
                  You have been granted access to <strong>${safeName}</strong> as <strong>${safeRole}</strong>.
                </p>
                <p style="margin: 0 0 18px; color: #475569;">
                  Click the link below to open the dashboard inside our application.
                </p>
                <a href="${dashboardLink}" target="_blank" rel="noopener noreferrer"
                  style="display: inline-block; background: #0f6cbd; color: #fff; padding: 10px 16px; border-radius: 10px; text-decoration: none; font-weight: 700;">
                  Open dashboard
                </a>
                <p style="margin: 16px 0 0; color: #64748b; font-size: 12px;">
                  If the button doesn’t work, open this URL in your browser:<br/>
                  <a href="${dashboardLink}" style="color: #0f6cbd;">${dashboardLink}</a>
                </p>
              </div>
            `;
            const info = await transporter.sendMail({
              from: fromAddr,
              to: u.email,
              subject,
              text,
              html,
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

    return res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function handlePostDashboard(req, res, next) {
  try {
    const { name = 'My Dashboard', charts = [], layouts = {} } = req.body || {};
    const dashboard = await dashboardTbl.create({
      userId: req.user.id,
      name,
      charts,
      layouts,
    });
    return res.status(201).json(dashboard);
  } catch (error) {
    next(error);
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function handleSignup(req, res, next) {
  try {
    const { email, password, name } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return res.status(400).json({ error: 'Email is required' });
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await AuthUser.findOne({ email: cleanEmail }).lean();
    if (existing) return res.status(409).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await AuthUser.create({
      email: cleanEmail,
      passwordHash,
      name: typeof name === 'string' ? name.trim() : '',
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Server auth misconfigured' });
    const token = jwt.sign(
      { sub: String(user._id), email: user.email },
      secret,
      { expiresIn: '7d' }
    );
    setAuthCookie(res, token);

    return res.status(201).json({ id: user._id, email: user.email, name: user.name });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'User already exists' });
    next(error);
  }
}

async function handleLogin(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await AuthUser.findOne({ email: cleanEmail }).lean();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Server auth misconfigured' });
    const token = jwt.sign(
      { sub: String(user._id), email: user.email },
      secret,
      { expiresIn: '7d' }
    );
    setAuthCookie(res, token);
    return res.status(200).json({ id: user._id, email: user.email, name: user.name });
  } catch (error) {
    next(error);
  }
}

async function handleMe(req, res) {
  try {
    const user = await AuthUser.findById(req.user.id).select('email name').lean();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ id: user._id, email: user.email, name: user.name || '' });
  } catch {
    return res.status(200).json({ id: req.user.id, email: req.user.email, name: '' });
  }
}

async function handleLogout(req, res) {
  clearAuthCookie(res);
  return res.status(200).json({ ok: true });
}

async function handleChangePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (String(currentPassword) === String(newPassword)) {
      return res
        .status(400)
        .json({ error: 'Current and new passwords must be different' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await AuthUser.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const match = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 12);
    await user.save();
    return res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Infer field types from a sample document
 */
function inferSchema(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const schema = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('_') && key !== '_id') continue;
    if (key === '__v') continue;

    if (value === null || value === undefined) {
      schema[key] = { type: 'string', detected: false };
    } else if (typeof value === 'number') {
      schema[key] = { type: 'number', detected: true };
    } else if (typeof value === 'boolean') {
      schema[key] = { type: 'boolean', detected: true };
    } else if (Array.isArray(value)) {
      schema[key] = { type: 'array', detected: true };
    } else if (typeof value === 'object') {
      schema[key] = { type: 'object', detected: true };
    } else {
      schema[key] = { type: 'string', detected: true };
    }
  }
  return schema;
}

/**
 * Parse CSV text into array of objects
 */
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header and one data row');
  }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted values
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const obj = {};
    headers.forEach((header, idx) => {
      let value = values[idx] || '';
      value = value.replace(/^"|"$/g, ''); // Remove quotes

      // Try to parse as number
      if (value && !isNaN(value) && value !== '') {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          obj[header] = num;
        } else {
          obj[header] = value;
        }
      } else {
        obj[header] = value;
      }
    });
    rows.push(obj);
  }

  return rows;
}

/**
 * File upload handler - accepts CSV or JSON, parses, detects schema, stores as collection
 */
async function handleFileUpload(req, res, next) {
  try {
    const { fileName, fileContent, fileType, collectionName } = req.body;

    if (!fileContent) {
      return res.status(400).json({ error: 'File content is required' });
    }

    let parsedData = [];
    let detectedSchema = {};

    try {
      if (fileType === 'csv' || fileName?.toLowerCase().endsWith('.csv')) {
        parsedData = parseCSV(fileContent);
      } else if (fileType === 'json' || fileName?.toLowerCase().endsWith('.json')) {
        parsedData = JSON.parse(fileContent);
        if (!Array.isArray(parsedData)) {
          // If it's an object with a data array
          if (parsedData.data && Array.isArray(parsedData.data)) {
            parsedData = parsedData.data;
          } else {
            parsedData = [parsedData];
          }
        }
      } else {
        return res.status(400).json({ error: 'Unsupported file type. Use CSV or JSON.' });
      }

      if (!Array.isArray(parsedData) || parsedData.length === 0) {
        return res.status(400).json({ error: 'No valid data found in file' });
      }

      // Detect schema from first record
      const sample = parsedData[0];
      detectedSchema = inferSchema(sample);

      // Generate collection name if not provided
      const collName = collectionName ||
        (fileName ? fileName.replace(/\.(csv|json)$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '_') :
          `uploaded_${Date.now()}`);

      // Check if collection already exists - if so, replace it
      const existing = await Collection.findOne({ name: collName });
      const isReplacement = !!existing;

      // Create dynamic model for this collection
      const dynamicSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
      const DynamicModel = mongoose.models[collName] || mongoose.model(collName, dynamicSchema);

      // If collection exists, delete all existing documents
      if (isReplacement) {
        await DynamicModel.deleteMany({});
      }

      // Insert data into MongoDB
      const inserted = await DynamicModel.insertMany(parsedData);

      // Store or update collection metadata
      if (isReplacement) {
        // Update existing collection metadata
        await Collection.findOneAndUpdate(
          { name: collName },
          {
            schema: detectedSchema,
            data: parsedData.slice(0, 100), // Store sample for preview
            recordCount: inserted.length,
            updatedAt: new Date(),
          },
          { new: true }
        );
      } else {
        // Create new collection metadata
        await Collection.create({
          name: collName,
          schema: detectedSchema,
          data: parsedData.slice(0, 100), // Store sample for preview
          recordCount: inserted.length,
        });
      }

      // Return schema info for frontend
      const schemaArray = Object.entries(detectedSchema).map(([name, info]) => ({
        name,
        type: info.type === 'number' ? 'number' : 'string',
      }));

      return res.status(201).json({
        success: true,
        collection: collName,
        schema: schemaArray,
        recordCount: inserted.length,
        replaced: isReplacement,
        message: isReplacement
          ? `Successfully replaced collection "${collName}" with ${inserted.length} records`
          : `Successfully uploaded ${inserted.length} records to collection "${collName}"`,
      });

    } catch (parseError) {
      return res.status(400).json({
        error: 'Failed to parse file',
        details: parseError.message
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Get data from a dynamic collection
 */
async function handleGetCollectionData(req, res, next) {
  try {
    const { collection } = req.params;
    const limit = parseInt(req.query.limit, 10) || 1000;

    if (!collection) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    // Check if collection exists in metadata
    const collectionMeta = await Collection.findOne({ name: collection });
    if (!collectionMeta) {
      return res.status(404).json({ error: `Collection "${collection}" not found` });
    }

    // Get dynamic model
    const dynamicSchema = new mongoose.Schema({}, { strict: false });
    const DynamicModel = mongoose.models[collection] || mongoose.model(collection, dynamicSchema);

    const data = await DynamicModel.find({}).limit(limit).lean();
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Get collection metadata (e.g. recordCount) for a collection
 */
async function handleGetCollectionMeta(req, res, next) {
  try {
    const { collection } = req.params;
    if (!collection) {
      return res.status(400).json({ error: 'Collection name is required' });
    }
    const collectionMeta = await Collection.findOne({ name: collection }).lean();
    if (!collectionMeta) {
      return res.status(404).json({ error: `Collection "${collection}" not found` });
    }
    return res.status(200).json({
      recordCount: collectionMeta.recordCount != null ? collectionMeta.recordCount : 0,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get list of all collections
 */
async function handleGetCollections(req, res, next) {
  try {
    const collections = await Collection.find({}).select('name recordCount').sort({ name: 1 }).lean();
    const collectionNames = collections.map(c => c.name);
    return res.status(200).json(collectionNames);
  } catch (error) {
    next(error);
  }
}

export {
  handleGetData,
  handleGetDashboards,
  handleGetDashboardById,
  handlePostDashboard,
  handleFileUpload,
  handleSearchUsers,
  handleShareDashboard,
  handleGetCollectionData,
  handleGetCollectionMeta,
  handleGetCollections,
  handleSignup,
  handleLogin,
  handleMe,
  handleLogout,
  handleChangePassword,
};