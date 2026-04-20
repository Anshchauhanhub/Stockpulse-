require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { Server: SocketIOServer } = require('socket.io');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stocks';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
const WATCHLIST = (process.env.WATCHLIST || 'AAPL,MSFT,GOOGL,AMZN,TSLA').split(',').map(s => s.trim());

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db = null;
let ticksCollection = null;
let totalTicksIngested = 0;
const startTime = Date.now();
const latestPrices = {};
const priceHistory = {}; // { symbol: [{ price, timestamp }] } for SMA

// ─── Paper Trading Portfolio ─────────────────────────────────────────────────
const STARTING_CASH = 100000;
const portfolio = {
  cash: STARTING_CASH,
  holdings: {},     // { AAPL: { shares: 10, avgCost: 195.50 } }
  transactions: []  // [{ type, symbol, shares, price, total, timestamp }]
};

// ─── MongoDB ─────────────────────────────────────────────────────────────────
async function connectMongo() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('stocks');
    ticksCollection = db.collection('ticks');
    await ticksCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 86400 });
    await ticksCollection.createIndex({ symbol: 1, timestamp: -1 });
    console.log('Connected to MongoDB');
    return client;
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    console.log('Running in demo mode without MongoDB persistence');
    return null;
  }
}

function startChangeStream() {
  if (!ticksCollection) return;
  try {
    const changeStream = ticksCollection.watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', (change) => {
      if (change.operationType === 'insert') {
        const doc = change.fullDocument;
        io.emit('tick', {
          symbol: doc.symbol, price: doc.price, volume: doc.volume,
          timestamp: doc.timestamp, change: doc.change || 0,
          changePercent: doc.changePercent || 0, source: 'changeStream'
        });
      }
    });
    changeStream.on('error', (err) => {
      console.error('Change stream error:', err.message);
      setTimeout(startChangeStream, 5000);
    });
    console.log('Change stream watching for new ticks');
  } catch (err) {
    console.error('Failed to start change stream:', err.message);
  }
}

// ─── Signal Calculation (SMA Crossover) ──────────────────────────────────────
function calculateSignal(symbol) {
  const history = priceHistory[symbol] || [];
  if (history.length < 20) return { signal: 'HOLD', sma10: null, sma20: null, strength: 0 };

  const prices = history.map(h => h.price);
  const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;

  let signal = 'HOLD';
  let strength = 0;

  if (prices.length >= 21) {
    const prev = prices.slice(0, -1);
    const pSma10 = prev.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const pSma20 = prev.slice(-20).reduce((a, b) => a + b, 0) / 20;

    if (pSma10 <= pSma20 && sma10 > sma20) { signal = 'STRONG BUY'; strength = 2; }
    else if (pSma10 >= pSma20 && sma10 < sma20) { signal = 'STRONG SELL'; strength = -2; }
    else if (sma10 > sma20) { signal = 'BUY'; strength = 1; }
    else { signal = 'SELL'; strength = -1; }
  }

  return { signal, sma10: +sma10.toFixed(2), sma20: +sma20.toFixed(2), strength };
}

// ─── Tick Processing ─────────────────────────────────────────────────────────
async function processTick(tick) {
  const { symbol, price, volume, timestamp } = tick;
  const prev = latestPrices[symbol];
  const prevClose = prev ? prev.prevClose || prev.price : price;
  const change = parseFloat((price - prevClose).toFixed(4));
  const changePercent = prevClose !== 0 ? parseFloat(((change / prevClose) * 100).toFixed(4)) : 0;

  latestPrices[symbol] = { price, volume, timestamp, change, changePercent, prevClose: prev ? prev.prevClose || prev.price : price };
  totalTicksIngested++;

  // Store price history for SMA
  if (!priceHistory[symbol]) priceHistory[symbol] = [];
  priceHistory[symbol].push({ price, timestamp: new Date(timestamp) });
  if (priceHistory[symbol].length > 200) priceHistory[symbol] = priceHistory[symbol].slice(-200);

  const tickDoc = { symbol, price, volume, timestamp: new Date(timestamp), change, changePercent };

  if (ticksCollection) {
    try { await ticksCollection.insertOne(tickDoc); }
    catch (err) { io.emit('tick', { ...tickDoc, source: 'direct' }); }
  } else {
    io.emit('tick', { ...tickDoc, source: 'direct' });
  }

  // Emit signal update
  const sig = calculateSignal(symbol);
  io.emit('signal', { symbol, ...sig });
}

