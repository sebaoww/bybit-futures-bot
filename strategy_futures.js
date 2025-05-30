// strategy_futures.js - Strategia V7 per Bybit Futures

const { calculateEMA, calculateRSI, calculateADX, calculateBollingerBands } = require('./indicators');

function analyzeSignalV9(candles5m, candles30m, lastTradeDirection = null, lastTradeTime = 0, currentTime = 0) {
    const close5m = candles5m.map(c => c.close);
    const close30m = candles30m.map(c => c.close);
    const high5m = candles5m.map(c => c.high);
    const low5m = candles5m.map(c => c.low);

    // === INDICATORI BASE 5m ===
    const ema9_5m = calculateEMA(close5m, 9).at(-1);
    const ema25_5m = calculateEMA(close5m, 25).at(-1);
    const rsi_5m = calculateRSI(close5m, 14).at(-1);
    const adx_5m = calculateADX(high5m, low5m, close5m, 14).at(-1);
    const bb_5m = calculateBollingerBands(close5m, 20, 2);
    const bbUpper_5m = bb_5m.upper.at(-1);
    const bbLower_5m = bb_5m.lower.at(-1);
    const bbLong_5m = close5m.at(-1) < bbUpper_5m;
    const bbShort_5m = close5m.at(-1) > bbLower_5m;

    // === INDICATORI BASE 30m ===
    const ema9_30m = calculateEMA(close30m, 9).at(-1);
    const ema25_30m = calculateEMA(close30m, 25).at(-1);
    const rsi_30m = calculateRSI(close30m, 14).at(-1);
    const adx_30m = calculateADX(
        candles30m.map(c => c.high),
        candles30m.map(c => c.low),
        close30m,
        14
    ).at(-1);

    // === Condizioni finali ===
    const longCond = (
        ema9_5m > ema25_5m &&
        rsi_5m > 53 &&
        adx_5m > 18 &&
        bbLong_5m &&
        ema9_30m > ema25_30m &&
        rsi_30m > 50 &&
        adx_30m > 18
    );

    const shortCond = (
        ema9_5m < ema25_5m &&
        rsi_5m < 47 &&
        adx_5m > 18 &&
        bbShort_5m &&
        ema9_30m < ema25_30m &&
        rsi_30m < 50 &&
        adx_30m > 18
    );

    // === Anti-spam: almeno 3 candele dopo l’ultimo trade ===
    const minBarsGap = 3;
    const canTrade = !lastTradeTime || ((currentTime - lastTradeTime) >= minBarsGap * 5 * 60 * 1000);

    let signal = null;
    if (longCond && canTrade) signal = 'LONG';
    else if (shortCond && canTrade) signal = 'SHORT';

    // === Reentry automatico ===
    const reentry = (!signal && lastTradeDirection && (longCond || shortCond));

    return {
        signal,
        reentry: reentry ? lastTradeDirection : null,
        indicators: { ema9_5m, ema25_5m, rsi_5m, adx_5m, bbUpper_5m, bbLower_5m }
    };
}

module.exports = { analyzeSignalV9 };
