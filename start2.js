// start2.js — Avvio bot Bybit Futures + Telegram

const { spawn, exec } = require('child_process');

// 🕒 Avvia subito il fetch delle coppie da Bybit
exec('node fetchBybitPairs.js', (err, stdout, stderr) => {
  if (err) return console.error('❌ Errore fetchBybitPairs:', err.message);
  console.log(stdout);
});

// 🕒 Ogni 12 ore aggiorna le coppie Bybit
setInterval(() => {
  exec('node fetchBybitPairs.js', (err, stdout, stderr) => {
    if (err) return console.error('❌ Errore fetchBybitPairs:', err.message);
    console.log(stdout);
  });
}, 12 * 60 * 60 * 1000); // ogni 12 ore

// 🧠 Funzione per avviare uno script separato
function runScript(name) {
  const child = spawn('node', [name], { stdio: 'inherit' });

  child.on('error', (err) => {
    console.error(`❌ Errore nell'avviare ${name}:`, err.message);
  });

  child.on('exit', (code) => {
    console.log(`📦 ${name} terminato con codice ${code}`);
  });
}

// ▶️ Avvio moduli principali
console.log('🚀 Avvio bot AI: Bybit FUTURES + Telegram...');

runScript('bybitFuturesExecutor.js'); // 📈 Analisi e trade futures
runScript('telegramBot.js');          // 🤖 Bot Telegram
