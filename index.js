import 'dotenv/config';

import { logger } from './app/utils/logger.utils.js';
import app from './app/server.js';

const PORT = process.env.PORT || 8000;

// Start the HTTP server and export it for tests or integration.
export default app.listen(PORT, () => {
  logger.info(`server is running on port ${PORT}`);
});
