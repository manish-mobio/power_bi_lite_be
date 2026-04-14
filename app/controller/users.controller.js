import { normalizeEmail } from '../utils/common.utils.js';
import HTTP_STATUS from '../utils/statuscode.js';
import userServices from '../services/user.services.js';

async function handleGetData(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 1000;
    const data = await userServices.findAllUsers(limit);
    return res.status(HTTP_STATUS.OK).json(data);
  } catch (error) {
    next(error);
  }
}

async function handleSearchUsers(req, res, next) {
  try {
    const myId = String(req.user.id);
    const q = normalizeEmail(req.query.email);
    if (!q) return res.status(HTTP_STATUS.OK).json([]);

    // Partial match on registered emails
    const users = await userServices.findAuthUsersByEmailRegex(q, myId);

    return res.status(HTTP_STATUS.OK).json(
      (users || []).map(u => ({
        id: u._id,
        email: u.email,
        name: u.name || '',
      }))
    );
  } catch (error) {
    next(error);
  }
}

export { handleGetData, handleSearchUsers };
