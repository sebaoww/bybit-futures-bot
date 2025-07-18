// ✅ Nuova versione completa e aggiornata di telegramBot.js per Binance
console.log('✅ Avvio telegramBot.js...');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const Binance = require('binance-api-node').default;
const { RestClientV5 } = require('bybit-api'); // 👈 AGGIUNGILA QUI se manca
const { getConfig, loadDynamic, saveDynamic } = require('./conf');
require('dotenv').config();

if (!globalThis.crypto) {
  globalThis.crypto = require('crypto');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const binance = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET
});

const statePath = './.botstate.json';
const statsPath = './stats.json';
const appLogPath = path.join(__dirname, 'app.log');
const entryPath = './entryPrices.json';

let botState = { active: true };
if (fs.existsSync(statePath)) {
  botState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}


function getLastTrade(logFile) {
  try {
    const logData = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const last = logData.reverse().find(line =>
      line.includes('CLOSE') || line.includes('SELL') || line.includes('BUY')
    );
    return last || '❌ Nessun trade chiuso trovato.';
  } catch (err) {
    return '❌ Errore lettura log.';
  }
}
function sendTelegramTradeStatus(pair, result) {
  const ema9 = result?.indicators?.ema9?.toFixed(4) || 'n/a';
  const ema25 = result?.indicators?.ema25?.toFixed(4) || 'n/a';
  const rsi = result?.indicators?.rsi?.toFixed(2) || 'n/a';
  const adx = result?.indicators?.adx?.toFixed(2) || 'n/a';

  let message = `> Scalping futures:\n📊 *${pair}*\n`;
  message += `EMA: ${ema9} vs ${ema25}\nRSI: ${rsi}\nADX: ${adx}\n`;

  if (result.signal) {
    message += `✅ *Segnale attivo*: ${result.signal}`;
  } else if (result.reentry) {
    message += `🔁 *Reentry*: ${result.reentry}`;
  } else {
    message += `❌ Nessun segnale valido.`;
  }

  bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
}


// /start
bot.start((ctx) => {
  ctx.reply('🤖 Benvenuto! Il bot Binance è attivo.');
});

// /status
bot.command('status', async (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  const config = getConfig();
  try {
    const account = await binance.accountInfo();
    const usdcBalance = account.balances.find(b => b.asset === 'USDC');
    const usdc = usdcBalance ? usdcBalance.free : '0.00';

    ctx.reply(`📊 Stato Bot Binance:
- Attivo: ${botState.active}
- Modalità: ${config.trading.liveMode ? 'LIVE 🔥' : 'DRY_RUN 🥪'}
- Saldo disponibile: ${usdc} USDC`);
  } catch (error) {
    ctx.reply(`❌ Errore Binance: ${error.message || 'Errore sconosciuto.'}`);
  }
});

