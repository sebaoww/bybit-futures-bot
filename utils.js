const axios = require('axios');
const { Telegraf } = require('telegraf');
const { botToken, chatId } = require('./config');

const bot = new Telegraf(botToken);

// Funzione sleep per pause controllate
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Funzione per invio messaggi Telegram
const sendNotification = async (message) => {
  try {
    console.log(`📩 Telegram: ${message}`);
    await bot.telegram.sendMessage(chatId, message);
  } catch (error) {
    console.error('Errore invio Telegram:', error.message);
  }
};

// Calcolo EMA
const calculateEMA = (data, period) => {
  const k = 2 / (period + 1);
  let emaArray = [];
  let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  emaArray.push(ema);

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * k + ema;
    emaArray.push(ema);
  }

  return emaArray;
};

// Calcolo ATR
const calculateATR = (highs, lows, closes, period) => {
  let atrArray = [];

  for (let i = period; i < highs.length; i++) {
    const trueRange = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atrArray.push(trueRange);
  }

  const atr = atrArray.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  return atr;
};

// Calcolo RSI
const calculateRSI = (data, period) => {
  let gains = [];
  let losses = [];

  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) gains.push(change);
    else losses.push(Math.abs(change));
  }

  const avgGain = gains.reduce((acc, val) => acc + val, 0) / period;
  const avgLoss = losses.reduce((acc, val) => acc + val, 0) / period;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
};

module.exports = {
  sleep,
  sendNotification,
  calculateEMA,
  calculateATR,
  calculateRSI
};
