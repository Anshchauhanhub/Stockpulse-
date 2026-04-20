// ─── StockPulse Frontend (PBL Edition) ───────────────────────────────────────

const socket = io();

// State
let activeSymbol = 'AAPL';
let maxDataPoints = 50;
let chartData = {};
let mainChart = null;
let tickCount = 0;
let showSMA = false;
let currentSignals = {};

// ─── DOM Elements ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $watchlistItems = $('watchlistItems');
const $chartSymbol = $('chartSymbol');
const $activityFeed = $('activityFeed');
const $statusDot = $('statusDot');
const $statusText = $('statusText');
const $statTicks = $('statTicks');
const $statSymbols = $('statSymbols');
const $statClients = $('statClients');
const $statUptime = $('statUptime');
const $statMongo = $('statMongo');
const $liveClock = $('liveClock');
const $stockSearch = $('stockSearch');
const $popularSelect = $('popularSelect');
const $addStockBtn = $('addStockBtn');
const $signalBadge = $('signalBadge');
const $tradeShares = $('tradeShares');
const $buyBtn = $('buyBtn');
const $sellBtn = $('sellBtn');
const $tradeInfo = $('tradeInfo');
const $newsFeed = $('newsFeed');
const $newsSentimentHeader = $('newsSentimentHeader');
const $tradesFeed = $('tradesFeed');
const $toastContainer = $('toastContainer');

