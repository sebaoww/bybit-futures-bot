// debugLogger.js
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'debug_futures.log');

function writeDebugLog(context, data) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${context}:\n${JSON.stringify(data, null, 2)}\n\n`;
  fs.appendFileSync(logFile, logEntry);
}

module.exports = { writeDebugLog };