// ─── Finnhub Connection ─────────────────────────────────────────────────────
let finnhubWsInstance = null;

function connectFinnhub() {
  if (!FINNHUB_API_KEY || FINNHUB_API_KEY === 'your_finnhub_api_key_here') {
    console.log('No Finnhub API key. Starting simulated data...');
    startSimulatedData();
    return;
  }
  finnhubWsInstance = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);
  finnhubWsInstance.on('open', () => {
    console.log('Connected to Finnhub WebSocket');
    WATCHLIST.forEach(s => finnhubWsInstance.send(JSON.stringify({ type: 'subscribe', symbol: s })));
  });
  finnhubWsInstance.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'trade' && msg.data) {
        for (const t of msg.data) {
          await processTick({ symbol: t.s, price: t.p, volume: t.v, timestamp: new Date(t.t) });
        }
      }
    } catch (e) {}
  });
  finnhubWsInstance.on('error', (err) => console.error('Finnhub error:', err.message));
  finnhubWsInstance.on('close', () => { console.log('Finnhub closed. Reconnecting...'); setTimeout(connectFinnhub, 5000); });
}

function startSimulatedData() {
  const basePrices = { AAPL: 198.50, MSFT: 420.75, GOOGL: 175.30, AMZN: 185.60, TSLA: 245.80 };
  WATCHLIST.forEach(s => {
    const base = basePrices[s] || 100 + Math.random() * 200;
    latestPrices[s] = { price: base, volume: 0, timestamp: new Date(), change: 0, changePercent: 0, prevClose: base };
  });
  function emit() {
    const symbol = WATCHLIST[Math.floor(Math.random() * WATCHLIST.length)];
    const prev = latestPrices[symbol];
    const pct = (Math.random() - 0.48) * 0.003;
    const newPrice = parseFloat((prev.price * (1 + pct)).toFixed(2));
    const volume = Math.floor(Math.random() * 500) + 10;
    processTick({ symbol, price: newPrice, volume, timestamp: new Date() });
    setTimeout(emit, 300 + Math.random() * 1700);
  }
  emit();
  console.log('Simulated data feed active');
}

// ─── Sentiment Analysis ──────────────────────────────────────────────────────
function analyzeSentiment(text) {
  const pos = ['surge','gain','rise','bull','growth','profit','beat','record','high','strong','boost','rally','soar','upgrade','outperform','positive','optimistic','success','innovation','breakthrough','exceed','revenue'];
  const neg = ['drop','fall','bear','loss','miss','low','weak','crash','decline','plunge','sell-off','cut','downgrade','negative','concern','risk','warn','lawsuit','layoff','recall','debt','fraud'];
  const lower = text.toLowerCase();
  let score = 0;
  pos.forEach(w => { if (lower.includes(w)) score++; });
  neg.forEach(w => { if (lower.includes(w)) score--; });
  if (score > 0) return { label: 'Positive', score, emoji: '🟢' };
  if (score < 0) return { label: 'Negative', score, emoji: '🔴' };
  return { label: 'Neutral', score: 0, emoji: '🟡' };
}

