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

// ── Neue Gewichtungen ─────────────────────────────
const WEIGHTS = {
  quality:    0.25,
  financial:  0.25,
  future:     0.20,
  management: 0.15,
  risk:       0.15
};

const INDUSTRY_PE = {
  'TECHNOLOGY': 28, 'HEALTHCARE': 22, 'FINANCIAL SERVICES': 14,
  'CONSUMER CYCLICAL': 20, 'CONSUMER DEFENSIVE': 22,
  'COMMUNICATION SERVICES': 20, 'ENERGY': 12,
  'INDUSTRIALS': 20, 'UTILITIES': 18, 'REAL ESTATE': 25, 'BASIC MATERIALS': 15,
};

// ── Live Preis von Yahoo ──────────────────────────
async function getLivePrice(ticker) {
  try {
    const r = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const meta = r.data.chart.result[0].meta;
    return meta.regularMarketPrice || null;
  } catch (e) {
    return null;
  }
}

// ── Quantitativer Score mit neuen Gewichtungen ────
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

  // Quality / Moat (0-100 raw dann × Gewicht)
  let q = 0;
  if (profitMargin > 0.20) q += 30; else if (profitMargin > 0.10) q += 15;
  if (operatingMargin > 0.25) q += 30; else if (operatingMargin > 0.15) q += 15;
  if (returnOnEquity > 0.25) q += 25; else if (returnOnEquity > 0.15) q += 10;
  if (analystBuyRatio > 0.75) q += 15; else if (analystBuyRatio > 0.50) q += 7;

  // Financial Strength (0-100 raw)
  let f = 0;
  if (returnOnEquity > 0.30) f += 30; else if (returnOnEquity > 0.15) f += 15;
  if (returnOnAssets > 0.15) f += 25; else if (returnOnAssets > 0.08) f += 10;
  if (profitMargin > 0.30) f += 25; else if (profitMargin > 0.15) f += 10;
  if (operatingMargin > 0.30) f += 20; else if (operatingMargin > 0.15) f += 10;

  // Future Potential (0-100 raw)
  let fu = 0;
  if (revenueGrowth > 0.15) fu += 40; else if (revenueGrowth > 0.08) fu += 20; else if (revenueGrowth > 0.03) fu += 10;
  if (earningsGrowth > 0.20) fu += 40; else if (earningsGrowth > 0.10) fu += 20; else if (earningsGrowth > 0.05) fu += 10;
  if (pegRatio > 0 && pegRatio < 1.5) fu += 20; else if (pegRatio < 2.5) fu += 10;

  // Management (0-100 raw)
  let m = 0;
  if (insiderOwn > 5) m += 40; else if (insiderOwn > 1) m += 20; else if (insiderOwn > 0.5) m += 10;
  if (institutionalOwn > 70) m += 30; else if (institutionalOwn > 50) m += 15;
  if (analystBuyRatio > 0.80) m += 30; else if (analystBuyRatio > 0.60) m += 15;

  // Risk (0-100 raw, startet bei 100)
  let r = 100;
  if (beta > 1.5) r -= 40; else if (beta > 1.2) r -= 20; else if (beta > 1.0) r -= 10;
  if (peRatio > 50) r -= 30; else if (peRatio > 35) r -= 15; else if (peRatio > 25) r -= 5;
  if (revenueGrowth < 0) r -= 30; else if (revenueGrowth < 0.03) r -= 10;
  r = Math.max(0, r);

  // Gewichteter Gesamtscore 0-100
  const weighted = Math.round(
    (q * WEIGHTS.quality) +
    (f * WEIGHTS.financial) +
    (fu * WEIGHTS.future) +
    (m * WEIGHTS.management) +
    (r * WEIGHTS.risk)
  );

  return {
    q: Math.round(q / 5),   // auf 0-20 skalieren für Anzeige
    f: Math.round(f / 5),
    fu: Math.round(fu / 5),
    m: Math.round(m / 5),
    r: Math.round(r / 5),
    weighted
  };
}

