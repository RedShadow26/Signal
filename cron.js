process.env.SUPABASE_URL = process.env.SUPABASE_URL || '';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || '';
process.env.ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY || '';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const cron = require('node-cron');

console.log('SIGNAL Cron Job gestartet...');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'SET' : 'MISSING');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING');

const { main } = require('./scanner.js');

// Täglich um 21:00 UTC (7:00 Brisbane)
cron.schedule('0 21 * * *', () => {
  console.log('Täglicher Scan startet...');
  main();
});

console.log('Cron Job läuft – nächster Scan um 21:00 UTC');