function generateMockNews(symbol) {
  const headlines = [
    { headline: `${symbol} Reports Strong Q4 Earnings, Beats Expectations`, summary: 'Revenue exceeded analyst estimates by 8%, driven by strong consumer demand.' },
    { headline: `Analysts Upgrade ${symbol} Price Target Amid Growth Optimism`, summary: 'Multiple Wall Street firms raised their targets citing innovation pipeline.' },
    { headline: `${symbol} Announces Strategic Partnership for 2026`, summary: 'The new deal is expected to expand market reach significantly.' },
    { headline: `Market Volatility Raises Concerns for ${symbol} Investors`, summary: 'Macroeconomic uncertainty leads to cautious outlook among traders.' },
    { headline: `${symbol} CEO Discusses Innovation Strategy at Tech Conference`, summary: 'Key announcements include AI integration and sustainability initiatives.' },
    { headline: `${symbol} Faces Regulatory Scrutiny Over Data Practices`, summary: 'New investigation could impact operations in several key markets.' },
  ];
  const articles = headlines.map((h, i) => ({
    ...h, source: 'StockPulse News', url: '#',
    datetime: new Date(Date.now() - i * 3600000).toISOString(),
    sentiment: analyzeSentiment(h.headline + ' ' + h.summary)
  }));
  const avg = articles.reduce((s, a) => s + a.sentiment.score, 0) / articles.length;
  return { articles, overall: avg > 0.3 ? 'Positive' : avg < -0.3 ? 'Negative' : 'Neutral', avgScore: +avg.toFixed(2) };
}

// ─── API Routes ──────────────────────────────────────────────────────────────
app.get('/api/symbols', (req, res) => res.json({ symbols: WATCHLIST, prices: latestPrices }));

app.get('/api/stats', (req, res) => {
  res.json({ totalTicks: totalTicksIngested, connectedClients: io.engine.clientsCount, uptime: Math.floor((Date.now() - startTime) / 1000), symbols: WATCHLIST.length, mongoConnected: !!db });
});

app.get('/api/history/:symbol', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  if (ticksCollection) {
    try {
      const ticks = await ticksCollection.find({ symbol: req.params.symbol }).sort({ timestamp: -1 }).limit(limit).toArray();
      res.json(ticks.reverse());
    } catch (err) { res.status(500).json({ error: err.message }); }
  } else { res.json([]); }
});

app.post('/api/watchlist', (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  const sym = symbol.toUpperCase().trim();
  if (!WATCHLIST.includes(sym)) {
    WATCHLIST.push(sym);
    if (finnhubWsInstance && finnhubWsInstance.readyState === WebSocket.OPEN) {
      finnhubWsInstance.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
    }
    io.emit('watchlist_updated', { symbols: WATCHLIST, newSymbol: sym });
    console.log(`➕ Added ${sym} to watchlist`);
  }
  res.json({ success: true, symbols: WATCHLIST });
});

// ─── Portfolio & Trading ─────────────────────────────────────────────────────
app.get('/api/portfolio', (req, res) => {
  let holdingsValue = 0;
  const detail = {};
  for (const [sym, h] of Object.entries(portfolio.holdings)) {
    const cp = latestPrices[sym]?.price || h.avgCost;
    const val = h.shares * cp;
    const cost = h.shares * h.avgCost;
    holdingsValue += val;
    detail[sym] = { shares: h.shares, avgCost: +h.avgCost.toFixed(2), currentPrice: +cp.toFixed(2), value: +val.toFixed(2), pnl: +(val - cost).toFixed(2), pnlPercent: cost > 0 ? +((val - cost) / cost * 100).toFixed(2) : 0 };
  }
  const tv = portfolio.cash + holdingsValue;
  res.json({ cash: +portfolio.cash.toFixed(2), holdingsValue: +holdingsValue.toFixed(2), totalValue: +tv.toFixed(2), pnl: +(tv - STARTING_CASH).toFixed(2), pnlPercent: +((tv - STARTING_CASH) / STARTING_CASH * 100).toFixed(2), holdings: detail, transactions: portfolio.transactions.slice(-30).reverse() });
});