// /strategy
bot.command('strategy', async (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  const config = getConfig();
  const dynamic = loadDynamic();
  const useSuperTrend = process.env.USE_SUPERTREND === 'true';
  const dryRun = process.env.DRY_RUN === 'true';
  const liveMode = config.trading.liveMode;

  const modeMessage = liveMode
    ? (dryRun ? '❗ LIVE_MODE: ON ma DRY_RUN: ON — simulazione attiva ⚠️' : 'LIVE 🔥')
    : 'DRY_RUN 🧪 (simulazione)';

  const msg = `⚙️ *Strategia attiva Binance*

🔁 Strategia: *v6 (SuperTrend Optional)*
📊 EMA Short: ${process.env.EMA_SHORT || 9}
📊 EMA Long: ${process.env.EMA_LONG || 25}
📈 RSI Period: ${process.env.RSI_PERIOD || 14}
📉 ATR Period: ${process.env.ATR_PERIOD || 14}
🧠 SuperTrend: *${useSuperTrend ? 'ATTIVO ✅' : 'DISATTIVO ❌'}*
🎯 Take Profit: ${dynamic.TAKE_PROFIT ?? process.env.TAKE_PROFIT}% 
🛑 Stop Loss: ${dynamic.STOP_LOSS ?? process.env.STOP_LOSS}%
🔂 Trailing Stop: ${process.env.TRAILING_STOP || 'n.d.'}%

📟 Modalità attiva: *${modeMessage}*`;

  ctx.reply(msg, { parse_mode: 'Markdown' });
});
// /fstrategy - Cambia strategia tra V9 e V10 dinamicamente
bot.command('fstrategy', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  // Inverti la strategia attiva
  config.USE_V10 = !config.USE_V10;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const activeStrategy = config.USE_V10 ? '🧠 V10 (Pro)' : '⚙️ V9 (Base)';
  ctx.reply(`✅ Strategia Bybit aggiornata:\nAttiva ora: *${activeStrategy}*`, {
    parse_mode: 'Markdown'
  });
});
// /fversion - Mostra la strategia attiva per Bybit Futures
bot.command('fversion', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const activeStrategy = config.USE_V10 ? '🧠 V10 (Pro)' : '⚙️ V9 (Base)';
  ctx.reply(`📌 Strategia attiva Bybit:\n*${activeStrategy}*`, {
    parse_mode: 'Markdown'
  });
});
// /fadmin - Riepilogo con bottoni inline per strategia Bybit
bot.command('fadmin', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const tp = config.TAKE_PROFIT ?? process.env.BYBIT_TP_PERCENT ?? 'n.d.';
  const sl = config.STOP_LOSS ?? process.env.BYBIT_SL_PERCENT ?? 'n.d.';
  const trailing = config.TRAILING_STOP ?? process.env.BYBIT_TRAILING_STOP ?? 'n.d.';
  const strategy = config.USE_V10 ? '🧠 V10 (Pro)' : '⚙️ V9 (Base)';
  const live = process.env.LIVE_MODE === 'true';
  const dry = process.env.DRY_RUN === 'true';

  let status = 'DRY_RUN 🧪';
  if (live && dry) status = 'LIVE + SIMULAZIONE ⚠️';
  else if (live && !dry) status = 'LIVE 🔥';

  const msg = `🛠️ *Riepilogo Strategia Bybit*

📌 Strategia: *${strategy}*
🎯 Take Profit: ${tp}%
🛑 Stop Loss: ${sl}%
🔃 Trailing Stop: ${trailing}%
📟 Modalità attiva: *${status}*`;

  ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔁 Cambia Strategia', callback_data: 'toggle_strategy' },
          { text: '📈 Posizioni', callback_data: 'show_positions' }
        ],
        [
          { text: '💰 PNL', callback_data: 'show_pnl' },
          { text: '📊 Statistiche', callback_data: 'show_stats' }
        ]
      ]
    }
  });
});

// /settp
bot.command('settp', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  const value = parseFloat(ctx.message.text.split(' ')[1]);
  if (isNaN(value) || value < 0.1 || value > 100) {
    return ctx.reply('❌ Valore non valido. Usa: /settp 2.5');
  }
  const config = loadDynamic();
  config.TAKE_PROFIT = value;
  saveDynamic(config);
  ctx.reply(`✅ Take Profit aggiornato a ${value}%`);
});

// /setsl
bot.command('setsl', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  const value = parseFloat(ctx.message.text.split(' ')[1]);
  if (isNaN(value) || value >= 0 || value < -100) {
    return ctx.reply('❌ Valore non valido. Usa: /setsl -1.5');
  }
  const config = loadDynamic();
  config.STOP_LOSS = value;
  saveDynamic(config);
  ctx.reply(`✅ Stop Loss aggiornato a ${value}%`);
});
// /fsettp
bot.command('fsettp', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  const value = parseFloat(ctx.message.text.split(' ')[1]);
  if (isNaN(value) || value < 0.1 || value > 100) {
    return ctx.reply('❌ Valore non valido. Usa: /fsettp 2.5');
  }

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  config.TAKE_PROFIT = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  ctx.reply(`✅ Take Profit Bybit aggiornato a ${value}%`);
});
// /ftrailing
bot.command('ftrailing', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  const value = parseFloat(ctx.message.text.split(' ')[1]);
  if (isNaN(value) || value < 0 || value > 100) {
    return ctx.reply('❌ Valore non valido. Usa: /ftrailing 0.75');
  }

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  config.TRAILING_STOP = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  ctx.reply(`✅ Trailing Stop Bybit aggiornato a ${value}%`);
});

// /fsetsl
bot.command('fsetsl', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  const value = parseFloat(ctx.message.text.split(' ')[1]);
  if (isNaN(value) || value >= 0 || value < -100) {
    return ctx.reply('❌ Valore non valido. Usa: /fsetsl -1.5');
  }

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  config.STOP_LOSS = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  ctx.reply(`✅ Stop Loss Bybit aggiornato a ${value}%`);
});
// /ftrailing - modifica trailing stop Bybit
bot.command('ftrailing', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  const value = parseFloat(ctx.message.text.split(' ')[1]);
  if (isNaN(value) || value < 0.1 || value > 10) {
    return ctx.reply('❌ Valore non valido. Usa: /ftrailing 0.75');
  }

  const configPath = './bybitDynamic.json';
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  config.TRAILING_STOP = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  ctx.reply(`✅ Trailing Stop Bybit aggiornato a ${value}%`);
});