// ─── Clock ───────────────────────────────────────────────────────────────────
function updateClock() {
  $liveClock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ─── Toast Notifications ────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Chart Setup ─────────────────────────────────────────────────────────────
function initChart() {
  const ctx = document.getElementById('mainChart').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, 'rgba(0, 212, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(0, 212, 255, 0.0)');

  mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Price', data: [], borderColor: '#00d4ff', backgroundColor: gradient,
          borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0,
          pointHoverRadius: 5, pointHoverBackgroundColor: '#00d4ff',
          pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, order: 1
        },
        {
          label: 'SMA-10', data: [], borderColor: '#a78bfa', borderWidth: 1.5,
          borderDash: [5, 3], fill: false, tension: 0.3, pointRadius: 0, hidden: true, order: 2
        },
        {
          label: 'SMA-20', data: [], borderColor: '#f97316', borderWidth: 1.5,
          borderDash: [8, 4], fill: false, tension: 0.3, pointRadius: 0, hidden: true, order: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 300, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: showSMA, position: 'top', labels: { color: '#94a3b8', font: { size: 10 }, usePointStyle: true, pointStyle: 'line' } },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)', titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          bodyFont: { family: 'JetBrains Mono', size: 13, weight: '600' },
          titleFont: { family: 'Inter', size: 11 },
          borderColor: 'rgba(75, 85, 99, 0.3)', borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}` }
        }
      },
      scales: {
        x: {
          display: true, grid: { color: 'rgba(75, 85, 99, 0.15)', drawBorder: false },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8, maxRotation: 0 },
          border: { display: false }
        },
        y: {
          display: true, position: 'right', grid: { color: 'rgba(75, 85, 99, 0.15)', drawBorder: false },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 }, callback: (v) => '$' + v.toFixed(2) },
          border: { display: false }
        }
      }
    }
  });
}

function calculateSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].price;
    result.push(sum / period);
  }
  return result;
}

function updateChart() {
  if (!mainChart) return;
  const data = chartData[activeSymbol] || [];
  const sliced = data.slice(-maxDataPoints);

  mainChart.data.labels = sliced.map(d => {
    const t = new Date(d.timestamp);
    return t.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  mainChart.data.datasets[0].data = sliced.map(d => d.price);

  // SMA overlays
  const sma10 = calculateSMA(sliced, 10);
  const sma20 = calculateSMA(sliced, 20);
  mainChart.data.datasets[1].data = sma10;
  mainChart.data.datasets[2].data = sma20;
  mainChart.data.datasets[1].hidden = !showSMA;
  mainChart.data.datasets[2].hidden = !showSMA;
  mainChart.options.plugins.legend.display = showSMA;

  // Dynamic color
  if (sliced.length >= 2) {
    const first = sliced[0].price, last = sliced[sliced.length - 1].price;
    const color = last >= first ? '#00e676' : '#ff5252';
    const gCtx = mainChart.ctx;
    const grad = gCtx.createLinearGradient(0, 0, 0, 400);
    grad.addColorStop(0, last >= first ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 82, 82, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    mainChart.data.datasets[0].borderColor = color;
    mainChart.data.datasets[0].backgroundColor = grad;
    mainChart.data.datasets[0].pointHoverBackgroundColor = color;
  }
  mainChart.update('none');
}

// ─── Watchlist ────────────────────────────────────────────────────────────────
function renderWatchlist(symbols, prices) {
  $watchlistItems.innerHTML = '';
  symbols.forEach(symbol => {
    const card = document.createElement('div');
    card.className = `stock-card${symbol === activeSymbol ? ' active' : ''}`;
    card.id = `card-${symbol}`;
    card.onclick = () => selectSymbol(symbol);
    const info = prices[symbol] || {};
    const price = info.price || 0;
    const change = info.change || 0;
    const changePct = info.changePercent || 0;
    const isGain = change >= 0;
    const sig = currentSignals[symbol] || { signal: 'HOLD' };
    const sigClass = sig.signal.includes('BUY') ? 'buy' : sig.signal.includes('SELL') ? 'sell' : 'hold';

    card.innerHTML = `
      <div class="stock-card-header">
        <div class="stock-symbol">${symbol}<span class="card-signal ${sigClass}">${sig.signal}</span></div>
        <div class="stock-price" id="price-${symbol}">$${price.toFixed(2)}</div>
      </div>
      <div class="stock-card-footer">
        <div class="stock-change ${isGain ? 'gain' : 'loss'}" id="change-${symbol}">
          ${isGain ? '▲' : '▼'} ${Math.abs(change).toFixed(2)} (${Math.abs(changePct).toFixed(2)}%)
        </div>
        <div class="stock-volume" id="vol-${symbol}">Vol: ${(info.volume || 0).toLocaleString()}</div>
      </div>
      <div class="sparkline-container"><canvas id="spark-${symbol}" width="260" height="30"></canvas></div>
    `;
    $watchlistItems.appendChild(card);
  });
}

function selectSymbol(symbol) {
  activeSymbol = symbol;
  $chartSymbol.textContent = symbol;
  document.querySelectorAll('.stock-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`card-${symbol}`);
  if (card) card.classList.add('active');
  updateChart();
  updateSignalBadge(symbol);
  fetchNews(symbol);
  updateTradeInfo();
}

function updateCardPrice(symbol, price, change, changePct, volume) {
  const priceEl = document.getElementById(`price-${symbol}`);
  const changeEl = document.getElementById(`change-${symbol}`);
  const volEl = document.getElementById(`vol-${symbol}`);
  const card = document.getElementById(`card-${symbol}`);
  if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;
  if (changeEl) {
    const isGain = change >= 0;
    changeEl.className = `stock-change ${isGain ? 'gain' : 'loss'}`;
    changeEl.textContent = `${isGain ? '▲' : '▼'} ${Math.abs(change).toFixed(2)} (${Math.abs(changePct).toFixed(2)}%)`;
  }
  if (volEl) volEl.textContent = `Vol: ${volume.toLocaleString()}`;
  if (card) {
    card.classList.remove('flash-green', 'flash-red');
    void card.offsetWidth;
    card.classList.add(change >= 0 ? 'flash-green' : 'flash-red');
  }
}

// ─── Sparkline ───────────────────────────────────────────────────────────────
function drawSparkline(symbol) {
  const canvas = document.getElementById(`spark-${symbol}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const data = (chartData[symbol] || []).slice(-30);
  if (data.length < 2) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const prices = data.map(d => d.price);
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const isGain = prices[prices.length - 1] >= prices[0];
  const color = isGain ? '#00e676' : '#ff5252';
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, isGain ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
}

