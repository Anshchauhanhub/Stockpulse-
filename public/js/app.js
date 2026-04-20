// ─── StockPulse Frontend ─────────────────────────────────────────────────────

const socket = io();

// State
let activeSymbol = 'AAPL';
let maxDataPoints = 50;
let chartData = {};   // { symbol: [{ price, timestamp }] }
let mainChart = null;
let tickCount = 0;

// ─── DOM Elements ────────────────────────────────────────────────────────────
const $watchlistItems = document.getElementById('watchlistItems');
const $chartSymbol = document.getElementById('chartSymbol');
const $activityFeed = document.getElementById('activityFeed');
const $statusDot = document.getElementById('statusDot');
const $statusText = document.getElementById('statusText');
const $statTicks = document.getElementById('statTicks');
const $statSymbols = document.getElementById('statSymbols');
const $statClients = document.getElementById('statClients');
const $statUptime = document.getElementById('statUptime');
const $statMongo = document.getElementById('statMongo');
const $liveClock = document.getElementById('liveClock');
const $stockSearch = document.getElementById('stockSearch');
const $popularSelect = document.getElementById('popularSelect');
const $addStockBtn = document.getElementById('addStockBtn');

// ─── Clock ───────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  $liveClock.textContent = now.toLocaleTimeString('en-US', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

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
      datasets: [{
        label: 'Price',
        data: [],
        borderColor: '#00d4ff',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#00d4ff',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          bodyFont: { family: 'JetBrains Mono', size: 13, weight: '600' },
          titleFont: { family: 'Inter', size: 11 },
          borderColor: 'rgba(75, 85, 99, 0.3)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: (ctx) => `$${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: { color: 'rgba(75, 85, 99, 0.15)', drawBorder: false },
          ticks: {
            color: '#64748b',
            font: { family: 'JetBrains Mono', size: 10 },
            maxTicksLimit: 8,
            maxRotation: 0,
          },
          border: { display: false }
        },
        y: {
          display: true,
          position: 'right',
          grid: { color: 'rgba(75, 85, 99, 0.15)', drawBorder: false },
          ticks: {
            color: '#64748b',
            font: { family: 'JetBrains Mono', size: 11 },
            callback: (v) => '$' + v.toFixed(2)
          },
          border: { display: false }
        }
      }
    }
  });
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

  // Dynamic color based on trend
  if (sliced.length >= 2) {
    const first = sliced[0].price;
    const last = sliced[sliced.length - 1].price;
    const color = last >= first ? '#00e676' : '#ff5252';
    const gradientCtx = mainChart.ctx;
    const gradient = gradientCtx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, last >= first ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 82, 82, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    mainChart.data.datasets[0].borderColor = color;
    mainChart.data.datasets[0].backgroundColor = gradient;
    mainChart.data.datasets[0].pointHoverBackgroundColor = color;
  }

  mainChart.update('none');
}

// ─── Watchlist Cards ─────────────────────────────────────────────────────────
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

    card.innerHTML = `
      <div class="stock-card-header">
        <div class="stock-symbol">${symbol}</div>
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

  // Flash effect
  if (card) {
    card.classList.remove('flash-green', 'flash-red');
    void card.offsetWidth; // force reflow
    card.classList.add(change >= 0 ? 'flash-green' : 'flash-red');
  }
}

// ─── Mini Sparkline ──────────────────────────────────────────────────────────
function drawSparkline(symbol) {
  const canvas = document.getElementById(`spark-${symbol}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const data = (chartData[symbol] || []).slice(-30);
  if (data.length < 2) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const prices = data.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const isGain = prices[prices.length - 1] >= prices[0];
  const color = isGain ? '#00e676' : '#ff5252';

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, isGain ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
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

  // Keep max 50 items
  while ($activityFeed.children.length > 50) {
    $activityFeed.removeChild($activityFeed.lastChild);
  }
}

