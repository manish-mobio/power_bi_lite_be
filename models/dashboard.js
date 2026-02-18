import mongoose from 'mongoose';

const dashboardSchema = new mongoose.Schema({
  name: { type: String, default: 'My Dashboard' },
  charts: { type: Array, default: [] },
  layouts: { type: Object, default: {} },
}, { timestamps: true });

const Dashboard = mongoose.model('Dashboard', dashboardSchema);
export default Dashboard;
