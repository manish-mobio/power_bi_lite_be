import express from 'express';
import dotenv from 'dotenv';

import routes from './routes/index.js';
import cookieParser from 'cookie-parser';
import { connectDB } from '../config/db.js';
import morgan from 'morgan';
import cors from 'cors';
import compression from 'compression';

import { logger } from './utils/logger.utils.js';
import requestLogs from './middleware/requestLog.middleware.js';
import HTTP_STATUS from './utils/statuscode.js';
import constants from './utils/constant.utils.js';

// Load environment variables from .env.
dotenv.config();

const app = express();

// Establish database connection before the server starts handling requests.
await connectDB();
// Middleware - Increase body size limit for file uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(
  compression({
    // Skip tiny payloads to reduce CPU overhead.
    threshold: '10kb',
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// Enable CORS for all origins and standard HTTP methods.
app.use(
  cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  })
);

// Custom request logging middleware.
app.use(requestLogs);

morgan.token('requestId', req => req.id);

// HTTP request log integration with application logger.
if (logger) {
  app.use(
    morgan('info : :requestId :method :url :response-time ms', {
      stream: logger.stream.write,
    })
  );
}

// Health check route.
app.get('/', (req, res) => {
  return res.json('Connected!');
});

// Mount the versioned API router.
app.use(process.env.API_VERSION, routes);

// Handler for requests that do not match any route.
app.use((req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    message: constants.ROUTE_NOT_FOUND,
  });
});

// Centralized error handler for all unhandled errors.
app.use((err, req, res) => {
  console.error(err.stack);

  res.status(err.status || HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: err.message || constants.INTERNAL_SERVER_ERROR,
  });
});

export default app;
