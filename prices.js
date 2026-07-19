require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const AV_KEY = process.env.ALPHA_VANTAGE_KEY;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

const cache = {};
const CACHE_TIME = 60000;
const newsCache = {};
const NEWS_CACHE_TIME = 300000;

// ── Root ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'SIGNAL Price Server running', version: '1.0' });
});

// ── Live Price ────────────────────────────────────
app.get('/price/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const now = Date.now();

  if (cache[ticker] && now - cache[ticker].ts < CACHE_TIME) {
    return res.json(cache[ticker].data);
  }

  try {
    const r = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const meta = r.data.chart.result[0].meta;
    const price = meta.regularMarketPrice?.toFixed(2);
    const prev  = meta.chartPreviousClose || meta.previousClose;
    const change = (meta.regularMarketPrice - prev).toFixed(2);
    const changePct = (((meta.regularMarketPrice - prev) / prev) * 100).toFixed(2);

    const data = { price, change, changePercent: changePct };
    cache[ticker] = { data, ts: now };
    res.json(data);

  } catch (err) {
    res.json({ price: null, change: null, changePercent: null });
  }
});

// ── News ──────────────────────────────────────────
app.get('/news/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const now = Date.now();

  if (newsCache[ticker] && now - newsCache[ticker].ts < NEWS_CACHE_TIME) {
    return res.json(newsCache[ticker].data);
  }

  try {
    const r = await axios.get(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=6&quotesCount=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const feed = r.data.news || [];
    const news = feed.slice(0, 5).map(item => ({
      title:  item.title,
      source: item.publisher,
      url:    item.link,
      time:   item.providerPublishTime,
    }));

    const data = { news };
    newsCache[ticker] = { data, ts: now };
    res.json(data);

  } catch (err) {
    res.json({ news: [] });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
