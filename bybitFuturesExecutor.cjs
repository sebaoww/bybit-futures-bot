const fs = require('fs');
const { WebsocketClient, RestClientV5 } = require('bybit-api');
const { EMA, RSI, ADX } = require('technicalindicators');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { getConfig, loadDynamic } = require('./conf');
require('dotenv').config();

if (!globalThis.crypto) {
  globalThis.crypto = require('crypto');
}
const { writeDebugLog } = require('./debugLogger');
 
const logger = require('./logger');

const { analyzeSignalV9 } = require('./strategy_futures');
const { analyzeSignalV10 } = require('./strategy_futures_v10'); // ✅ nuova strategia V10
const LIVE_MODE = process.env.LIVE_MODE === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';

const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;
const TRADE_AMOUNT = parseFloat(process.env.BINANCE_TRADE_AMOUNT || '10');
const LEVERAGE = parseInt(process.env.LEVERAGE || '3');
const pairs = require('./futuresPairs');
const TP_PERCENT = parseFloat(process.env.BYBIT_TP_PERCENT || '5');
const SL_PERCENT = parseFloat(process.env.BYBIT_SL_PERCENT || '3');
const TRAILING_STOP_PERCENT = parseFloat(process.env.BYBIT_TRAILING_STOP || '2');

const entryPath = './bybitEntryPrices.json';
const logPath = './bybitTrades.log';
const statsPath = './bybitStats.json';
const statePath = './.botstate.json';

console.log('🔑 API Key in uso (Bybit):', process.env.BYBIT_API_KEY);

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY,
  secret: process.env.BYBIT_API_SECRET
});
// ✅ Funzione per ottenere i prezzi delle coppie
const fetchPrices = async (symbols) => {
  const response = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
  const data = await response.json();
  const tickers = data.result.list;

  const prices = {};
  for (const symbol of symbols) {
    const ticker = tickers.find(t => t.symbol === symbol);
    if (ticker) {
      prices[symbol] = parseFloat(ticker.lastPrice);
    }
  }

  return prices;
};