// ── Valuation mit echtem Live-Preis ──────────────
function calculateValuation(d, livePrice) {
  const eps       = parseFloat(d.EPS) || 0;
  const bookValue = parseFloat(d.BookValue) || 0;
  const peRatio   = parseFloat(d.PERatio) || 0;
  const sector    = d.Sector || 'TECHNOLOGY';
  const fcf       = parseFloat(d.OperatingCashflowTTM) || 0;
  const shares    = parseFloat(d.SharesOutstanding) || 1;

  // 1. Graham Number
  let grahamNumber = 0;
  if (eps > 0 && bookValue > 0) grahamNumber = Math.sqrt(22.5 * eps * bookValue);

  // 2. Industry PE
  const industryPE  = INDUSTRY_PE[sector] || 20;
  const fairValuePE = eps * industryPE;

  // 3. FCF Yield basierter Wert (neu)
  const fcfPerShare = fcf / shares;
  const fcfValue    = fcfPerShare > 0 ? fcfPerShare * 15 : 0;

  // 4. Intrinsic Value – drei Methoden gewichtet
  let intrinsicValue = 0;
  if (grahamNumber > 0 && fairValuePE > 0 && fcfValue > 0) {
    intrinsicValue = (grahamNumber * 0.25) + (fairValuePE * 0.50) + (fcfValue * 0.25);
  } else if (grahamNumber > 0 && fairValuePE > 0) {
    intrinsicValue = (grahamNumber * 0.40) + (fairValuePE * 0.60);
  } else if (fairValuePE > 0) {
    intrinsicValue = fairValuePE;
  } else if (grahamNumber > 0) {
    intrinsicValue = grahamNumber;
  }

  // 5. Echter Live-Preis statt Schätzung
  const currentPrice = livePrice || (parseFloat(d.AnalystTargetPrice) * 0.85) || intrinsicValue;

  // 6. Upside
  let upsidePercent = 0;
  if (intrinsicValue > 0 && currentPrice > 0) {
    upsidePercent = ((intrinsicValue - currentPrice) / currentPrice) * 100;
  }

  // 7. Valuation Score
  let score_valuation = 0, valuation_label = '';
  if (upsidePercent > 30)       { score_valuation = 20; valuation_label = 'Strongly Undervalued'; }
  else if (upsidePercent > 15)  { score_valuation = 16; valuation_label = 'Undervalued'; }
  else if (upsidePercent > 0)   { score_valuation = 12; valuation_label = 'Slightly Undervalued'; }
  else if (upsidePercent > -15) { score_valuation = 8;  valuation_label = 'Fairly Valued'; }
  else if (upsidePercent > -30) { score_valuation = 4;  valuation_label = 'Slightly Overvalued'; }
  else                          { score_valuation = 0;  valuation_label = 'Overvalued'; }

  return {
    current_price:    Math.round(currentPrice * 100) / 100,
    intrinsic_value:  Math.round(intrinsicValue * 100) / 100,
    graham_number:    Math.round(grahamNumber * 100) / 100,
    fcf_value:        Math.round(fcfValue * 100) / 100,
    pe_ratio:         peRatio,
    industry_pe:      industryPE,
    score_valuation,
    valuation_label,
    upside_percent:   Math.round(upsidePercent * 10) / 10
  };
}

// ── AI Analyse mit mehr Kontext ───────────────────
async function getAIAnalysis(d, livePrice, val) {
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6', max_tokens: 600,
    messages: [{ role: 'user', content: `You are an expert investment analyst using a structured scoring system. Return ONLY valid JSON, no other text.

Company: ${d.Name}
Sector: ${d.Sector} | Industry: ${d.Industry}
Description: ${d.Description?.slice(0, 400)}

Key Financials:
- Profit Margin: ${(parseFloat(d.ProfitMargin)*100).toFixed(1)}%
- Operating Margin: ${(parseFloat(d.OperatingMarginTTM)*100).toFixed(1)}%
- Revenue Growth YoY: ${(parseFloat(d.QuarterlyRevenueGrowthYOY)*100).toFixed(1)}%
- Earnings Growth YoY: ${(parseFloat(d.QuarterlyEarningsGrowthYOY)*100).toFixed(1)}%
- Return on Equity: ${(parseFloat(d.ReturnOnEquityTTM)*100).toFixed(1)}%
- Return on Assets: ${(parseFloat(d.ReturnOnAssetsTTM)*100).toFixed(1)}%
- PE Ratio: ${d.PERatio} (Industry avg: ${INDUSTRY_PE[d.Sector]||20}x)
- Beta: ${d.Beta}
- Insider Ownership: ${d.PercentInsiders}%

Valuation Context:
- Live Price: $${livePrice?.toFixed(2)||'N/A'}
- Intrinsic Value: $${val.intrinsic_value}
- Graham Number: $${val.graham_number}
- Upside vs Intrinsic: ${val.upside_percent}%
- Valuation: ${val.valuation_label}

Return exactly this JSON:
{
  "moat_score": <0-10>,
  "future_score": <0-10>,
  "management_score": <0-10>,
  "moat_reason": "<one sentence>",
  "future_reason": "<one sentence>",
  "management_reason": "<one sentence>",
  "overall_verdict": "<two sentences max>",
  "key_risk": "<biggest risk in one sentence>"
}` }]
  }, { headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' } });

  return JSON.parse(res.data.content[0].text.replace(/```json|```/g, '').trim());
}

