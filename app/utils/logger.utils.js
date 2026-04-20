import { createLogger, format, transports } from 'winston';
import { MongoDB } from 'winston-mongodb';
const { combine, timestamp, printf, prettyPrint, errors, splat } = format;
const { DATABASE_URL } = process.env;

const myFormat = printf(({ level, message, timestamp, stack, url }) => {
  return `${level} : ${url ?? ''} ${timestamp} ${message} ${stack ?? ''}`;
});

const customFormat = printf(({ level, message, timestamp, meta }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message} ${meta ? JSON.stringify(meta) : ''}`;
});

const loggerMain = () => {
  return createLogger({
    level: 'info',
    format: combine(
      splat(), // Necessary to produce the 'meta' property
      timestamp(),
      prettyPrint(),
      errors({ stack: true }) // <-- use errors format
    ),
    transports: [
      new transports.Console({
        expressFormat: true,
        format: myFormat,
      }), // print the logs in console
    ],
  });
};

// manage the logs in db
const apiLogger = () => {
  const db = DATABASE_URL;
  return createLogger({
    format: combine(timestamp(), customFormat),
    transports: [
      new MongoDB({
        level: 'info',
        db,
        options: { maxPoolSize: 2 },
        collection: 'logs',
        capped: true,
        metaKey: 'meta',
      }),
    ],
  });
};

const logger = loggerMain();
const apiLog = apiLogger();

export { logger, apiLog };