// ✅ Carica lo stato del bot
let botState = { active: true, verbose: false };
if (fs.existsSync(statePath)) {
  botState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

const VERBOSE_MODE = botState.verbose === true;

function loadEntries() {
  try {
    return JSON.parse(fs.readFileSync(entryPath));
  } catch {
    return {};
  }
}

function saveEntries(data) {
  fs.writeFileSync(entryPath, JSON.stringify(data, null, 2));
}

function logTrade(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

function updateStats(type, gain = 0) {
  let stats = { longCount: 0, shortCount: 0, closedCount: 0, totalGain: 0 };
  if (fs.existsSync(statsPath)) {
    stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  }
  if (type === 'LONG') stats.longCount += 1;
  if (type === 'SHORT') stats.shortCount += 1;
  if (type === 'CLOSE') stats.closedCount += 1;
  stats.totalGain += gain;
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

async function sendTelegram(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
  });
}
async function getCandles(symbol, interval = '30') {
  try {
    const now = Date.now();
    const msPerCandle = interval === '1' ? 60_000 :
                        interval === '5' ? 300_000 :
                        interval === '15' ? 900_000 :
                        interval === '30' ? 1800_000 :
                        interval === '60' ? 3600_000 : 1800_000;

    const start = now - msPerCandle * 210;

    const res = await client.getKline({
      category: 'linear',
      symbol,
      interval,
      start,
      limit: 200
    });

    return res.result.list.reverse().map(c => ({
      timestamp: +c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  } catch (e) {
    console.warn(`⚠️ Errore OHLC ${symbol} [${interval}m]: ${e.message}`);
    return [];
  }
}




async function getQtyPrecision(pair) {
    try {
      const res = await client.getInstrumentsInfo({ category: 'linear', symbol: pair });
      const stepSize = parseFloat(res.result.list[0].lotSizeFilter.qtyStep);
      const precision = Math.floor(Math.log10(1 / stepSize));
      return { precision, stepSize };
    } catch (err) {
      console.error(`❌ Errore nel recupero precisione ${pair}:`, err.message);
      return { precision: 2, stepSize: 0.01 }; // fallback
    }
  }
  

  // FUNZIONE: invia un ordine Market su Bybit Futures
  async function placeOrder(pair, side, tradeAmountUSD, price) {
    try {
      const { stepSize } = await getQtyPrecision(pair);
      const rawQty = (TRADE_AMOUNT * LEVERAGE / price);
      const factor = Math.pow(10, Math.floor(-Math.log10(stepSize)));
      const qty = Math.floor(rawQty * factor) / factor;
      const rounded = parseFloat(qty.toFixed(8)); // Per sicurezza
  
      console.log(`🔎 Quantità calcolata per ${pair}: raw=${rawQty}, final=${rounded}`);
      console.log(`📤 Tentativo ordine ${side} ${pair} → qty: ${rounded}`);
  
      if (!LIVE_MODE) {
        console.log(`🟡 [SIMULAZIONE] Ordine ${side} ${pair} qty: ${rounded} PREZZO: ${price}`);
        await sendTelegram(`🟡 [SIMULAZIONE] ${side} ${pair} — qty: ${rounded} @ ${price}`);
        return { simulated: true, quantity: rounded };
      }
  
      if (rounded <= 0) {
        console.warn(`⚠️ Quantità troppo bassa per ${pair}, ordine non inviato.`);
        await sendTelegram(`⚠️ Impossibile inviare ordine ${pair}: quantità troppo bassa (${rounded})`);
        return;
      }
  
      const orderParams = {
        category: 'linear',
        symbol: pair,
        side,
        orderType: 'Market',
        qty: rounded.toString(),
        timeInForce: 'GoodTillCancel',
        reduceOnly: false,
        takeProfit: (side === 'Buy')
          ? (price * (1 + TP_PERCENT / 100)).toFixed(4)
          : (price * (1 - TP_PERCENT / 100)).toFixed(4),
        stopLoss: (side === 'Buy')
          ? (price * (1 - SL_PERCENT / 100)).toFixed(4)
          : (price * (1 + SL_PERCENT / 100)).toFixed(4),
        tpTriggerBy: 'LastPrice',
        slTriggerBy: 'LastPrice'
      };
      
  
      console.log('📦 Parametri ordine:', JSON.stringify(orderParams, null, 2));
  
      const res = await client.submitOrder(orderParams);
  
      console.log('📬 Risultato completo Bybit:', JSON.stringify(res, null, 2));
       
       // 🧪 Controllo specifico TP/SL
       const tp = res?.result?.takeProfit;
       const sl = res?.result?.stopLoss;

       if (tp && sl) {
       console.log(`🎯 TP confermato: ${tp} | 🛑 SL confermato: ${sl}`);
       } else {
       console.warn('⚠️ TP/SL non confermati nella risposta di Bybit');
       }      

      if (res.retCode === 0) {
        console.log(`✅ ORDINE ${side} ${pair} inviato con successo. ID: ${res.result.orderId}`);
        await sendTelegram(`✅ ORDINE INVIATO: ${side} ${pair}\nQty: ${rounded}\nPrezzo: ${price}`);
        return { ...res, quantity: rounded }; // ✅ include qty usata
      } else {
        console.error(`❌ Errore ordine ${pair}: ${res.retMsg}`);
        await sendTelegram(`❌ ERRORE ordine ${side} ${pair}: ${res.retMsg}`);
        return res; // 👈 ritorna comunque per il debug!
      }
    } catch (err) {
      console.error(`❌ Errore critico su ${side} ${pair}:`, err.message);
      await sendTelegram(`❌ ERRORE CRITICO ${side} ${pair}: ${err.message}`);
    }
  }
  
  
// Chiude una posizione aperta su Bybit Futures con precisione qty automatica
async function closeOrder(pair, side, qty) {
    try {
      const { precision, stepSize } = await getQtyPrecision(pair);
      const factor = Math.pow(10, Math.floor(-Math.log10(stepSize)));
      const adjustedQty = Math.floor(qty * factor) / factor;
      const roundedQty = parseFloat(adjustedQty.toFixed(8));
  
      if (!roundedQty || roundedQty <= 0 || isNaN(roundedQty)) {
        console.warn(`⚠️ Quantità non valida per ${pair}: ${roundedQty}`);
        await sendTelegram(`⚠️ Errore chiusura ${pair}: quantità non valida (${roundedQty})`);
        return;
      }
  
      console.log(`📤 Tentativo CHIUSURA ${side} ${pair} → qty: ${roundedQty}`);
      if (!LIVE_MODE) {
        console.log(`🟡 [SIMULAZIONE] Chiusura ${side} ${pair} qty: ${roundedQty}`);
        await sendTelegram(`🟡 [SIMULAZIONE] CHIUSURA ${side} ${pair} — qty: ${roundedQty}`);
        return { simulated: true };
      }
      
      const orderParams = {
        category: 'linear',
        symbol: pair,
        side,
        orderType: 'Market',
        qty: roundedQty.toString(),
        timeInForce: 'GoodTillCancel',
        reduceOnly: true
      };
  
      console.log('📦 Parametri chiusura:', JSON.stringify(orderParams, null, 2));
  
      const res = await client.submitOrder(orderParams);

      if (res.retMsg.includes("position is zero")) {
        console.warn(`ℹ️ Posizione già chiusa per ${pair}, nessuna azione necessaria.`);
        return;
      }
      
  
      if (res.retCode === 0) {
        console.log(`✅ CHIUSURA ${side} ${pair} riuscita. ID: ${res.result.orderId}`);
      } else {
        console.error(`❌ Errore chiusura ${pair}: ${res.retMsg}`);
        await sendTelegram(`❌ ERRORE chiusura ${side} ${pair}: ${res.retMsg}`);
      }
    } catch (err) {
      console.error(`❌ Errore critico in chiusura ${side} ${pair}:`, err.message);
      await sendTelegram(`❌ ERRORE CRITICO CHIUSURA ${side} ${pair}: ${err.message}`);
    }
  }
  


// ✅ Funzione principale di esecuzione trade
async function executeFutures(pair, prices, entries, tp, sl, trailing, config, candles, signalData = null) {
  const price = parseFloat(prices[pair]);
  if (!price || !botState.active) {
    console.warn(`⚠️ Prezzo non disponibile o bot disattivo per ${pair}`);
    return;
  }

  const entry = entries[pair];
  const trailingPercent = TRAILING_STOP_PERCENT;

  console.log(`🔍 Stato entry per ${pair}:`, entry ? '✅ Esiste' : '❌ Non definita');
  console.log(`🕯️ Candles disponibili: ${Array.isArray(candles)}, lunghezza: ${candles?.length || 0}`);

  // ✅ Se NON c'è una posizione attiva, esegui il trade
  if (!entry && signalData && signalData.signal) {
    const signal = signalData.signal;
    const side = signal === 'LONG' ? 'Buy' : 'Sell';

    console.log(`📤 Esecuzione ordine ${side} per ${pair} a ${price} USDT`);

    const orderResult = await placeOrder(pair, side, TRADE_AMOUNT, price);
    if (!orderResult) return;
    if (orderResult.simulated) return;

    if (orderResult.retCode !== 0) {
      await sendTelegram(`❌ Ordine ${side} fallito per ${pair}: ${orderResult?.retMsg || 'Errore sconosciuto'}`);
      return;
    }

    const roundedQty = orderResult.quantity || 0;
    entries[pair] = {
      entryPrice: price,
      quantity: roundedQty,
      type: side === 'Buy' ? 'LONG' : 'SHORT',
      trailingPeak: price,
      timestamp: Date.now()
    };
    saveEntries(entries);

    await sendTelegram(`✅ Nuova posizione ${signal} aperta su ${pair}\n💰 Prezzo: ${price}\n📦 Quantità: ${roundedQty}\n📈 Tipo: ${signal}`);

    // ✅ Imposta trailing stop direttamente su Bybit
    try {
      const trailingValue = (price * (TRAILING_STOP_PERCENT / 100)).toFixed(4);
      await client.setTradingStop({
        category: 'linear',
        symbol: pair,
        trailingStop: trailingValue
      });
      console.log(`🔃 Trailing Stop impostato per ${pair} → ${trailingValue}`);
      await sendTelegram(`🔃 Trailing Stop impostato per ${pair}: ${trailingValue}`);
    } catch (e) {
      console.warn(`⚠️ Errore impostazione trailing stop per ${pair}: ${e.message}`);
      await sendTelegram(`⚠️ Errore trailing stop ${pair}: ${e.message}`);
    }

    logTrade(`🟢 ${signal} ${pair} @ ${price}`);
    await sendTelegram(`📥 ${signal} ${pair} @ ${price} x${LEVERAGE}`);
    updateStats(signal);
    return;
  }

  // ✅ Se esiste già una posizione aperta: gestione con TP dinamici e trailing
  if (entry && entry.type) {
    await handleOpenPosition(pair, price, entry, entries, trailing, tp, sl);
  } else {
    console.warn(`⚠️ Nessuna entry o segnale valido per ${pair}, nessun ordine eseguito.`);
  }
}
async function run() {
  console.log('🚨 run() eseguita');
  const config = getConfig('bybit');
  console.log('🧪 DEBUG MODE attivo');
  console.log('LIVE_MODE:', LIVE_MODE, '| DRY_RUN:', DRY_RUN);
  console.log('Bot attivo:', botState.active);

  const dynamic = fs.existsSync('./bybitDynamic.json')
    ? JSON.parse(fs.readFileSync('./bybitDynamic.json', 'utf8'))
    : {};

  const tp = Number.isFinite(dynamic.BYBIT_TP_PERCENT) ? dynamic.BYBIT_TP_PERCENT : parseFloat(process.env.BYBIT_TP_PERCENT || '3');
  const sl = Number.isFinite(dynamic.BYBIT_SL_PERCENT) ? dynamic.BYBIT_SL_PERCENT : parseFloat(process.env.BYBIT_SL_PERCENT || '1.5');
  const trailing = Number.isFinite(dynamic.BYBIT_TRAILING_STOP) ? dynamic.BYBIT_TRAILING_STOP : parseFloat(process.env.BYBIT_TRAILING_STOP || '2');

  const prices = await fetchPrices(pairs);

  const entries = loadEntries();

  for (const pair of pairs) {
    logger.section(`📈 BYBIT FUTURES ─ [${pair}]`);
    const price = parseFloat(prices[pair]);
    const entry = entries[pair];

    if (!price || !botState.active) continue;

    const candles = await getCandles(pair, '30');
    if (candles.length < 30) continue;

    const formattedCandles = candles.map(c => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    const volumes = candles.map(c => c.volume);

    const useV10 = dynamic?.USE_V10 === true;
    const signalData = useV10
      ? analyzeSignalV10(formattedCandles, volumes, entry?.type, entry?.timestamp, Date.now())
      : analyzeSignalV9(formattedCandles, null, entry?.type, entry?.timestamp, Date.now());

    if (signalData.signal) {
      console.log(`✅ Segnale ${signalData.signal} rilevato per ${pair}`);
      await executeFutures(pair, prices, entries, tp, sl, trailing, config, formattedCandles, signalData);
    } else {
      console.log(`⚪ Nessun segnale valido per ${pair}`);
    }
  }

  console.log('⏱️ Attesa 5 minuti per la prossima analisi...\n');
}



module.exports = { run };

if (require.main === module || process.env.FORCE_RUN === 'true') {
  run();
  setInterval(run, 5 * 60 * 1000);
}

