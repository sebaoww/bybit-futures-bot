// start2.js — Avvio bot Bybit Futures + Telegram

const { spawn, exec } = require('child_process');

// ✅ Funzione per lanciare script con log chiaro
function runScript(name) {
  const child = spawn('node', [name], { stdio: 'inherit' });

  child.on('error', (err) => {
    console.error(`❌ Errore nell'avviare ${name}:`, err.message);
  });

  child.on('exit', (code) => {
    console.log(`📦 ${name} terminato con codice ${code}`);
  });
}

// 🚀 Avvio messaggi iniziali
console.log('\n🚀 Avvio bot AI: Bybit FUTURES + Telegram...\n');

// ▶️ Avvia subito il fetch delle top coppie da Bybit
exec('node fetchBybitPairs.js', (err, stdout, stderr) => {
  if (err) {
    console.error('❌ Errore fetchBybitPairs:', err.message);
  } else {
    console.log(stdout.trim());
    // ✅ Usa il file .cjs corretto
    runScript('bybitFuturesExecutor.cjs'); // 📈 Bot futures
    runScript('telegramBot.js');           // 🤖 Bot Telegram
  }
});

// ⏱️ Aggiorna le coppie Bybit ogni 12 ore
setInterval(() => {
  console.log('\n⏳ Aggiornamento programmato delle coppie Bybit...\n');
  exec('node fetchBybitPairs.js', (err, stdout, stderr) => {
    if (err) return console.error('❌ Errore fetchBybitPairs:', err.message);
    console.log(stdout.trim());
  });
}, 12 * 60 * 60 * 1000);
