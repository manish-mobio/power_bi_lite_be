import mongoose from 'mongoose';

const dashboardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuthUser', required: true, index: true },
  // People the dashboard is shared with and the role they have.
  // Owner dashboards are still stored with `userId`; shared access is granted via `sharedWith`.
  sharedWith: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuthUser', required: true },
      role: { type: String, enum: ['Viewer', 'Editor'], default: 'Viewer', required: true },
    },
  ],
  name: { type: String, default: 'My Dashboard' },
  charts: { type: Array, default: [] },
  layouts: { type: Object, default: {} },
}, { timestamps: true });

const Dashboard = mongoose.model('Dashboard', dashboardSchema);
export default Dashboard;
