require('dotenv').config();
const fs = require('fs');
const path = require('path');

const dynamicPath = path.join(__dirname, '.dynamic_config.json');

function loadDynamic() {
  try {
    return JSON.parse(fs.readFileSync(dynamicPath));
  } catch {
    return {};
  }
}

function saveDynamic(data) {
  fs.writeFileSync(dynamicPath, JSON.stringify(data, null, 2));
}

// 🔁 Multi-exchange support: 'binance' (default) or 'bybit'
function getConfig(exchange = 'binance') {
  const dynamic = loadDynamic();

  const config = {
    telegram: {
      botToken: process.env.BOT_TOKEN,
      chatId: process.env.CHAT_ID,
    },
    trading: {
        tradeAmountUSD: exchange === 'bybit'
        ? parseFloat(process.env.BYBIT_TRADE_AMOUNT) || 5
        : parseFloat(process.env.BINANCE_TRADE_AMOUNT) || 10,      
      volumeThresholdSOL: parseFloat(process.env.VOLUME_THRESHOLD) || 1.5,
      takeProfitPercentage: dynamic.TAKE_PROFIT !== undefined ? dynamic.TAKE_PROFIT : (parseFloat(process.env.TAKE_PROFIT) || 2),
      stopLossPercentage: dynamic.STOP_LOSS !== undefined ? dynamic.STOP_LOSS : (parseFloat(process.env.STOP_LOSS) || -1.5),
      slippage: parseFloat(process.env.SLIPPAGE) || 0.02,
      trailingStopPercent: parseFloat(process.env.TRAILING_STOP) || 0.05,
      liveMode: process.env.LIVE_MODE === 'true'
    },
    strategy: {
      EMA_PERIODS: {
        short: parseInt(process.env.EMA_SHORT) || 9,
        long: parseInt(process.env.EMA_LONG) || 25,
      },
      RSI_PERIOD: parseInt(process.env.RSI_PERIOD) || 14,
      ATR_PERIOD: parseInt(process.env.ATR_PERIOD) || 14,
      SUPER_TREND_MULTIPLIER: parseFloat(process.env.SUPER_TREND_MULTIPLIER) || 2,
    },
    keys: {}
  };

  // Se il modulo è "bybit", includi le sue API
  if (exchange === 'bybit') {
    config.keys = {
      apiKey: process.env.BYBIT_API_KEY,
      apiSecret: process.env.BYBIT_API_SECRET
    };
  }

  return config;
}

module.exports = {
  getConfig,
  loadDynamic,
  saveDynamic
};
