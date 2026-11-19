const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    logger.info('[DB] Initiating MongoDB connection...');
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: process.env.NODE_ENV !== 'production',
      serverSelectionTimeoutMS: 10000,
    });
    logger.info(`[DB] MongoDB Connected: ${conn.connection.host}`);
    
    mongoose.connection.on('error', (err) => {
      logger.error(`[DB] MongoDB runtime error: ${err.message}`);
    });
    mongoose.connection.on('disconnected', () => {
      logger.warn('[DB] MongoDB disconnected.');
    });
  } catch (error) {
    logger.error(`[DB] MongoDB Connection Failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;