// ─── Stats Update ────────────────────────────────────────────────────────────
function updateStats() {
  fetch('/api/stats')
    .then(r => r.json())
    .then(d => {
      $statTicks.textContent = d.totalTicks.toLocaleString();
      $statClients.textContent = d.connectedClients;
      $statMongo.textContent = d.mongoConnected ? '✓ Live' : '✗ Demo';
      $statMongo.style.color = d.mongoConnected ? 'var(--gain)' : 'var(--text-muted)';

      const s = d.uptime;
      if (s < 60) $statUptime.textContent = `${s}s`;
      else if (s < 3600) $statUptime.textContent = `${Math.floor(s/60)}m ${s%60}s`;
      else $statUptime.textContent = `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
    })
    .catch(() => {});
}
setInterval(updateStats, 3000);

// ─── Socket.io Events ───────────────────────────────────────────────────────
socket.on('connect', () => {
  $statusDot.classList.remove('disconnected');
  $statusText.textContent = 'Connected';
});

socket.on('disconnect', () => {
  $statusDot.classList.add('disconnected');
  $statusText.textContent = 'Disconnected';
});

socket.on('init', (data) => {
  const { symbols, prices, totalTicks } = data;
  tickCount = totalTicks;
  $statTicks.textContent = tickCount.toLocaleString();
  $statSymbols.textContent = symbols.length;

  // Initialize chart data arrays
  symbols.forEach(s => {
    if (!chartData[s]) chartData[s] = [];
    if (prices[s]) {
      // Check if data already exists to avoid duplicates on re-init
      if (chartData[s].length === 0) {
        chartData[s].push({ price: prices[s].price, timestamp: prices[s].timestamp || new Date() });
      }
    }
  });

  if (!activeSymbol || !symbols.includes(activeSymbol)) {
    activeSymbol = symbols[0];
  }
  $chartSymbol.textContent = activeSymbol;

  renderWatchlist(symbols, prices);
  updateChart();
  updateStats();
});

socket.on('watchlist_updated', (data) => {
  const { symbols, newSymbol } = data;
  $statSymbols.textContent = symbols.length;
  
  // Initialize data array for new symbol
  if (newSymbol && !chartData[newSymbol]) {
    chartData[newSymbol] = [];
  }
  
  // Re-render watchlist with current latest prices
  // We can fetch prices from the server or just keep existing
  fetch('/api/symbols')
    .then(r => r.json())
    .then(d => {
      renderWatchlist(d.symbols, d.prices);
      if (newSymbol) selectSymbol(newSymbol);
    });
});

socket.on('tick', (tick) => {
  tickCount++;
  $statTicks.textContent = tickCount.toLocaleString();

  // Store tick data
  if (!chartData[tick.symbol]) chartData[tick.symbol] = [];
  chartData[tick.symbol].push({ price: tick.price, timestamp: tick.timestamp });

  // Keep max 500 data points per symbol in memory
  if (chartData[tick.symbol].length > 500) {
    chartData[tick.symbol] = chartData[tick.symbol].slice(-500);
  }

  // Update card
  updateCardPrice(tick.symbol, tick.price, tick.change, tick.changePercent, tick.volume);

  // Update sparkline
  drawSparkline(tick.symbol);

  // Update main chart if this is the active symbol
  if (tick.symbol === activeSymbol) {
    updateChart();
  }

  // Activity feed
  addActivityItem(tick);
});

// ─── Chart Controls ──────────────────────────────────────────────────────────
document.querySelectorAll('.chart-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    maxDataPoints = parseInt(btn.dataset.points);
    updateChart();
  });
});

// ─── Search Logic ────────────────────────────────────────────────────────────
function addStock(symbolToUse = null) {
  const symbol = (symbolToUse || $stockSearch.value).trim().toUpperCase();
  if (!symbol) return;
  
  const originalBtnText = $addStockBtn.textContent;
  $addStockBtn.disabled = true;
  $addStockBtn.textContent = '...';

  fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol })
  })
  .then(r => r.json())
  .then(data => {
    $stockSearch.value = '';
    $popularSelect.value = ''; // Reset dropdown
    $addStockBtn.disabled = false;
    $addStockBtn.textContent = originalBtnText;
  })
  .catch(err => {
    console.error('Error adding stock:', err);
    $addStockBtn.disabled = false;
    $addStockBtn.textContent = originalBtnText;
  });
}

$addStockBtn.addEventListener('click', () => addStock());
$stockSearch.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addStock();
});

// Dropdown listener
$popularSelect.addEventListener('change', () => {
  addStock($popularSelect.value);
});

// ─── Init ────────────────────────────────────────────────────────────────────
initChart();