app.post('/api/trade', (req, res) => {
  const { symbol, action, shares } = req.body;
  if (!symbol || !action || !shares) return res.status(400).json({ error: 'Symbol, action, and shares required' });
  const sym = symbol.toUpperCase().trim();
  const n = parseInt(shares);
  if (isNaN(n) || n <= 0) return res.status(400).json({ error: 'Shares must be positive' });
  const cp = latestPrices[sym]?.price;
  if (!cp) return res.status(400).json({ error: `No price data for ${sym}` });
  const total = cp * n;

  if (action === 'buy') {
    if (total > portfolio.cash) return res.status(400).json({ error: `Insufficient funds. Need $${total.toFixed(2)}` });
    portfolio.cash -= total;
    if (!portfolio.holdings[sym]) portfolio.holdings[sym] = { shares: 0, avgCost: 0 };
    const h = portfolio.holdings[sym];
    h.avgCost = (h.shares * h.avgCost + total) / (h.shares + n);
    h.shares += n;
  } else if (action === 'sell') {
    if (!portfolio.holdings[sym] || portfolio.holdings[sym].shares < n) return res.status(400).json({ error: `Insufficient shares` });
    portfolio.cash += total;
    portfolio.holdings[sym].shares -= n;
    if (portfolio.holdings[sym].shares === 0) delete portfolio.holdings[sym];
  } else {
    return res.status(400).json({ error: 'Action must be buy or sell' });
  }

  const tx = { type: action, symbol: sym, shares: n, price: +cp.toFixed(2), total: +total.toFixed(2), timestamp: new Date() };
  portfolio.transactions.push(tx);
  io.emit('trade_executed', tx);
  console.log(`💰 ${action.toUpperCase()} ${n}x ${sym} @ $${cp.toFixed(2)} = $${total.toFixed(2)}`);
  res.json({ success: true, transaction: tx });
});

// ─── News & Sentiment ────────────────────────────────────────────────────────
app.get('/api/news/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!FINNHUB_API_KEY || FINNHUB_API_KEY === 'your_finnhub_api_key_here' || symbol.includes(':')) {
    return res.json(generateMockNews(symbol));
  }
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${FINNHUB_API_KEY}`;
    const resp = await fetch(url);
    const raw = await resp.json();
    if (!Array.isArray(raw) || raw.length === 0) return res.json(generateMockNews(symbol));
    const articles = raw.slice(0, 8).map(a => ({
      headline: a.headline, summary: (a.summary || '').substring(0, 150),
      source: a.source, url: a.url,
      datetime: new Date(a.datetime * 1000).toISOString(),
      sentiment: analyzeSentiment(a.headline + ' ' + (a.summary || ''))
    }));
    const avg = articles.reduce((s, a) => s + a.sentiment.score, 0) / articles.length;
    res.json({ articles, overall: avg > 0.3 ? 'Positive' : avg < -0.3 ? 'Negative' : 'Neutral', avgScore: +avg.toFixed(2) });
  } catch (err) { res.json(generateMockNews(symbol)); }
});

// ─── Signals ─────────────────────────────────────────────────────────────────
app.get('/api/signals', (req, res) => {
  const signals = {};
  WATCHLIST.forEach(s => { signals[s] = calculateSignal(s); });
  res.json(signals);
});

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('init', { symbols: WATCHLIST, prices: latestPrices, totalTicks: totalTicksIngested, uptime: Math.floor((Date.now() - startTime) / 1000) });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ─── Start ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  StockPulse - Real-Time Stock Analytics Dashboard\n');
  const mongoClient = await connectMongo();
  if (mongoClient) startChangeStream();
  connectFinnhub();
  server.listen(PORT, () => {
    console.log(`\nStockPulse running at http://localhost:${PORT}`);
    console.log(`Tracking: ${WATCHLIST.join(', ')}`);
    console.log(`MongoDB: ${db ? 'Connected' : 'Demo mode'}`);
    console.log(`Paper Trading: $${STARTING_CASH.toLocaleString()} starting balance`);
  });
}

main().catch(console.error);
