// strategy_futures_v10.js - Strategia V10 con filtri professionali
const logger = require('./logger');
const {
  calculateEMA,
  calculateRSI,
  calculateADX,
  calculateSuperTrend,
  calculateMACDHistogram,
  calculateVolumeSpike
} = require('./indicators_v10'); // useremo un file dedicato

function analyzeSignalV10(candles, volumes, lastTradeDirection = null, lastTradeTime = 0, currentTime = 0) {
  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);

  const ema9 = calculateEMA(close, 9).at(-1);
  const ema25 = calculateEMA(close, 25).at(-1);
  const ema200 = calculateEMA(close, 200).at(-1);

  const rsi = calculateRSI(close, 14).at(-1);
  const adxObj = calculateADX(candles, 14).at(-1);
  const adx = adxObj?.adx || 0;

  const supertrend = calculateSuperTrend(candles).at(-1);
  const macdHist = calculateMACDHistogram(close).at(-1);
  const volumeSpike = calculateVolumeSpike(volumes);

  const price = close.at(-1);
  const canTrade = !lastTradeTime || ((currentTime - lastTradeTime) >= 3 * 30 * 60 * 1000);

  const trendUp = price > ema200;
  const longCond =
    ema9 > ema25 &&
    rsi > 53 &&
    adx > 18 &&
    supertrend === true &&
    macdHist > 0 &&
    trendUp &&
    volumeSpike;

  const shortCond =
    ema9 < ema25 &&
    rsi < 47 &&
    adx > 18 &&
    supertrend === false &&
    macdHist < 0 &&
    !trendUp &&
    volumeSpike;

  logger.info(`EMA9: ${ema9.toFixed(4)}, EMA25: ${ema25.toFixed(4)}, EMA200: ${ema200.toFixed(4)}, RSI: ${rsi.toFixed(2)}, ADX: ${adx.toFixed(2)}`);
  logger.info(`SuperTrend: ${supertrend}, MACD Hist: ${macdHist.toFixed(4)}, VolSpike: ${volumeSpike}, canTrade: ${canTrade}`);

  let signal = null;
  if (longCond && canTrade) signal = 'LONG';
  else if (shortCond && canTrade) signal = 'SHORT';

  const reentry = !signal && lastTradeDirection && (longCond || shortCond);
  if (signal) logger.info(`✅ Segnale V10 attivo: ${signal}`);
  else if (reentry) logger.info(`🔁 Reentry V10: ${lastTradeDirection}`);
  else logger.info('🚫 Nessun segnale valido (V10).');

  return {
    signal,
    reentry: reentry ? lastTradeDirection : null,
    indicators: { ema9, ema25, ema200, rsi, adx, supertrend, macdHist, volumeSpike }
  };
}

module.exports = { analyzeSignalV10 };
