import mongoose from 'mongoose';

// Dynamic schema for uploaded 
const collectionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  schema: {
    type: Object,
    required: true,
  },
  data: {
    type: Array,
    default: [],
  },
  recordCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Create a method to get the model dynamically
collectionSchema.statics.getModel = function(collectionName) {
  // Create a dynamic schema based on stored schema
  const dynamicSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.models[collectionName] || mongoose.model(collectionName, dynamicSchema);
};

const Collection = mongoose.model('Collection', collectionSchema);
export default Collection;
