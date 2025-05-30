const fs = require('fs');
const path = require('path');
const { WebsocketClient, RestClientV5 } = require('bybit-api');
const { EMA, RSI, ADX } = require('technicalindicators');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { getConfig, loadDynamic } = require('./conf');
require('dotenv').config();
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto');
}
const logger = require('./logger'); // ✅ AGGIUNGILA QUI
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
  key: process.env.BYBIT_API_KEY,      // ✅ CHIAVE CORRETTA
  secret: process.env.BYBIT_API_SECRET
});
let botState = { active: true };
if (fs.existsSync(statePath)) {
  botState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

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

async function getCandles(symbol) {
  try {
    const res = await client.getKline({ category: 'linear', symbol, interval: '5', limit: 100 });
    return res.result.list.reverse().map(c => ({
      close: parseFloat(c[4]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
    }));
  } catch (e) {
    console.warn(`⚠️ Errore OHLC ${symbol}: ${e.message}`);
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
  
      const res = await client.submitOrder(orderParams); // ✅ ora usa i parametri corretti
  
      if (res.retCode === 0) {
        console.log(`✅ ORDINE ${side} ${pair} inviato con successo. ID: ${res.result.orderId}`);
        await sendTelegram(`✅ ORDINE INVIATO: ${side} ${pair}\nQty: ${rounded}\nPrezzo: ${price}`);
      } else {
        console.error(`❌ Errore ordine ${pair}: ${res.retMsg}`);
        await sendTelegram(`❌ ERRORE ordine ${side} ${pair}: ${res.retMsg}`);
      }
  
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
  
  async function executeFutures(pair, prices, entries, TP_PERCENT, SL_PERCENT, TRAILING_STOP_PERCENT, config, candles5m, candles30m) {
    const price = parseFloat(prices[pair]);
    if (!price || !botState.active) return;
  
    const entry = entries[pair];
    const trailingPercent = TRAILING_STOP_PERCENT;
  
    if (!entry && candles5m && candles30m) {
      const signalData = analyzeSignalV9(candles5m, candles30m, null, 0, Date.now());
if (!signalData.signal) return;
const signal = signalData.signal;

  
      const side = signal === 'LONG' ? 'Buy' : 'Sell';
  
      await placeOrder(pair, side, TRADE_AMOUNT, price);
      logTrade(`🟢 ${signal} ${pair} @ ${price}`);
      await sendTelegram(`📥 ${signal} ${pair} @ ${price} x${LEVERAGE}`);
      updateStats(signal);
  
      const { stepSize } = await getQtyPrecision(pair);
      const rawQty = (TRADE_AMOUNT * LEVERAGE / price);
      const factor = Math.pow(10, Math.floor(-Math.log10(stepSize)));
      const qty = Math.floor(rawQty * factor) / factor;
      const roundedQty = parseFloat(qty.toFixed(8));
  
      entries[pair] = {
        entryPrice: price,
        quantity: roundedQty,
        type: signal,
        trailingPeak: price,
        timestamp: new Date().toISOString()
      };
      saveEntries(entries);
    } else {
      let pnl;
      if (entry.type === 'LONG') {
        entry.trailingPeak = Math.max(entry.trailingPeak, price);
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
      } else if (entry.type === 'SHORT') {
        entry.trailingPeak = Math.min(entry.trailingPeak, price);
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
      }
    }
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

  async function run() {
    const config = getConfig('bybit');
  
    const tp = TP_PERCENT;
    const sl = SL_PERCENT;
  
    // ✅ Legge dinamico dal file JSON, fallback su .env
    const dynamic = fs.existsSync('./bybitDynamic.json')
    ? JSON.parse(fs.readFileSync('./bybitDynamic.json', 'utf8'))
    : {};
  const trailing = Number.isFinite(dynamic.TRAILING_STOP)
    ? dynamic.TRAILING_STOP
    : parseFloat(process.env.BYBIT_TRAILING_STOP || '2');
  
  
  
    console.log('📈 Avvio Bybit Futures Bot...');
await sendTelegram(
  `⚙️ Strategia attiva Bybit Futures\n\n` +
  `🔁 Strategia: v7 (Bollinger Bands)\n` +
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
      if (!price || !botState.active) {
        console.log(`⚠️ Skippato ${pair} — prezzo nullo o bot disattivo`);
        continue;
      }
  
      const entry = entries[pair];
      const candles5m = await client.getKline({
        category: 'linear',
        symbol: pair,
        interval: '5',
        limit: 100,
      });
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
  
      const formatted5m = formatCandles(candles5m);
      const formatted30m = formatCandles(candles30m);
  
      if (!entry) {
        const signalData = analyzeSignalV9(
          formatted5m,
          formatted30m,
          null,
          0,
          Date.now()
        );
  
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
            formatted5m,
            formatted30m
          );
        } else {
          console.log(`⚪ Nessun segnale valido per ${pair}`);
        }
      } else {
        console.log(`📊 ${pair} ha posizione aperta (${entry.type}) — controllo PNL...`);
        await executeFutures(
          pair,
          prices,
          entries,
          tp,
          sl,
          trailing,
          config,
          formatted5m,
          formatted30m
        );
      }
    }
  
    console.log('⏱️ Attesa 5 minuti per la prossima analisi...\n');
  }
  setInterval(run, 5 * 60 * 1000);
  run();
    
