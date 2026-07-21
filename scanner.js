require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const AV_KEY        = process.env.ALPHA_VANTAGE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const supabase      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const TICKERS = [
  'MSFT', 'AAPL', 'NVDA', 'AMZN', 'GOOGL',
  'META', 'JPM',  'LLY',  'V',    'MA',
  'COST', 'HD',   'PG',   'JNJ',  'ABBV',
  'NFLX', 'CRM',  'WMT',  'BAC',  'XOM',
  'TSLA', 'UNH',  'AVGO', 'CVX',  'AMD'
];

function calculateQuantScore(d) {
  const profitMargin     = parseFloat(d.ProfitMargin) || 0;
  const returnOnEquity   = parseFloat(d.ReturnOnEquityTTM) || 0;
  const returnOnAssets   = parseFloat(d.ReturnOnAssetsTTM) || 0;
  const operatingMargin  = parseFloat(d.OperatingMarginTTM) || 0;
  const revenueGrowth    = parseFloat(d.QuarterlyRevenueGrowthYOY) || 0;
  const earningsGrowth   = parseFloat(d.QuarterlyEarningsGrowthYOY) || 0;
  const pegRatio         = parseFloat(d.PEGRatio) || 0;
  const peRatio          = parseFloat(d.PERatio) || 0;
  const beta             = parseFloat(d.Beta) || 0;
  const insiderOwn       = parseFloat(d.PercentInsiders) || 0;
  const institutionalOwn = parseFloat(d.PercentInstitutions) || 0;
  const analystBuy       = (parseInt(d.AnalystRatingBuy) || 0) + (parseInt(d.AnalystRatingStrongBuy) || 0);
  const analystTotal     = analystBuy + (parseInt(d.AnalystRatingHold) || 0) + (parseInt(d.AnalystRatingSell) || 0) + (parseInt(d.AnalystRatingStrongSell) || 0) || 1;
  const analystBuyRatio  = analystBuy / analystTotal;

  let q = 0;
  if (profitMargin > 0.20) q += 6; else if (profitMargin > 0.10) q += 3;
  if (operatingMargin > 0.25) q += 6; else if (operatingMargin > 0.15) q += 3;
  if (returnOnEquity > 0.25) q += 5; else if (returnOnEquity > 0.15) q += 2;
  if (analystBuyRatio > 0.75) q += 3; else if (analystBuyRatio > 0.50) q += 1;

  let f = 0;
  if (returnOnEquity > 0.30) f += 6; else if (returnOnEquity > 0.15) f += 3;
  if (returnOnAssets > 0.15) f += 5; else if (returnOnAssets > 0.08) f += 2;
  if (profitMargin > 0.30) f += 5; else if (profitMargin > 0.15) f += 2;
  if (operatingMargin > 0.30) f += 4; else if (operatingMargin > 0.15) f += 2;

  let fu = 0;
  if (revenueGrowth > 0.15) fu += 8; else if (revenueGrowth > 0.08) fu += 4; else if (revenueGrowth > 0.03) fu += 2;
  if (earningsGrowth > 0.20) fu += 8; else if (earningsGrowth > 0.10) fu += 4; else if (earningsGrowth > 0.05) fu += 2;
  if (pegRatio > 0 && pegRatio < 1.5) fu += 4; else if (pegRatio < 2.5) fu += 2;

  let m = 0;
  if (insiderOwn > 5) m += 8; else if (insiderOwn > 1) m += 4; else if (insiderOwn > 0.5) m += 2;
  if (institutionalOwn > 70) m += 6; else if (institutionalOwn > 50) m += 3;
  if (analystBuyRatio > 0.80) m += 6; else if (analystBuyRatio > 0.60) m += 3;

  let r = 20;
  if (beta > 1.5) r -= 8; else if (beta > 1.2) r -= 4; else if (beta > 1.0) r -= 2;
  if (peRatio > 50) r -= 6; else if (peRatio > 35) r -= 3; else if (peRatio > 25) r -= 1;
  if (revenueGrowth < 0) r -= 6; else if (revenueGrowth < 0.03) r -= 2;
  r = Math.max(0, r);

  return { q, f, fu, m, r, total: q + f + fu + m + r };
}

