import Collection from '../models/collection.model.js';

async function findCollectionMetaByName(name) {
  return Collection.findOne({ name }).lean();
}

async function findAllCollectionMetasSorted() {
  return Collection.find({}).select('name recordCount').sort({ name: 1 }).lean();
}

function getDynamicCollectionModel(collectionName) {
  return Collection.getModel(collectionName);
}

export default {
  findCollectionMetaByName,
  findAllCollectionMetasSorted,
  getDynamicCollectionModel,
};
