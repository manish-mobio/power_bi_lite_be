import AuthUser from '../models/authUser.model.js';
import userTbl from '../models/user.model.js';

async function findAllUsers(limit) {
  return userTbl.find({}).limit(limit).lean();
}

async function findAuthUsersByEmailRegex(emailRegex, excludeUserId) {
  return AuthUser.find({
    email: { $regex: emailRegex, $options: 'i' },
    _id: { $ne: excludeUserId },
  })
    .select('_id email name')
    .limit(10)
    .lean();
}

export default { findAllUsers, findAuthUsersByEmailRegex };
