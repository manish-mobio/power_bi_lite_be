import express from "express";
import dotenv from "dotenv";
import { connectToMongodb } from "./config/index.js";
import routes from "./routes/index.js";

dotenv.config();

const app = express();

// Middleware - Increase body size limit for file uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Test route
app.get("/", (req, res) => {
  return res.json("Connected!");
});

// Routes
app.use("/api/v1", routes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Route Not Found",
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// Connect DB
await connectToMongodb(process.env.MONGODB_URI_CONNECTION);

// Start server (use PORT=8000 for Power BI Lite frontend)
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
