const fs = require('fs');
const path = './logs/entry_prices.json';

if (!fs.existsSync(path)) {
    console.log('📭 Nessuna entry attualmente salvata.');
    process.exit(0);
}

const data = JSON.parse(fs.readFileSync(path, 'utf8'));

console.log('📊 Posizioni aperte:\n');

if (Object.keys(data).length === 0) {
    console.log('📭 Nessuna entry attiva.\n');
} else {
    for (const [pool, price] of Object.entries(data)) {
        console.log(`🔸 ${pool} -> Entry: ${price.toFixed(6)} USD`);
    }
}