// /on
bot.command('on', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  botState.active = true;
  fs.writeFileSync(statePath, JSON.stringify(botState));
  ctx.reply('✅ Bot attivato.');
});

// /off
bot.command('off', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  botState.active = false;
  fs.writeFileSync(statePath, JSON.stringify(botState));
  ctx.reply('⛔ Bot disattivato manualmente.');
});

// /panic
bot.command('panic', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  botState.active = false;
  fs.writeFileSync(statePath, JSON.stringify(botState));
  ctx.reply('🛑 PANIC: Bot disattivato immediatamente.');
});

// /stats
bot.command('stats', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  try {
    const stats = fs.existsSync(statsPath)
      ? JSON.parse(fs.readFileSync(statsPath, 'utf8'))
      : { buyCount: 0, sellCount: 0 };

    ctx.reply(`📊 *Statistiche Bot*
🟢 Buy totali: ${stats.buyCount || 0}
🔴 Sell totali: ${stats.sellCount || 0}`, { parse_mode: 'Markdown' });
  } catch {
    ctx.reply('❌ Statistiche non disponibili o danneggiate.');
  }
});

// /pnl
bot.command('pnl', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  try {
    const stats = fs.existsSync(statsPath)
      ? JSON.parse(fs.readFileSync(statsPath, 'utf8'))
      : { totalGain: 0 };

    ctx.reply(`💰 *PNL stimato:*
📈 Profitto totale: ${(stats.totalGain || 0).toFixed(2)} %`, { parse_mode: 'Markdown' });
  } catch {
    ctx.reply('❌ Impossibile calcolare il PNL (statistiche assenti o danneggiate).');
  }
});

// /positions
bot.command('positions', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  let positions = {};
  if (fs.existsSync(entryPath)) {
    positions = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
  }

  const symbols = Object.keys(positions);
  if (symbols.length === 0) {
    return ctx.reply('📭 Nessuna posizione aperta al momento.');
  }

  let msg = `📌 *Posizioni aperte:*

`;

  for (const symbol of symbols) {
    const { entryPrice, quantity, timestamp } = positions[symbol];
    msg += `• ${symbol}
  📥 Entry: ${entryPrice}
  📦 Qty: ${quantity}
  🕒 ${new Date(timestamp).toLocaleString()}

`;
  }

  ctx.replyWithMarkdown(msg);
});
bot.command('fhelp', (ctx) => {
  const msg = `
🤖 *Comandi disponibili (Bybit Futures)*

/fstatus  - Mostra stato attuale (attivo/disattivo)
/fon      - Attiva il bot
/foff     - Disattiva il bot
/fverbose - Attiva/disattiva modalità analisi dettagliata
/fsettp   - Imposta nuovo valore TP (es: /fsettp 4)
/fsetsl   - Imposta nuovo valore SL (es: /fsetsl 1.2)
/fpnl     - Mostra profitti e perdite
/freset   - Resetta storico PnL
/last     - Ultimo trade eseguito
/frestart - Riavvia il bot manualmente

💡 Usa solo i comandi necessari!
  `;
  ctx.replyWithMarkdown(msg);
});


