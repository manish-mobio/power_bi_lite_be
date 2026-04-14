import mongoose from 'mongoose';
import ipware from 'ipware';
import { logger, apiLog } from '../utils/logger.utils.js';

const get_ip = ipware().get_ip;

const requestLogs = (req, res, next) => {
  const requestId = new mongoose.Types.ObjectId();

  res.logger = logger.child({
    url: req.url,
    requestStartTime: Date.now(),
  });

  req.id = requestId;

  res.logger.info('Request started');

  // Store the request logs in collection
  if (req.method !== 'GET') {
    const ipInfo = get_ip(req);

    apiLog.info({
      message: 'Requested Log',
      meta: {
        url: req.url,
        headerInfo: JSON.stringify(req.headers),
        ipInfo: JSON.stringify(ipInfo),
        statusCode: res.statusCode,
        method: req.method,
        createdAt: new Date(),
      },
    });
  }

  next();
};

export default requestLogs;
