// indicators.js aggiornato con Bollinger Bands

const { EMA, RSI, ADX } = require('technicalindicators');

function calculateEMA(closes, period) {
  return EMA.calculate({ period, values: closes });
}

function calculateRSI(closes, period) {
  return RSI.calculate({ period, values: closes });
}

function calculateADX(candles, period = 14) {
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);
  return ADX.calculate({ period, high, low, close });
}

function calculateSuperTrend(candles, multiplier = 2, period = 10) {
  const hl2 = candles.map(c => (c.high + c.low) / 2);
  const atr = calculateATR(candles, period);
  const superTrend = [];

  let finalUpperBand = 0;
  let finalLowerBand = 0;
  let trend = true; // true = uptrend, false = downtrend

  for (let i = 0; i < candles.length; i++) {
    const upperBand = hl2[i] + multiplier * atr[i];
    const lowerBand = hl2[i] - multiplier * atr[i];

    if (i === 0) {
      finalUpperBand = upperBand;
      finalLowerBand = lowerBand;
      superTrend.push({ value: lowerBand, trend: true });
    } else {
      if (candles[i - 1].close > finalUpperBand) {
        trend = true;
      } else if (candles[i - 1].close < finalLowerBand) {
        trend = false;
      }

      finalUpperBand = trend
        ? Math.min(upperBand, finalUpperBand)
        : upperBand;
      finalLowerBand = trend
        ? lowerBand
        : Math.max(lowerBand, finalLowerBand);

      const value = trend ? finalLowerBand : finalUpperBand;
      superTrend.push({ value, trend });
    }
  }

  return superTrend;
}

function calculateATR(candles, period = 14) {
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
    trs.push(tr);
  }

  const atr = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) {
      atr.push(NaN);
    } else if (i === period - 1) {
      const sum = trs.slice(0, period).reduce((a, b) => a + b, 0);
      atr.push(sum / period);
    } else {
      atr.push((atr[atr.length - 1] * (period - 1) + trs[i]) / period);
    }
  }

  atr.unshift(NaN); // align with original array length
  return atr;
}

function calculateBollingerBands(closes, period = 20, dev = 2) {
  const sma = closes.map((_, i, arr) => {
    if (i < period - 1) return NaN;
    const slice = arr.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });

  const std = closes.map((_, i, arr) => {
    if (i < period - 1) return NaN;
    const slice = arr.slice(i - period + 1, i + 1);
    const avg = sma[i];
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / period;
    return Math.sqrt(variance);
  });

  const upper = sma.map((s, i) => s + dev * std[i]);
  const lower = sma.map((s, i) => s - dev * std[i]);

  return { upper, lower };
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateADX,
  calculateATR,
  calculateSuperTrend,
  calculateBollingerBands
};
