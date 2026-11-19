const colors = {
  info: '\x1b[36m',    // Cyan
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  debug: '\x1b[90m',   // Gray
  reset: '\x1b[0m',
};

const format = (level, color, args) => {
  const time = new Date().toISOString();
  return `${color}[${level} ${time}]${colors.reset} ${args.join(' ')}`;
};

module.exports = {
  info: (...args) => console.log(format('INFO', colors.info, args)),
  warn: (...args) => console.warn(format('WARN', colors.warn, args)),
  error: (...args) => console.error(format('ERROR', colors.error, args)),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(format('DEBUG', colors.debug, args));
    }
  },
};