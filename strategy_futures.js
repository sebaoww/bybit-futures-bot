// strategy_futures.js - Strategia V9.2 per 30 minuti
const logger = require('./logger');
const { calculateEMA, calculateRSI, calculateADX, calculateBollingerBands } = require('./indicators');

function analyzeSignalV9(candles, _unused = null, lastTradeDirection = null, lastTradeTime = 0, currentTime = 0) {
  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);

  const ema9 = calculateEMA(close, 9).at(-1);
  const ema25 = calculateEMA(close, 25).at(-1);
  const rsi = calculateRSI(close, 14).at(-1);
  const adxObj = calculateADX(candles, 14).at(-1);
  const adx = adxObj?.adx || 0;

  const bb = calculateBollingerBands(close, 20, 2);
  const price = close.at(-1);
  const bbLong = price < bb.upper.at(-1);
  const bbShort = price > bb.lower.at(-1);

  const canTrade = !lastTradeTime || ((currentTime - lastTradeTime) >= 3 * 30 * 60 * 1000); // 3 candele da 30m

  const longCond = ema9 > ema25 && rsi > 53 && adx > 18 && bbLong;
  const shortCond = ema9 < ema25 && rsi < 47 && adx > 18 && bbShort;

  logger.info(`🔍 EMA9: ${ema9.toFixed(6)}, EMA25: ${ema25.toFixed(6)}, RSI: ${rsi.toFixed(2)}, ADX: ${adx.toFixed(2)}`);
  logger.info(`📊 BB Long: ${bbLong}, BB Short: ${bbShort}, Trade OK: ${canTrade}`);
  
  let signal = null;
  if (longCond && canTrade) signal = 'LONG';
  else if (shortCond && canTrade) signal = 'SHORT';

  const reentry = !signal && lastTradeDirection && (longCond || shortCond);
  if (signal) logger.info(`✅ Segnale attivo: ${signal}`);
  else if (reentry) logger.info(`🔁 Reentry: ${lastTradeDirection}`);
  else logger.info('🚫 Nessun segnale.');

  return {
    signal,
    reentry: reentry ? lastTradeDirection : null,
    indicators: { ema9, ema25, rsi, adx }
  };
}

module.exports = { analyzeSignalV9 };
