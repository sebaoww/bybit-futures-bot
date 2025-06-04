// indicators_v10.js
const { EMA, RSI, ADX, MACD } = require('technicalindicators');

// ✅ EMA base (già compatibile)
function calculateEMA(values, period) {
  return EMA.calculate({ values, period });
}

// ✅ RSI base
function calculateRSI(values, period) {
  return RSI.calculate({ values, period });
}

// ✅ ADX con high/low/close
function calculateADX(candles, period) {
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);
  return ADX.calculate({ high, low, close, period });
}

// ✅ SuperTrend base
function calculateSuperTrend(candles, atrPeriod = 10, multiplier = 3) {
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);

  const tr = [];
  for (let i = 1; i < close.length; i++) {
    const h = high[i], l = low[i], c = close[i - 1];
    tr.push(Math.max(h - l, Math.abs(h - c), Math.abs(l - c)));
  }

  const atr = EMA.calculate({ values: tr, period: atrPeriod });
  const supertrend = [];

  for (let i = atrPeriod; i < close.length; i++) {
    const hl2 = (high[i] + low[i]) / 2;
    const upperBand = hl2 + multiplier * atr[i - atrPeriod];
    const lowerBand = hl2 - multiplier * atr[i - atrPeriod];

    const prevClose = close[i - 1];
    const prevTrend = supertrend.at(-1) ?? true;

    const isUptrend = prevClose > (prevTrend ? lowerBand : upperBand);
    supertrend.push(isUptrend);
  }

  // Padding per allineamento
  const padding = Array(candles.length - supertrend.length).fill(true);
  return [...padding, ...supertrend];
}

// ✅ MACD Histogram
function calculateMACDHistogram(values) {
  const macd = MACD.calculate({
    values,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  return macd.map(m => m.histogram);
}

// ✅ Volume Spike (controlla se ultimo volume > 2x media 20)
function calculateVolumeSpike(volumes, period = 20, multiplier = 2) {
  if (volumes.length < period + 1) return false;
  const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  const latest = volumes.at(-1);
  return latest > avg * multiplier;
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateADX,
  calculateSuperTrend,
  calculateMACDHistogram,
  calculateVolumeSpike
};
