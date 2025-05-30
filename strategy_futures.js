// strategy_futures.js - Strategia V9.2 sicura con fallback
const logger = require('./logger');
const { calculateEMA, calculateRSI, calculateADX, calculateBollingerBands } = require('./indicators');

function analyzeSignalV9(candles5m, _unused, lastTradeDirection = null, lastTradeTime = 0, currentTime = 0) {
  const close = candles5m.map(c => c.close);
  const high = candles5m.map(c => c.high);
  const low = candles5m.map(c => c.low);

  const ema9 = Number(calculateEMA(close, 9).at(-1)) || 0;
  const ema25 = Number(calculateEMA(close, 25).at(-1)) || 0;
  const rsi = Number(calculateRSI(close, 14).at(-1)) || 0;
  const adx = Number(calculateADX(high, low, close, 14).at(-1)) || 0;

  const bb = calculateBollingerBands(close, 20, 2);
  const bbUpper = Number(bb.upper?.at(-1)) || 0;
  const bbLower = Number(bb.lower?.at(-1)) || 0;
  const price = Number(close.at(-1)) || 0;

  const bbLong = price < bbUpper;
  const bbShort = price > bbLower;

  const canTrade = !lastTradeTime || ((currentTime - lastTradeTime) >= 3 * 5 * 60 * 1000); // 15 min

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
