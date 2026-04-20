import mongoose from 'mongoose';
import Collection from '../models/collection.model.js';

async function findCollectionMetaByName(name) {
  return Collection.findOne({ name }).lean();
}

function getDynamicUploadModel(collectionName) {
  const dynamicSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.models[collectionName] || mongoose.model(collectionName, dynamicSchema);
}

async function deleteManyInDynamicCollection(collectionName) {
  const Model = getDynamicUploadModel(collectionName);
  return Model.deleteMany({});
}

async function insertManyInDynamicCollection(collectionName, docs) {
  const Model = getDynamicUploadModel(collectionName);
  return Model.insertMany(docs);
}

async function createCollectionMeta(data) {
  return Collection.create(data);
}
async function buildCollectionPayload({
  collName,
  detectedSchema,
  parsedData = [],
  inserted = [],
  sampleLimit = 100,
}) {
  return {
    name: collName,
    schema: detectedSchema,
    data: parsedData.slice(0, sampleLimit),
    recordCount: inserted.length,
  };
}

export default {
  findCollectionMetaByName,
  deleteManyInDynamicCollection,
  insertManyInDynamicCollection,
  createCollectionMeta,
  buildCollectionPayload,
};