// ─── Activity Feed ───────────────────────────────────────────────────────────
function addActivityItem(tick) {
  const item = document.createElement('div');
  item.className = 'activity-item';
  const isGain = (tick.change || 0) >= 0;
  const time = new Date(tick.timestamp).toLocaleTimeString('en-US', { hour12: false });
  item.innerHTML = `
    <span class="activity-symbol">${tick.symbol}</span>
    <span class="activity-price ${isGain ? 'gain' : 'loss'}">$${tick.price.toFixed(2)}</span>
    <span class="activity-change ${isGain ? 'gain' : 'loss'}">${isGain ? '+' : ''}${(tick.change || 0).toFixed(2)} (${(tick.changePercent || 0).toFixed(2)}%)</span>
    <span class="activity-time">${time}</span>
  `;
  $activityFeed.insertBefore(item, $activityFeed.firstChild);
  while ($activityFeed.children.length > 50) $activityFeed.removeChild($activityFeed.lastChild);
}

// ─── Signal Display ──────────────────────────────────────────────────────────
function updateSignalBadge(symbol) {
  const sig = currentSignals[symbol] || { signal: 'HOLD' };
  $signalBadge.textContent = sig.signal;
  $signalBadge.className = 'signal-badge';
  if (sig.signal.includes('BUY')) $signalBadge.classList.add(sig.signal === 'STRONG BUY' ? 'strong-buy' : 'buy');
  else if (sig.signal.includes('SELL')) $signalBadge.classList.add(sig.signal === 'STRONG SELL' ? 'strong-sell' : 'sell');
  else $signalBadge.classList.add('hold');
}

