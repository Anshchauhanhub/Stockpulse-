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

async function processTick(tick) {
  const { symbol, price, volume, timestamp } = tick;
  const prev = latestPrices[symbol];
  const prevClose = prev ? prev.prevClose || prev.price : price;
  const change = parseFloat((price - prevClose).toFixed(4));
  const changePercent = prevClose !== 0 ? parseFloat(((change / prevClose) * 100).toFixed(4)) : 0;

  latestPrices[symbol] = { price, volume, timestamp, change, changePercent, prevClose: prev ? prev.prevClose || prev.price : price };
  totalTicksIngested++;

  const tickDoc = { symbol, price, volume, timestamp: new Date(timestamp), change, changePercent };

  if (ticksCollection) {
    try {
      await ticksCollection.insertOne(tickDoc);
    } catch (err) {
      io.emit('tick', { ...tickDoc, source: 'direct' });
    }
  } else {
    io.emit('tick', { ...tickDoc, source: 'direct' });
  }
}

function connectFinnhub() {
  if (!FINNHUB_API_KEY || FINNHUB_API_KEY === 'your_finnhub_api_key_here') {
    console.log('No Finnhub API key. Starting simulated data...');
    startSimulatedData();
    return;
  }
  const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);
  ws.on('open', () => {
    console.log('Connected to Finnhub WebSocket');
    WATCHLIST.forEach(s => ws.send(JSON.stringify({ type: 'subscribe', symbol: s })));
  });
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'trade' && msg.data) {
        for (const t of msg.data) {
          await processTick({ symbol: t.s, price: t.p, volume: t.v, timestamp: new Date(t.t) });
        }
      }
    } catch (e) {}
  });
  ws.on('error', (err) => console.error('Finnhub error:', err.message));
  ws.on('close', () => { console.log('Finnhub closed. Reconnecting...'); setTimeout(connectFinnhub, 5000); });
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

app.get('/api/symbols', (req, res) => res.json({ symbols: WATCHLIST, prices: latestPrices }));

app.get('/api/history/:symbol', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  if (ticksCollection) {
    try {
      const ticks = await ticksCollection.find({ symbol: req.params.symbol }).sort({ timestamp: -1 }).limit(limit).toArray();
      res.json(ticks.reverse());
    } catch (err) { res.status(500).json({ error: err.message }); }
  } else { res.json([]); }
});

app.get('/api/stats', (req, res) => {
  res.json({ totalTicks: totalTicksIngested, connectedClients: io.engine.clientsCount, uptime: Math.floor((Date.now() - startTime) / 1000), symbols: WATCHLIST.length, mongoConnected: !!db });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('init', { symbols: WATCHLIST, prices: latestPrices, totalTicks: totalTicksIngested, uptime: Math.floor((Date.now() - startTime) / 1000) });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

async function main() {
  console.log('\n  StockPulse - Real-Time Stock Analytics Dashboard\n');
  const mongoClient = await connectMongo();
  if (mongoClient) startChangeStream();
  connectFinnhub();
  server.listen(PORT, () => {
    console.log(`\nStockPulse running at http://localhost:${PORT}`);
    console.log(`Tracking: ${WATCHLIST.join(', ')}`);
    console.log(`MongoDB: ${db ? 'Connected' : 'Demo mode'}`);
  });
}

main().catch(console.error);
