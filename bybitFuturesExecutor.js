const fs = require('fs');
const { WebsocketClient, RestClientV5 } = require('bybit-api');
const { EMA, RSI, ADX } = require('technicalindicators');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { getConfig, loadDynamic } = require('./conf');
require('dotenv').config();

if (!globalThis.crypto) {
  globalThis.crypto = require('crypto');
}

const logger = require('./logger');
const { analyzeSignalV9 } = require('./strategy_futures');
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
    const res = await client.getKline({ category: 'linear', symbol, interval, limit: 100 });
    return res.result.list.reverse().map(c => ({
      close: parseFloat(c[4]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
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
        return { simulated: true };
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
        qty: rounded.toString(), // ✅ stringa come richiesto da Bybit
        timeInForce: 'GoodTillCancel',
        reduceOnly: false
      };
  
      console.log('📦 Parametri ordine:', JSON.stringify(orderParams, null, 2));
  
      const res = await client.submitOrder(orderParams);
  
      if (res.retCode === 0) {
        console.log(`✅ ORDINE ${side} ${pair} inviato con successo. ID: ${res.result.orderId}`);
        await sendTelegram(`✅ ORDINE INVIATO: ${side} ${pair}\nQty: ${rounded}\nPrezzo: ${price}`);
  
        // ✅ Salvataggio entry solo se ordine confermato
        const entries = loadEntries();
        const trailingPeak = side === 'Buy' ? price : price; // inizializza da prezzo attuale
        entries[pair] = {
          entryPrice: price,
          quantity: rounded,
          type: side === 'Buy' ? 'LONG' : 'SHORT',
          timestamp: Date.now(),
          trailingPeak
        };
        saveEntries(entries);
        return res;
      } else {
        console.error(`❌ Errore ordine ${pair}: ${res.retMsg}`);
        await sendTelegram(`❌ ERRORE ordine ${side} ${pair}: ${res.retMsg}`);
      }
  
      console.log('📬 Risultato ordine:', JSON.stringify(res, null, 2));
      return res;
  
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
  
  async function executeFutures(pair, prices, entries, TP_PERCENT, SL_PERCENT, TRAILING_STOP_PERCENT, config, candles30m) {
    const price = parseFloat(prices[pair]);
    if (!price || !botState.active) return;
  
    const entry = entries[pair];
    const trailingPercent = TRAILING_STOP_PERCENT;
    if (!entry && candles30m) {
      const signalData = analyzeSignalV9(candles30m, null, null, 0, Date.now());
      if (!signalData.signal) return;
    
      const signal = signalData.signal;
      const side = signal === 'LONG' ? 'Buy' : 'Sell';
    
  const orderResult = await placeOrder(pair, side, TRADE_AMOUNT, price);
if (!orderResult || orderResult.retCode !== 0) {
  console.warn(`⚠️ Ordine ${side} fallito per ${pair}.`);
  console.log('📬 Risposta Bybit:', JSON.stringify(orderResult, null, 2));
  await sendTelegram(`❌ Ordine ${side} fallito per ${pair}: ${orderResult?.retMsg || 'Errore sconosciuto'}`);
  return;
}

logTrade(`🟢 ${signal} ${pair} @ ${price}`);
await sendTelegram(`📥 ${signal} ${pair} @ ${price} x${LEVERAGE}`);
updateStats(signal);


// ✅ Solo qui calcoli qty e salvi l'entry
const { stepSize } = await getQtyPrecision(pair);
const rawQty = (TRADE_AMOUNT * LEVERAGE / price);
const factor = Math.pow(10, Math.floor(-Math.log10(stepSize)));
const qty = Math.floor(rawQty * factor) / factor;
const roundedQty = parseFloat(qty.toFixed(8));

entries[pair] = {
  entryPrice: price,
  quantity: roundedQty,
  type: side === 'Buy' ? 'LONG' : 'SHORT',
  trailingPeak: price,
  timestamp: Date.now()
};
saveEntries(entries);

logTrade(`🟢 ${signal} ${pair} @ ${price}`);
await sendTelegram(`📥 ${signal} ${pair} @ ${price} x${LEVERAGE}`);
updateStats(signal);

    
    } else if (entry && entry.type) {

     
    
      if (entry.type === 'LONG') {
        entry.trailingPeak = Math.max(entry.trailingPeak || price, price);
        const trailStop = entry.trailingPeak * (1 - trailingPercent / 100);
        pnl = ((price - entry.entryPrice) / entry.entryPrice) * 100 * LEVERAGE;
    
        if (price <= trailStop || pnl >= TP_PERCENT || pnl <= -SL_PERCENT) {
          await closeOrder(pair, 'Sell', entry.quantity);
          logTrade(`🔴 CLOSE ${pair} LONG @ ${price} PNL ${pnl.toFixed(2)}%`);
          await sendTelegram(
            `📊 *Operazione Bybit Futures (${entry.type.toUpperCase()})*\n` +
            `📈 Pair: ${pair}\n` +
            `📥 Entry: ${entry.entryPrice} — 📤 Exit: ${price}\n` +
            `📦 Qty: ${entry.quantity}\n` +
            `💰 PNL: ${pnl.toFixed(2)}%`,
            { parse_mode: 'Markdown' }
          );
    
          updateStats('CLOSE', pnl);
          delete entries[pair];
          saveEntries(entries);
        }
        let pnl;
      } else if (entry.type === 'SHORT') {
        entry.trailingPeak = Math.min(entry.trailingPeak || price, price);
        const trailStop = entry.trailingPeak * (1 + trailingPercent / 100);
        pnl = ((entry.entryPrice - price) / entry.entryPrice) * 100 * LEVERAGE;
    
        if (price >= trailStop || pnl >= TP_PERCENT || pnl <= -SL_PERCENT) {
          await closeOrder(pair, 'Buy', entry.quantity);
          logTrade(`🔴 CLOSE ${pair} SHORT @ ${price} PNL ${pnl.toFixed(2)}%`);
          await sendTelegram(
            `📊 *Operazione Bybit Futures (${entry.type.toUpperCase()})*\n` +
            `📈 Pair: ${pair}\n` +
            `📥 Entry: ${entry.entryPrice} — 📤 Exit: ${price}\n` +
            `📦 Qty: ${entry.quantity}\n` +
            `💰 PNL: ${pnl.toFixed(2)}%`,
            { parse_mode: 'Markdown' }
          );
    
          updateStats('CLOSE', pnl);
          delete entries[pair];
          saveEntries(entries);
        }
    
      } else {
        logger.warn(`⚠️ Entry per ${pair} con tipo sconosciuto: ${entry.type}`);
      }
    
    
    } else {
      logger.warn(`⚠️ Entry per ${pair} non definita. Skippato.`);
    }
    
  
async function getPrices() {
    try {
      const res = await client.getTickers({ category: 'linear' });
      const map = {};
  
      for (const t of res.result.list) {
        if (t.lastPrice && !isNaN(parseFloat(t.lastPrice))) {
          map[t.symbol] = parseFloat(t.lastPrice);
        }
      }
  
      return map;
    } catch (err) {
      console.error('❌ Errore nel recupero dei prezzi Bybit:', err.message);
      return {};
    }
  }  
  const ENABLE_ANALYSIS = process.env.ENABLE_ANALYSIS === 'true';
  if (!ENABLE_ANALYSIS) {
    console.log('🚫 Analisi disattivata da .env. Terminazione...');
    process.exit(0);
  }
  
  async function run() {
    const config = getConfig('bybit');
  
    // ✅ Legge dinamico dal file JSON, fallback su .env
    const dynamic = fs.existsSync('./bybitDynamic.json')
      ? JSON.parse(fs.readFileSync('./bybitDynamic.json', 'utf8'))
      : {};
  
    const tp = Number.isFinite(dynamic.BYBIT_TP_PERCENT)
      ? dynamic.BYBIT_TP_PERCENT
      : parseFloat(process.env.BYBIT_TP_PERCENT || '3');
  
    const sl = Number.isFinite(dynamic.BYBIT_SL_PERCENT)
      ? dynamic.BYBIT_SL_PERCENT
      : parseFloat(process.env.BYBIT_SL_PERCENT || '1.5');
  
    const trailing = Number.isFinite(dynamic.TRAILING_STOP)
      ? dynamic.TRAILING_STOP
      : parseFloat(process.env.BYBIT_TRAILING_STOP || '2');
  
  
  
    console.log('📈 Avvio Bybit Futures Bot...');
await sendTelegram(
  `⚙️ Strategia attiva Bybit Futures\n\n` +
  `🔁 Strategia: v9 (Grumpyshiba)\n` +
  `📈 Take Profit: ${tp}%\n` +
  `📉 Stop Loss: -${sl}%\n` +
  `🔂 Trailing Stop: ${trailing}%\n` +
  `📊 BollingerBand: ATTIVO ✅`
);
    const prices = await getPrices();
    const entries = loadEntries();
  
    // 🔔 Invio riepilogo posizioni aperte all'avvio
    const openPositions = Object.entries(entries);
    if (openPositions.length > 0) {
      let msg = `📂 Posizioni aperte rilevate (${openPositions.length}):\n`;
      for (const [pair, data] of openPositions) {
        msg += `• ${pair}: ${data.type} @ ${data.entryPrice} (${data.quantity})\n`;
      }
      await sendTelegram(msg);
    } else {
      await sendTelegram('✅ Nessuna posizione aperta rilevata all’avvio.');
    }
  
    for (const pair of pairs) {
      logger.section(`📈 BYBIT FUTURES ─ [${pair}]`);
      console.log(`🔍 Analizzando ${pair}...`);
      const price = parseFloat(prices[pair]);
      const entry = entries[pair]; // spostato subito dopo il prezzo
      
      if (!price || !botState.active) {
        console.log(`⚠️ Skippato ${pair} — prezzo nullo o bot disattivo`);
        continue;
      }
      
      if (entry && !entry.type) {
        logger.warn(`⚠️ Warning: ${pair} ha una entry ma manca 'type':`, JSON.stringify(entry));
      }
      
      
      const candles30m = await client.getKline({
        category: 'linear',
        symbol: pair,
        interval: '30',
        limit: 100,
      });
  
      const formatCandles = (list) =>
        list.result.list.reverse().map((c) => ({
          close: parseFloat(c[4]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
        }));
        
      const formatted30m = formatCandles(candles30m);
  
      if (!entry) {
        const signalData = analyzeSignalV9(
          formatted30m,
          null,
          null,
          0,
          Date.now()
        );
        
        if (VERBOSE_MODE) {
          const { signal, indicators } = signalData;
          const signalText = signal ? `📢 *Segnale ${signal}*` : '❌ Nessun segnale valido.';
          const verboseMsg = `📊 *${pair} [30m]*\n` +
                          `EMA: ${indicators.ema9?.toFixed(4)} vs ${indicators.ema25?.toFixed(4)}\n` +
                           `RSI: ${indicators.rsi?.toFixed(2)}\n` +
                           `ADX: ${indicators.adx?.toFixed(2)}\n` +
                           `${signalText}`;

          await sendTelegram(verboseMsg);
        }
        
        if (signalData.signal) {
          console.log(`✅ Segnale ${signalData.signal} rilevato per ${pair}`);
          await executeFutures(
            pair,
            prices,
            entries,
            tp,
            sl,
            trailing,
            config,
            null,            // 5m lo metti a null
            formatted30m     // solo 30m attivo
          );
          
        } else {
          console.log(`⚪ Nessun segnale valido per ${pair}`);
        }
      } else {
        console.log(`📊 ${pair} ha posizione aperta (${entry.type}) — controllo PNL...`);
        logger.info(`✅ Analisi completata. In attesa del prossimo ciclo...`);

        await executeFutures(
          pair,
          prices,
          entries,
          tp,
          sl,
          trailing,
          config,
          null,
          formatted30m
        );
      }
    }
  
    console.log('⏱️ Attesa 5 minuti per la prossima analisi...\n');
  }
  setInterval(run, 5 * 60 * 1000);
  run();
}
async function analyzeAndTrade() {
  const { trading } = getConfig('bybit');
  const pairs = require('./futuresPairs');
  const now = Date.now();

  for (const pair of pairs) {
    try {
      logger.info(`📊 Analisi della coppia: ${pair}...`);

      const klines5m = await fetchOHLC(pair, '5');
      const klines30m = await fetchOHLC(pair, '30');

      if (!klines5m || klines5m.length < 50 || !klines30m || klines30m.length < 50) {
        logger.warn(`⚠️ Dati insufficienti per ${pair}`);
        continue;
      }

      const signal = analyzeSignalV9(klines30m, klines5m);
      if (signal && ['LONG', 'SHORT'].includes(signal)) {
        logger.info(`📈 Segnale ${signal} per ${pair}`);
        await handleSignal(pair, signal, klines30m.at(-1).close);
      } else {
        logger.info(`⛔ Nessun segnale valido per ${pair}`);
      }

    } catch (err) {
      logger.error(`❌ Errore durante l’analisi di ${pair}: ${err.message}`);
    }
  }
}
// 📈 Funzione per ottenere dati OHLC da Bybit
const fetchOHLC = async (symbols, interval = '30') => {
  const results = {};

  for (const symbol of symbols) {
    try {
      const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=100`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.retCode === 0 && data.result?.list?.length > 0) {
        const candles = data.result.list.map(c => ({
          time: +c[0],
          open: +c[1],
          high: +c[2],
          low: +c[3],
          close: +c[4],
          volume: +c[5]
        }));
        results[symbol] = candles;
      } else {
        console.warn(`⚠️ Nessun dato OHLC per ${symbol}`);
      }
    } catch (err) {
      console.error(`❌ Errore OHLC ${symbol}: ${err.message}`);
    }
  }

  return results;
};

async function run() {
  const timestamp = new Date().toISOString();
  console.log(`🚀 Analisi avviata: ${timestamp}`);

  const config = getConfig('bybit');
  const { trading } = config;
  const tp = trading.takeProfitPercentage;
  const sl = trading.stopLossPercentage;
  const trailing = trading.trailingStopPercent;

  const entries = loadEntries();
  const prices = await fetchPrices(pairs);

  const formatted30m = await fetchOHLC(pairs, '30');

  for (const pair of pairs) {
    const entry = entries[pair];
    const price = prices[pair];

    if (!price || !formatted30m[pair]) {
      console.warn(`⛔ Dati mancanti per ${pair}, skippato.`);
      continue;
    }

    if (!entry) {
      const signal = analyzeSignalV9(formatted30m[pair]);
      if (signal && signal.side) {
        await openPosition(pair, signal.side, price, config, entries);
      } else {
        console.log(`🟡 Nessun segnale valido per ${pair}.`);
      }
    } else {
      let pnl;
      if (entry.type === 'LONG') {
        entry.trailingPeak = Math.max(entry.trailingPeak, price);
        const trailStop = entry.trailingPeak * (1 - trailing / 100);
        pnl = ((price - entry.entryPrice) / entry.entryPrice) * 100 * LEVERAGE;

        if (price <= trailStop || pnl >= tp || pnl <= -sl) {
          await closeOrder(pair, 'Sell', entry.quantity);
          delete entries[pair];
          saveEntries(entries);
        }
      } else if (entry.type === 'SHORT') {
        entry.trailingPeak = Math.min(entry.trailingPeak, price);
        const trailStop = entry.trailingPeak * (1 + trailing / 100);
        pnl = ((entry.entryPrice - price) / entry.entryPrice) * 100 * LEVERAGE;

        if (price >= trailStop || pnl >= tp || pnl <= -sl) {
          await closeOrder(pair, 'Buy', entry.quantity);
          delete entries[pair];
          saveEntries(entries);
        }
      }
    }
  }

  console.log('⏱️ Attesa 5 minuti per la prossima analisi...\n');
}

setInterval(run, 5 * 60 * 1000);
run();