async function saveToSupabase(ticker, row, scores) {
  const { error: e1 } = await supabase.from('stock_scores').upsert(row, { onConflict: 'ticker' });
  if (e1) console.error(`  stock_scores: ${e1.message}`);

  const { error: e2 } = await supabase.from('score_history').insert({
    ticker,
    score_total:      scores.total,
    score_quality:    scores.q,
    score_financial:  scores.f,
    score_future:     scores.fu,
    score_management: scores.m,
    score_risk:       scores.r,
    score_valuation:  scores.val,
    pass_fail:        row.pass_fail,
    valuation_label:  row.valuation_label,
    scanned_at:       new Date().toISOString()
  });
  if (e2) console.error(`  score_history: ${e2.message}`);
  else console.log(`  💾 Saved`);
}

async function analyzeStock(ticker) {
  try {
    console.log(`\n🔍 ${ticker}...`);

    // 1. Finanzdaten + Live-Preis parallel holen
    const [overviewRes, livePrice] = await Promise.all([
      axios.get(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${AV_KEY}`),
      getLivePrice(ticker)
    ]);

    const d = overviewRes.data;
    if (!d.Name) { console.log(`   ⚠️  No data`); return; }

    console.log(`   Live Price: $${livePrice?.toFixed(2) || 'N/A'}`);

    // 2. Scores berechnen
    const quant = calculateQuantScore(d);
    const val   = calculateValuation(d, livePrice);
    const ai    = await getAIAnalysis(d, livePrice, val);

    // 3. Finaler Score
    const aiBonus    = Math.round((ai.moat_score + ai.future_score + ai.management_score) / 30 * 100);
    const baseScore  = quant.weighted * 0.75 + aiBonus * 0.25;
    const withVal    = baseScore * 0.80 + val.score_valuation * 0.20 * 5;
    const finalScore = Math.min(100, Math.round(withVal));

    let tier, passFail;
    if (finalScore >= 80)      { tier = 'Tier 0/2'; passFail = 'STRONG PASS'; }
    else if (finalScore >= 65) { tier = 'Tier 1/3'; passFail = 'PASS'; }
    else if (finalScore >= 50) { tier = 'Watchlist'; passFail = 'WATCHLIST'; }
    else                       { tier = '-';         passFail = 'FAIL'; }

    const valEmoji = val.upside_percent > 15 ? '🟢' : val.upside_percent > 0 ? '🟡' : val.upside_percent > -15 ? '🟠' : '🔴';
    console.log(`   Score: ${finalScore}/100 | ${passFail} | ${valEmoji} ${val.valuation_label} (${val.upside_percent}%)`);

    const row = {
      ticker, company_name: d.Name, sector: d.Sector,
      score_total: finalScore,
      score_quality: quant.q, score_financial: quant.f,
      score_future: quant.fu, score_management: quant.m,
      score_risk: quant.r, score_valuation: val.score_valuation,
      profit_margin: parseFloat(d.ProfitMargin) || 0,
      revenue_growth: parseFloat(d.QuarterlyRevenueGrowthYOY) || 0,
      debt_equity: parseFloat(d.DebtToEquityRatio) || 0,
      current_price: val.current_price,
      intrinsic_value: val.intrinsic_value,
      graham_number: val.graham_number,
      pe_ratio: val.pe_ratio, industry_pe: val.industry_pe,
      valuation_label: val.valuation_label,
      upside_percent: val.upside_percent,
      tier, pass_fail: passFail,
      ai_moat_score: ai.moat_score, ai_future_score: ai.future_score,
      ai_management_score: ai.management_score,
      ai_moat_reason: ai.moat_reason, ai_future_reason: ai.future_reason,
      ai_management_reason: ai.management_reason,
      ai_verdict: ai.overall_verdict,
      ai_key_risk: ai.key_risk || null,
      last_updated: new Date().toISOString()
    };

    await saveToSupabase(ticker, row, {
      total: finalScore, q: quant.q, f: quant.f,
      fu: quant.fu, m: quant.m, r: quant.r, val: val.score_valuation
    });

  } catch (err) {
    console.error(`❌ ${ticker}:`, err.message);
  }
}

async function main() {
  console.log('\n🚀 SIGNAL Scanner v4 – Präziser & Gewichtet\n');
  for (let i = 0; i < TICKERS.length; i++) {
    await analyzeStock(TICKERS[i]);
    if (i < TICKERS.length - 1) {
      process.stdout.write('   ⏳ 13 Sek...\r');
      await new Promise(r => setTimeout(r, 13000));
    }
  }
  console.log('\n✅ Scan abgeschlossen!');
}

main();
