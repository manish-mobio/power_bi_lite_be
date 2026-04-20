import dashboardTbl from '../models/dashboard.model.js';
import mongoose from 'mongoose';
async function findDashboardByIdLean(id) {
  return dashboardTbl.findById(id).lean();
}

async function findDashboardsLean(filter, sort) {
  const q = dashboardTbl.find(filter);
  if (sort) q.sort(sort);
  return q.lean();
}

async function updateDashboardById(id, update, options = {}) {
  return dashboardTbl.findByIdAndUpdate(id, update, {
    new: true,
    ...options,
  });
}

async function findSharedDashboard({ ownerId, lk, userId }) {
  return dashboardTbl
    .findOne({
      userId: new mongoose.Types.ObjectId(ownerId),
      $or: [{ lineageId: lk }, { _id: lk }],
      'sharedWith.userId': new mongoose.Types.ObjectId(userId),
    })
    .lean();
}

export function buildDashboardPayload({ ownerId, nextName, base, latestFork, ol, vn }) {
  return {
    userId: ownerId,
    name: nextName,
    baseName: base,
    charts: latestFork?.charts || [],
    layouts: latestFork?.layouts || {},
    ...(latestFork?.logo !== null && { logo: latestFork.logo }),
    ...(latestFork?.collection !== null && {
      collection: latestFork.collection,
    }),
    sharedWith: [],
    lineageId: ol,
    ownerLineageId: ol,
    versionNumber: vn,
  };
}

export async function createDashboard(payload) {
  return dashboardTbl.create(payload);
}

async function updateManyDashboards(filter, update) {
  return dashboardTbl.updateMany(filter, update);
}
async function findDashboardByIdAndSort(filter, sort) {
  return dashboardTbl.findOne(filter).sort(sort).lean();
}

export default {
  findDashboardByIdAndSort,
  createDashboard,
  findSharedDashboard,
  buildDashboardPayload,
  findDashboardByIdLean,
  findDashboardsLean,
  updateDashboardById,
  updateManyDashboards,
};