// /last
bot.command('last', async (ctx) => {
  const binanceLog = path.join(__dirname, 'trades.log');
  const bybitLog = path.join(__dirname, 'bybitTrades.log');

  const lastBinance = getLastTrade(binanceLog);
  const lastBybit = getLastTrade(bybitLog);

  const msg = `📦 *Ultimi trade chiusi:*\n\n` +
              `📉 *Binance:*\n\`${lastBinance}\`\n\n` +
              `📉 *Bybit:*\n\`${lastBybit}\``;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /fpositions - Posizioni aperte Bybit
bot.command('fpositions', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  const pathFutures = './bybitEntryPrices.json';
  let positions = {};
  if (fs.existsSync(pathFutures)) {
    positions = JSON.parse(fs.readFileSync(pathFutures, 'utf8'));
  }

  const symbols = Object.keys(positions);
  if (symbols.length === 0) {
    return ctx.reply('📭 Nessuna posizione futures aperta al momento (Bybit).');
  }

  let msg = `📌 *Bybit Futures - Posizioni aperte:*

`;

  for (const symbol of symbols) {
    const { entryPrice, quantity, type, timestamp } = positions[symbol];
    msg += `• ${symbol} (${type})
  📥 Entry: ${entryPrice}
  📦 Qty: ${quantity}
  🕒 ${new Date(timestamp).toLocaleString()}

`;
  }

  ctx.replyWithMarkdown(msg);
});

const bybit = new RestClientV5({
  key: process.env.BYBIT_API_KEY,
  secret: process.env.BYBIT_API_SECRET,
});

// /fstatus – verifica connessione API Bybit (FIXED)
bot.command('fstatus', async (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  try {
    const res = await bybit.getWalletBalance({ accountType: 'UNIFIED' });
    const coins = res.result?.list?.[0]?.coins || []; // ← CORRETTO
    const usdt = coins.find(c => c.coin === 'USDT');
    const available = usdt?.availableToWithdraw ?? usdt?.walletBalance ?? '0.00';

    ctx.reply(`📡 *Bybit API Status: OK*\n💰 Saldo disponibile: ${available} USDT`, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    ctx.reply(`❌ *Errore connessione API Bybit:*\n${err.message}`, {
      parse_mode: 'Markdown',
    });
  }
});
// ✅ /fverbose on/off
bot.command('fverbose', (ctx) => {
  const text = ctx.message.text.trim().toLowerCase();
  const args = text.split(' ');
  const arg = args[1];

  const state = loadBotState();

  if (arg === 'on') {
    state.verbose = true;
    saveBotState(state);
    ctx.reply('🔍 Modalità VERBOSE attivata ✅');
  } else if (arg === 'off') {
    state.verbose = false;
    saveBotState(state);
    ctx.reply('🔕 Modalità VERBOSE disattivata ❌');
  } else {
    ctx.reply('❓ Usa: /fverbose on oppure /fverbose off');
  }
});

// /fstats - Statistiche Bybit
bot.command('fstats', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  try {
    const stats = fs.existsSync('./bybitStats.json')
      ? JSON.parse(fs.readFileSync('./bybitStats.json', 'utf8'))
      : { longCount: 0, shortCount: 0, closedCount: 0 };

    ctx.reply(`📊 *Statistiche Bybit Futures*
📈 Long: ${stats.longCount || 0}
📉 Short: ${stats.shortCount || 0}
✅ Operazioni chiuse: ${stats.closedCount || 0}`, { parse_mode: 'Markdown' });
  } catch {
    ctx.reply('❌ Statistiche Bybit non disponibili.');
  }
});

// /fpnl - PNL Bybit
bot.command('fpnl', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;
  try {
    const stats = fs.existsSync('./bybitStats.json')
      ? JSON.parse(fs.readFileSync('./bybitStats.json', 'utf8'))
      : { totalGain: 0 };

    ctx.reply(`💰 *PNL Futures Bybit:*
📈 Profitto totale: ${(stats.totalGain || 0).toFixed(2)} %`, { parse_mode: 'Markdown' });
  } catch {
    ctx.reply('❌ Impossibile calcolare il PNL (bybitStats.json mancante o danneggiato).');
  }
});

// /fbalance - Saldo USDT su Bybit (aggiornato)
bot.command('fbalance', async (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  try {
    const res = await bybit.getWalletBalance({ accountType: 'UNIFIED' });
    const totalAvailable = res.result.list?.[0]?.totalAvailableBalance ?? '0.00';

    ctx.reply(`💰 *Saldo disponibile Bybit (USD):* ${totalAvailable} USD`, { parse_mode: 'Markdown' });
  } catch (err) {
    ctx.reply(`❌ Errore nel recupero del saldo Bybit: ${err.message}`);
  }
});
// /allpositions

