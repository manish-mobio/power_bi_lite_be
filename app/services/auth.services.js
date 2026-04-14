import AuthUser from '../models/authUser.model.js';

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

// async function findAuthUserByEmailSelect(email, projection) {
//   const q = AuthUser.findOne({ email });
//   if (projection) q.select(projection);
//   return q.lean();
// }

async function findAuthUsersByIds(ids, projection) {
  const q = AuthUser.find({ _id: { $in: ids } });
  if (projection) q.select(projection);
  return q.lean();
}

export default {
  findOneAuthUser,
  findAuthUserById,
  findAuthUserByIdForUpdate,
  createAuthUser,
  findOneAuthUserByEmail,
  // findAuthUserByEmailSelect,
  findAuthUsersByIds,
};
