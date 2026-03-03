import mongoose from 'mongoose';

const dashboardSchema = new mongoose.Schema({
  name: { type: String, default: 'My Dashboard' },
  charts: { type: Array, default: [] },
  layouts: { type: Object, default: {} },
  logo: { type: String, default: null }, // base64 data URL for dashboard logo
}, { timestamps: true });

const Dashboard = mongoose.model('Dashboard', dashboardSchema);
export default Dashboard;