async function getAIAnalysis(d) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an expert investment analyst. Return ONLY valid JSON, no other text.

Company: ${d.Name}
Sector: ${d.Sector}
Industry: ${d.Industry}
Description: ${d.Description?.slice(0, 400)}
Profit Margin: ${(parseFloat(d.ProfitMargin) * 100).toFixed(1)}%
Operating Margin: ${(parseFloat(d.OperatingMarginTTM) * 100).toFixed(1)}%
Revenue Growth: ${(parseFloat(d.QuarterlyRevenueGrowthYOY) * 100).toFixed(1)}%
Return on Equity: ${(parseFloat(d.ReturnOnEquityTTM) * 100).toFixed(1)}%

Return exactly this JSON:
{
  "moat_score": <0-10>,
  "future_score": <0-10>,
  "management_score": <0-10>,
  "moat_reason": "<one sentence>",
  "future_reason": "<one sentence>",
  "management_reason": "<one sentence>",
  "overall_verdict": "<one sentence>"
}`
      }]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      }
    }
  );

  const text = res.data.content[0].text;
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function saveToSupabase(data) {
  const { error } = await supabase
    .from('stock_scores')
    .upsert(data, { onConflict: 'ticker' });

  if (error) console.error('Supabase error:', error.message);
  else console.log(`💾 ${data.ticker} gespeichert`);
}

async function analyzeStock(ticker) {
  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${AV_KEY}`
    );
    const d = res.data;
    if (!d.Name) { console.log(`⚠️  ${ticker}: keine Daten`); return; }

    const quant = calculateQuantScore(d);
    const ai    = await getAIAnalysis(d);
    const aiBonus = Math.round((ai.moat_score + ai.future_score + ai.management_score) / 30 * 20);
    const score = Math.min(100, Math.round(quant.total * 0.80 + aiBonus * 0.20 * 5));

    let tier, passFail;
    if (score >= 80)      { tier = 'Tier 0/2'; passFail = 'STRONG PASS'; }
    else if (score >= 65) { tier = 'Tier 1/3'; passFail = 'PASS'; }
    else if (score >= 50) { tier = 'Watchlist'; passFail = 'WATCHLIST'; }
    else                  { tier = '-';         passFail = 'FAIL'; }

    const row = {
      ticker,
      company_name:    d.Name,
      sector:          d.Sector,
      score_total:     score,
      score_quality:   quant.q,
      score_financial: quant.f,
      score_future:    quant.fu,
      score_management:quant.m,
      score_risk:      quant.r,
      profit_margin:   parseFloat(d.ProfitMargin) || 0,
      revenue_growth:  parseFloat(d.QuarterlyRevenueGrowthYOY) || 0,
      debt_equity:     parseFloat(d.DebtToEquityRatio) || 0,
      tier,
      pass_fail:       passFail,
      ai_moat_score:       ai.moat_score,
      ai_future_score:     ai.future_score,
      ai_management_score: ai.management_score,
      ai_moat_reason:      ai.moat_reason,
      ai_future_reason:    ai.future_reason,
      ai_management_reason:ai.management_reason,
      ai_verdict:          ai.overall_verdict,
      last_updated:    new Date().toISOString()
    };

    await saveToSupabase(row);
    console.log(`✅ ${ticker.padEnd(6)} | ${score}/100 | ${passFail}`);

  } catch (err) {
    console.error(`❌ ${ticker}:`, err.message);
  }
}

async function main() {
  console.log('\n🔍 SIGNAL Scanner startet...\n');
  for (let i = 0; i < TICKERS.length; i++) {
    await analyzeStock(TICKERS[i]);
    if (i < TICKERS.length - 1) {
      console.log(`   ⏳ Warte 13 Sekunden...`);
      await new Promise(r => setTimeout(r, 13000));
    }
  }
  console.log('\n✅ Scan abgeschlossen!');
}

main();
module.exports = { main };