bot.command('allpositions', (ctx) => {
  if (ctx.chat.id.toString() !== process.env.CHAT_ID) return;

  let msg = `📌 *Tutte le posizioni aperte:*\n\n`;

  // Binance
  if (fs.existsSync(entryPath)) {
    const positions = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
    const symbols = Object.keys(positions);
    if (symbols.length > 0) {
      msg += `📊 *Spot (Binance)*\n`;
      for (const symbol of symbols) {
        const { entryPrice, quantity, timestamp } = positions[symbol];
        msg += `• ${symbol}\n  📥 Entry: ${entryPrice}\n  📦 Qty: ${quantity}\n  🕒 ${new Date(timestamp).toLocaleString()}\n\n`;
      }
    } else {
      msg += `📊 *Spot (Binance)*\n📭 Nessuna posizione.\n\n`;
    }
  }

  // Bybit
  const pathFutures = './bybitEntryPrices.json';
  if (fs.existsSync(pathFutures)) {
    const positions = JSON.parse(fs.readFileSync(pathFutures, 'utf8'));
    const symbols = Object.keys(positions);
    if (symbols.length > 0) {
      msg += `📈 *Futures (Bybit)*\n`;
      for (const symbol of symbols) {
        const { entryPrice, quantity, type, timestamp } = positions[symbol];
        msg += `• ${symbol} (${type})\n  📥 Entry: ${entryPrice}\n  📦 Qty: ${quantity}\n  🕒 ${new Date(timestamp).toLocaleString()}\n\n`;
      }
    } else {
      msg += `📈 *Futures (Bybit)*\n📭 Nessuna posizione.\n`;
    }
  }

  ctx.replyWithMarkdown(msg);
});

// 📊 Comando per attivare la modalità verbose (ricevi tutti i segnali)
bot.command('verboseon', async (ctx) => {
  const botStatePath = './.botstate.json';
  if (fs.existsSync(botStatePath)) {
    const state = JSON.parse(fs.readFileSync(botStatePath, 'utf8'));
    state.verbose = true;
    fs.writeFileSync(botStatePath, JSON.stringify(state, null, 2));
    ctx.reply('🔔 VERBOSE_MODE attivato. Riceverai tutti i segnali anche se non validi.');
  } else {
    ctx.reply('❌ Stato bot non trovato.');
  }
});

// 📴 Comando per disattivare la modalità verbose
bot.command('verboseoff', async (ctx) => {
  const botStatePath = './.botstate.json';
  if (fs.existsSync(botStatePath)) {
    const state = JSON.parse(fs.readFileSync(botStatePath, 'utf8'));
    state.verbose = false;
    fs.writeFileSync(botStatePath, JSON.stringify(state, null, 2));
    ctx.reply('🔕 VERBOSE_MODE disattivato. Riceverai solo segnali con esecuzione reale.');
  } else {
    ctx.reply('❌ Stato bot non trovato.');
  }
});

// ✅ /frestart — Riavvia il bot (funziona su Railway/Render/autostart)
bot.command('frestart', (ctx) => {
  ctx.reply('♻️ Riavvio del bot in corso...');
  setTimeout(() => {
    process.exit(0); // Railway o Render lo riavvieranno automaticamente
  }, 1000);
});


bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const configPath = './bybitDynamic.json';

  switch (data) {
    case 'toggle_strategy':
      let config = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
        : {};
      config.USE_V10 = !config.USE_V10;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      const strategy = config.USE_V10 ? '🧠 V10 (Pro)' : '⚙️ V9 (Base)';
      await ctx.answerCbQuery();
      await ctx.reply(`✅ Strategia aggiornata: *${strategy}*`, { parse_mode: 'Markdown' });
      break;

    case 'show_positions':
      ctx.telegram.sendMessage(ctx.chat.id, '/fpositions');
      await ctx.answerCbQuery();
      break;

    case 'show_pnl':
      ctx.telegram.sendMessage(ctx.chat.id, '/fpnl');
      await ctx.answerCbQuery();
      break;

    case 'show_stats':
      ctx.telegram.sendMessage(ctx.chat.id, '/fstats');
      await ctx.answerCbQuery();
      break;

    default:
      await ctx.answerCbQuery('Comando non riconosciuto.');
  }
});


// Avvio bot
bot.launch().then(() => {
  console.log('🤖 Bot Telegram Binance attivo!');
  
 // ✅ Riepilogo posizioni Bybit all’avvio
 const pathFutures = './bybitEntryPrices.json';
 if (fs.existsSync(pathFutures)) {
   const positions = JSON.parse(fs.readFileSync(pathFutures, 'utf8'));
   const symbols = Object.keys(positions);
   if (symbols.length > 0) {
     let msg = `📌 *Bybit - Posizioni aperte all’avvio:*\n\n`;
     for (const symbol of symbols) {
       const { entryPrice, quantity, type, timestamp } = positions[symbol];
       msg += `• ${symbol} (${type})\n  📥 Entry: ${entryPrice}\n  📦 Qty: ${quantity}\n  🕒 ${new Date(timestamp).toLocaleString()}\n\n`;
     }
     bot.telegram.sendMessage(process.env.CHAT_ID, msg, { parse_mode: 'Markdown' });
   }
 }

}).catch(err => {
 console.error('❌ Errore Telegram bot:', err.message);
});