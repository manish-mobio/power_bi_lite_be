import mongoose from 'mongoose';

const dashboardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AuthUser',
      required: true,
      index: true,
    },
    sharedWith: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'AuthUser',
          required: true,
        },
        role: {
          type: String,
          enum: ['Viewer', 'Editor'],
          default: 'Viewer',
          required: true,
        },
      },
    ],
    name: { type: String, default: 'My Dashboard' },
    baseName: { type: String, default: 'My Dashboard' },
    charts: { type: Array, default: [] },
    layouts: { type: Object, default: {} },
    logo: { type: String },
    collection: { type: String },
    lineageId: { type: mongoose.Schema.Types.ObjectId, index: true },
    ownerLineageId: { type: mongoose.Schema.Types.ObjectId, index: true },
    versionNumber: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const Dashboard = mongoose.model('Dashboard', dashboardSchema);
export default Dashboard;
