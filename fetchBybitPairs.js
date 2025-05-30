const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const savePath = path.join(__dirname, 'futuresPairs.js');

async function fetchTopBybitPairs() {
  try {
    const response = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
    const data = await response.json();

    const usdtPairs = data.result.list
      .filter(p => p.symbol.endsWith('USDT') && parseFloat(p.turnover24h) > 100000)
      .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
      .slice(0, 20)
      .map(p => `"${p.symbol}"`);

    const content = `module.exports = [\n  ${usdtPairs.join(',\n  ')}\n];\n`;

    fs.writeFileSync(savePath, content, 'utf8');
    console.log('✅ Aggiornate le Top 20 coppie Bybit in futuresPairs.js');
  } catch (err) {
    console.error('❌ Errore nel recupero delle coppie Bybit:', err.message);
  }
}

fetchTopBybitPairs();
