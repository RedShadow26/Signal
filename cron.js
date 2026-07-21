require('dotenv').config();
const cron = require('node-cron');

console.log('SIGNAL Cron Job gestartet...');

// Direkt beim Start einmal scannen
const { main } = require('./scanner.js');
main();

// Dann täglich um 21:00 UTC (7:00 Brisbane)
cron.schedule('0 21 * * *', () => {
  console.log('Täglicher Scan startet...');
  main();
});
