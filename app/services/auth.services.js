import AuthUser from '../models/authUser.model.js';
import jwt from 'jsonwebtoken';
import constants from '../utils/constant.utils.js';
/**
 * DB-only helpers for AuthUser. No business rules or hashing here.
 */
async function findOneAuthUser(filter) {
  return AuthUser.findOne(filter).lean();
}
async function findOneAuthUserByEmail(email) {
  return AuthUser.findOne({ email }).select('_id').lean();
}

async function findAuthUserById(id) {
  const q = AuthUser.findById(id).select('email name').lean();
  // if (projection) q.select(projection);
  return q.lean();
}

async function findAuthUserByIdForUpdate(id) {
  return AuthUser.findById(id);
}

async function createAuthUser(data) {
  return AuthUser.create(data);
}

async function findAuthUsersByIds(ids, projection) {
  const q = AuthUser.find({ _id: { $in: ids } });
  if (projection) q.select(projection);
  return q.lean();
}

function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: constants.EXPIRES_IN_DAYS });
}

export default {
  findOneAuthUser,
  findAuthUserById,
  findAuthUserByIdForUpdate,
  createAuthUser,
  findOneAuthUserByEmail,
  findAuthUsersByIds,
  generateToken,
};
