const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const logFilePath = path.join(__dirname, 'app.log');
const VERBOSE_MODE = process.env.VERBOSE_MODE === 'true';

const sendTelegramLog = async (level, message) => {
    try {
        const text = `🚨 *${level.toUpperCase()}*\n${message}`;
        await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            chat_id: process.env.CHAT_ID,
            text,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('Errore invio log Telegram:', e.message);
    }
};

function writeLog(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    // Log su file e console
    if (VERBOSE_MODE || level !== 'INFO') {
        fs.appendFileSync(logFilePath, logMessage);
        console.log(logMessage.trim());

        // Invia anche su Telegram se WARN o ERROR
        if (['WARN', 'ERROR'].includes(level.toUpperCase())) {
            sendTelegramLog(level, message);
        }
    }
}

function logSection(title) {
    const separator = '═'.repeat(20);
    const sectionTitle = `\n${separator} ${title} ${separator}`;
    console.log(sectionTitle);
    fs.appendFileSync(logFilePath, sectionTitle + '\n');
}

module.exports = {
    info: (msg) => writeLog('INFO', msg),
    warn: (msg) => writeLog('WARN', msg),
    error: (msg) => writeLog('ERROR', msg),
    section: logSection   // 
};
