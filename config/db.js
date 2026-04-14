import mongoose from 'mongoose';
import { logger } from '../app/utils/logger.utils.js';
import URL from '../db-connection-url.js';

export async function connectDB() {
  try {
    await mongoose.connect(URL);
    logger.info('DB CONNECTED SUCCESSFULLY...');
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}