// ─── Portfolio ───────────────────────────────────────────────────────────────
function updatePortfolio() {
  fetch('/api/portfolio').then(r => r.json()).then(p => {
    $('pfCash').textContent = `$${p.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    $('pfHoldings').textContent = `$${p.holdingsValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    $('pfTotal').textContent = `$${p.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    const pnlEl = $('pfPnL');
    pnlEl.textContent = `${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)} (${p.pnlPercent.toFixed(2)}%)`;
    pnlEl.style.color = p.pnl >= 0 ? 'var(--gain)' : 'var(--loss)';

    // Update trade history tab
    if (p.transactions.length > 0) {
      $tradesFeed.innerHTML = '';
      p.transactions.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'trade-item';
        const time = new Date(tx.timestamp).toLocaleTimeString('en-US', { hour12: false });
        item.innerHTML = `
          <span class="trade-type ${tx.type}">${tx.type}</span>
          <span class="activity-symbol">${tx.symbol}</span>
          <span style="color:var(--text-secondary)">${tx.shares} shares @ $${tx.price.toFixed(2)}</span>
          <span class="activity-price" style="color:var(--text-primary)">$${tx.total.toFixed(2)}</span>
          <span class="activity-time">${time}</span>
        `;
        $tradesFeed.appendChild(item);
      });
    }
  }).catch(() => {});
}

function updateTradeInfo() {
  const shares = parseInt($tradeShares.value) || 1;
  const data = chartData[activeSymbol] || [];
  if (data.length > 0) {
    const price = data[data.length - 1].price;
    $tradeInfo.textContent = `≈ $${(price * shares).toFixed(2)}`;
  }
}

function executeTrade(action) {
  const shares = parseInt($tradeShares.value);
  if (!shares || shares <= 0) { showToast('Enter a valid number of shares', 'error'); return; }
  $buyBtn.disabled = true; $sellBtn.disabled = true;
  fetch('/api/trade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: activeSymbol, action, shares })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { showToast(data.error, 'error'); }
    else { showToast(`${action.toUpperCase()} ${shares}x ${activeSymbol} @ $${data.transaction.price.toFixed(2)}`, 'success'); updatePortfolio(); }
    $buyBtn.disabled = false; $sellBtn.disabled = false;
  })
  .catch(err => { showToast('Trade failed: ' + err.message, 'error'); $buyBtn.disabled = false; $sellBtn.disabled = false; });
}

// ─── News & Sentiment ────────────────────────────────────────────────────────
function fetchNews(symbol) {
  $newsFeed.innerHTML = '<div class="news-loading">Loading news...</div>';
  $newsSentimentHeader.innerHTML = '';
  fetch(`/api/news/${encodeURIComponent(symbol)}`).then(r => r.json()).then(data => {
    // Sentiment header
    const colors = { Positive: '#00e676', Negative: '#ff5252', Neutral: '#94a3b8' };
    $newsSentimentHeader.innerHTML = `
      <span class="sentiment-overall">
        <span>${data.overall === 'Positive' ? '🟢' : data.overall === 'Negative' ? '🔴' : '🟡'}</span>
        Overall: <strong style="color:${colors[data.overall]}">${data.overall}</strong>
      </span>
      <span style="font-size:0.7rem;color:var(--text-muted)">Score: ${data.avgScore}</span>
    `;
    // Articles
    $newsFeed.innerHTML = '';
    if (!data.articles || data.articles.length === 0) {
      $newsFeed.innerHTML = '<div class="news-loading">No news available</div>';
      return;
    }
    data.articles.forEach(article => {
      const item = document.createElement('div');
      item.className = 'news-item';
      const dotColor = article.sentiment.label === 'Positive' ? '#00e676' : article.sentiment.label === 'Negative' ? '#ff5252' : '#94a3b8';
      const time = new Date(article.datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      item.innerHTML = `
        <div class="news-headline">
          <span class="sentiment-dot" style="background:${dotColor}"></span>
          <span>${article.headline}</span>
        </div>
        <div class="news-meta">
          <span>${article.source}</span>
          <span>${time}</span>
          <span style="color:${dotColor}">${article.sentiment.emoji} ${article.sentiment.label}</span>
        </div>
      `;
      $newsFeed.appendChild(item);
    });
  }).catch(() => { $newsFeed.innerHTML = '<div class="news-loading">Failed to load news</div>'; });
}

// ─── Stats Update ────────────────────────────────────────────────────────────
function updateStats() {
  fetch('/api/stats').then(r => r.json()).then(d => {
    $statTicks.textContent = d.totalTicks.toLocaleString();
    $statClients.textContent = d.connectedClients;
    $statMongo.textContent = d.mongoConnected ? '✓ Live' : '✗ Demo';
    $statMongo.style.color = d.mongoConnected ? 'var(--gain)' : 'var(--text-muted)';
    const s = d.uptime;
    if (s < 60) $statUptime.textContent = `${s}s`;
    else if (s < 3600) $statUptime.textContent = `${Math.floor(s/60)}m ${s%60}s`;
    else $statUptime.textContent = `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
  }).catch(() => {});
}
setInterval(updateStats, 3000);
setInterval(updatePortfolio, 5000);

// ─── Socket Events ───────────────────────────────────────────────────────────
socket.on('connect', () => { $statusDot.classList.remove('disconnected'); $statusText.textContent = 'Connected'; });
socket.on('disconnect', () => { $statusDot.classList.add('disconnected'); $statusText.textContent = 'Disconnected'; });

socket.on('init', (data) => {
  const { symbols, prices, totalTicks } = data;
  tickCount = totalTicks;
  $statTicks.textContent = tickCount.toLocaleString();
  $statSymbols.textContent = symbols.length;
  symbols.forEach(s => { if (!chartData[s]) chartData[s] = []; if (prices[s] && chartData[s].length === 0) chartData[s].push({ price: prices[s].price, timestamp: prices[s].timestamp || new Date() }); });
  if (!activeSymbol || !symbols.includes(activeSymbol)) activeSymbol = symbols[0];
  $chartSymbol.textContent = activeSymbol;
  renderWatchlist(symbols, prices);
  updateChart();
  updateStats();
  updatePortfolio();
  fetchNews(activeSymbol);
  // Fetch initial signals
  fetch('/api/signals').then(r => r.json()).then(sigs => { currentSignals = sigs; updateSignalBadge(activeSymbol); renderWatchlist(symbols, prices); });
});

