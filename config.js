require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Keypair } = require('@solana/web3.js');

const keypairPath = process.env.WALLET_KEYPAIR_PATH || './wallet-keypair.json';
if (!fs.existsSync(keypairPath)) {
  throw new Error(`❌ Keypair file non trovato: ${keypairPath}`);
}

const keypairRaw = fs.readFileSync(keypairPath, 'utf8');
const secretKey = Uint8Array.from(JSON.parse(keypairRaw));
const walletKeypair = Keypair.fromSecretKey(secretKey);

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

function getConfig() {
  const dynamic = loadDynamic();

  return {
    telegram: {
      botToken: process.env.BOT_TOKEN,
      chatId: process.env.CHAT_ID,
    },
    solana: {
      rpcUrl: process.env.RPC_URL,
      walletKeypairPath: keypairPath,
      walletKeypair: walletKeypair,
    },
    trading: {
      tradeAmountUSD: parseFloat(process.env.TRADE_AMOUNT_USD) || 5,
      volumeThresholdSOL: parseFloat(process.env.VOLUME_THRESHOLD) || 1.5,
      takeProfitPercentage: dynamic.TAKE_PROFIT ?? parseFloat(process.env.TAKE_PROFIT) || 2,
      stopLossPercentage: dynamic.STOP_LOSS ?? parseFloat(process.env.STOP_LOSS) || -1.5,
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
    }
  };
}

module.exports = {
  getConfig,
  loadDynamic,
  saveDynamic
};
