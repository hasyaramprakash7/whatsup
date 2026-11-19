const logger = require('../utils/logger');
module.exports = (err, req, res, next) => {
  logger.error(`Unhandled error on ${req.method} ${req.url}: ${err.message}`);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message });
};