socket.on('watchlist_updated', (data) => {
  const { symbols, newSymbol } = data;
  $statSymbols.textContent = symbols.length;
  if (newSymbol && !chartData[newSymbol]) chartData[newSymbol] = [];
  fetch('/api/symbols').then(r => r.json()).then(d => { renderWatchlist(d.symbols, d.prices); if (newSymbol) selectSymbol(newSymbol); });
});

socket.on('tick', (tick) => {
  tickCount++;
  $statTicks.textContent = tickCount.toLocaleString();
  if (!chartData[tick.symbol]) chartData[tick.symbol] = [];
  chartData[tick.symbol].push({ price: tick.price, timestamp: tick.timestamp });
  if (chartData[tick.symbol].length > 500) chartData[tick.symbol] = chartData[tick.symbol].slice(-500);
  updateCardPrice(tick.symbol, tick.price, tick.change, tick.changePercent, tick.volume);
  drawSparkline(tick.symbol);
  if (tick.symbol === activeSymbol) { updateChart(); updateTradeInfo(); }
  addActivityItem(tick);
});

socket.on('signal', (data) => {
  currentSignals[data.symbol] = data;
  if (data.symbol === activeSymbol) updateSignalBadge(data.symbol);
  // Update card signal badge
  const cardSigEl = document.querySelector(`#card-${data.symbol} .card-signal`);
  if (cardSigEl) {
    cardSigEl.textContent = data.signal;
    cardSigEl.className = 'card-signal ' + (data.signal.includes('BUY') ? 'buy' : data.signal.includes('SELL') ? 'sell' : 'hold');
  }
  // Toast on strong signals
  if (data.signal === 'STRONG BUY') showToast(`🟢 STRONG BUY signal for ${data.symbol}!`, 'success');
  if (data.signal === 'STRONG SELL') showToast(`🔴 STRONG SELL signal for ${data.symbol}!`, 'error');
});

socket.on('trade_executed', (tx) => { updatePortfolio(); });

// ─── Chart Controls ──────────────────────────────────────────────────────────
document.querySelectorAll('.chart-btn[data-points]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-btn[data-points]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    maxDataPoints = parseInt(btn.dataset.points);
    updateChart();
  });
});

// SMA Toggle
$('smaToggle').addEventListener('click', () => {
  showSMA = !showSMA;
  $('smaToggle').classList.toggle('active', showSMA);
  updateChart();
});

// ─── Trade Controls ──────────────────────────────────────────────────────────
$buyBtn.addEventListener('click', () => executeTrade('buy'));
$sellBtn.addEventListener('click', () => executeTrade('sell'));
$tradeShares.addEventListener('input', updateTradeInfo);

// ─── Tab Switching ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ─── Search Logic ────────────────────────────────────────────────────────────
function addStock(symbolToUse = null) {
  const symbol = (symbolToUse || $stockSearch.value).trim().toUpperCase();
  if (!symbol) return;
  $addStockBtn.disabled = true; $addStockBtn.textContent = '...';
  fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }) })
  .then(r => r.json()).then(() => { $stockSearch.value = ''; $popularSelect.value = ''; $addStockBtn.disabled = false; $addStockBtn.textContent = '+'; })
  .catch(() => { $addStockBtn.disabled = false; $addStockBtn.textContent = '+'; });
}

$addStockBtn.addEventListener('click', () => addStock());
$stockSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') addStock(); });
$popularSelect.addEventListener('change', () => addStock($popularSelect.value));

// ─── Init ────────────────────────────────────────────────────────────────────
initChart();
