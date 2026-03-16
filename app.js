// ── Diagnostics Log Capture ──
const _logBuffer = [];
const _maxLogs = 500;
function _captureLog(level, origFn, args) {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = Array.from(args).map(a => {
    try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
    catch { return String(a); }
  }).join(' ');
  _logBuffer.push(`[${ts}] ${level}: ${msg}`);
  if (_logBuffer.length > _maxLogs) _logBuffer.shift();
  origFn.apply(console, args);
}
const _origLog = console.log, _origWarn = console.warn, _origError = console.error;
console.log = function() { _captureLog('LOG', _origLog, arguments); };
console.warn = function() { _captureLog('WARN', _origWarn, arguments); };
console.error = function() { _captureLog('ERR', _origError, arguments); };
window.addEventListener('error', (e) => {
  _logBuffer.push(`[${new Date().toISOString().slice(11,23)}] UNCAUGHT: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  _logBuffer.push(`[${new Date().toISOString().slice(11,23)}] UNHANDLED_PROMISE: ${e.reason}`);
});

function copyDiagnosticLogs() {
  const text = _logBuffer.length ? _logBuffer.join('\n') : '(no logs captured)';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-logs-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy Logs', 1500); }
  }).catch(() => alert('Failed to copy — check clipboard permissions'));
}

// ── Dark Mode Helpers ──
function enableDarkMode() {
  document.body.classList.add('dark');
}
function disableDarkMode() {
  document.body.classList.remove('dark');
}
/* ── constants ── */
const BUY = "#0d8a57";
const SELL = "#ca5a18";
const BUY_WICK = "#0f774d";
const SELL_WICK = "#a83a20";

/* ── DOM refs ── */
const chartNode = document.getElementById("chart");
const symbolInput = document.getElementById("symbol");
const intervalInput = document.getElementById("interval");
const refreshButton = document.getElementById("refresh");
const pollSelect = document.getElementById("poll");
const pollDot = document.getElementById("poll-indicator");
const searchResults = document.getElementById("search-results");
const stockTabsNode = document.getElementById("stock-tabs");
const bookmarkCurrentButton = document.getElementById("bookmark-current");
const stockBookmarksNode = document.getElementById("stock-bookmarks");
const chart = echarts.init(chartNode);

// Wire up Copy Logs button
document.getElementById('copy-logs-btn')?.addEventListener('click', copyDiagnosticLogs);

/* ── tabs + bookmarks persistence ── */
const WORKSPACE_KEY = "liveStocks.workspace.v1";

function normalizeSymbol(value) {
  return (value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.^-]/g, "")
    .slice(0, 15);
}

function loadWorkspaceState() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return { tabs: ["AAPL"], activeTab: 0, bookmarks: [] };
    const parsed = JSON.parse(raw);
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.map(normalizeSymbol).filter(Boolean)
      : [];
    const bookmarks = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks.map(normalizeSymbol).filter(Boolean)
      : [];
    const safeTabs = tabs.length ? Array.from(new Set(tabs)) : ["AAPL"];
    const activeTab = Number.isInteger(parsed.activeTab)
      ? Math.max(0, Math.min(parsed.activeTab, safeTabs.length - 1))
      : 0;
    return {
      tabs: safeTabs,
      activeTab,
      bookmarks: Array.from(new Set(bookmarks)),
    };
  } catch {
    return { tabs: ["AAPL"], activeTab: 0, bookmarks: [] };
  }
}

let workspaceState = loadWorkspaceState();

function saveWorkspaceState() {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaceState));
}

function ensureWorkspaceIntegrity() {
  if (!workspaceState.tabs.length) {
    workspaceState.tabs = ["AAPL"];
    workspaceState.activeTab = 0;
  }
  workspaceState.activeTab = Math.max(0, Math.min(workspaceState.activeTab, workspaceState.tabs.length - 1));
}

function setActiveSymbol(sym, addTabIfMissing = true) {
  const symbol = normalizeSymbol(sym) || "AAPL";
  let idx = workspaceState.tabs.indexOf(symbol);
  if (idx === -1 && addTabIfMissing) {
    workspaceState.tabs.push(symbol);
    idx = workspaceState.tabs.length - 1;
  }
  if (idx >= 0) workspaceState.activeTab = idx;
  symbolInput.value = symbol;
  saveWorkspaceState();
  renderWorkspaceUI();
}

function renderWorkspaceUI() {
  ensureWorkspaceIntegrity();

  stockTabsNode.innerHTML = workspaceState.tabs.map((sym, idx) => {
    const activeClass = idx === workspaceState.activeTab ? " active" : "";
    return `<div class="stock-tab${activeClass}" data-tab-idx="${idx}">
      <button type="button" class="stock-tab-btn" data-open-tab="${idx}">${sym}</button>
      <button type="button" class="stock-tab-close" data-close-tab="${idx}" title="Close tab">&times;</button>
    </div>`;
  }).join("");

  stockTabsNode.querySelectorAll("[data-open-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.openTab);
      const sym = workspaceState.tabs[idx];
      if (!sym) return;
      workspaceState.activeTab = idx;
      symbolInput.value = sym;
      saveWorkspaceState();
      renderWorkspaceUI();
      render();
    });
  });

  stockTabsNode.querySelectorAll("[data-close-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.closeTab);
      if (workspaceState.tabs.length <= 1) return;
      workspaceState.tabs.splice(idx, 1);
      if (workspaceState.activeTab >= workspaceState.tabs.length) {
        workspaceState.activeTab = workspaceState.tabs.length - 1;
      }
      if (idx < workspaceState.activeTab) {
        workspaceState.activeTab -= 1;
      }
      ensureWorkspaceIntegrity();
      symbolInput.value = workspaceState.tabs[workspaceState.activeTab];
      saveWorkspaceState();
      renderWorkspaceUI();
      render();
    });
  });

  const activeSymbol = workspaceState.tabs[workspaceState.activeTab] || "AAPL";
  const isBookmarked = workspaceState.bookmarks.includes(activeSymbol);
  bookmarkCurrentButton.textContent = isBookmarked ? "Bookmarked" : "Bookmark";

  stockBookmarksNode.innerHTML = workspaceState.bookmarks.map((sym) =>
    `<div class="stock-bookmark" data-bookmark="${sym}">
      <button type="button" class="stock-bookmark-btn" data-open-bookmark="${sym}">${sym}</button>
      <button type="button" class="stock-bookmark-remove" data-remove-bookmark="${sym}" title="Remove bookmark">&times;</button>
    </div>`
  ).join("");

  stockBookmarksNode.querySelectorAll("[data-open-bookmark]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = normalizeSymbol(btn.dataset.openBookmark);
      if (!sym) return;
      setActiveSymbol(sym, true);
      render();
    });
  });

  stockBookmarksNode.querySelectorAll("[data-remove-bookmark]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = normalizeSymbol(btn.dataset.removeBookmark);
      workspaceState.bookmarks = workspaceState.bookmarks.filter((x) => x !== sym);
      saveWorkspaceState();
      renderWorkspaceUI();
    });
  });
}

bookmarkCurrentButton.addEventListener("click", () => {
  const sym = normalizeSymbol(symbolInput.value) || "AAPL";
  const existing = workspaceState.bookmarks.indexOf(sym);
  if (existing >= 0) {
    workspaceState.bookmarks.splice(existing, 1);
  } else {
    workspaceState.bookmarks.push(sym);
  }
  workspaceState.bookmarks = Array.from(new Set(workspaceState.bookmarks));
  saveWorkspaceState();
  renderWorkspaceUI();
});

/* ── symbol search ── */
let searchTimeout = null;
let activeIndex = -1;

symbolInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const q = symbolInput.value.trim();
  if (q.length < 1) { closeSearch(); return; }
  searchTimeout = setTimeout(() => searchSymbols(q), 250);
});

symbolInput.addEventListener("keydown", (e) => {
  const items = searchResults.querySelectorAll(".search-item");
  if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); highlightItem(items); }
  else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlightItem(items); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIndex >= 0 && items[activeIndex]) pickSymbol(items[activeIndex].dataset.sym);
    else { closeSearch(); render(); }
  }
  else if (e.key === "Escape") closeSearch();
});

symbolInput.addEventListener("focus", () => {
  symbolInput.select();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-bar")) closeSearch();
});

async function searchSymbols(q) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const items = await res.json();
    if (!items.length) { closeSearch(); return; }
    activeIndex = -1;
    searchResults.innerHTML = items.map((it) =>
      `<div class="search-item" data-sym="${it.symbol}"><span class="sym">${it.symbol}</span><span class="name">${it.name}</span></div>`
    ).join("");
    searchResults.classList.add("open");
    searchResults.querySelectorAll(".search-item").forEach((el) => {
      el.addEventListener("click", () => pickSymbol(el.dataset.sym));
    });
  } catch { /* ignore */ }
}

function pickSymbol(sym) {
  setActiveSymbol(sym, true);
  closeSearch();
  render();
}

function closeSearch() {
  searchResults.classList.remove("open");
  searchResults.innerHTML = "";
  activeIndex = -1;
}

function highlightItem(items) {
  items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
}

/* ────────────────────────────────────────────
   Bicolor candlestick renderer
   Each candle body is split proportionally:
     bottom = buy portion (green)
     top    = sell portion (orange)
   ──────────────────────────────────────────── */
function renderBicolorCandle(params, api) {
  // data dims: [catIdx, open, close, low, high, buyRatio]
  const xVal = api.value(0);
  const openVal = api.value(1);
  const closeVal = api.value(2);
  const lowVal = api.value(3);
  const highVal = api.value(4);
  const buyRatio = api.value(5);

  const xPx = api.coord([xVal, openVal])[0];
  const openPx = api.coord([xVal, openVal])[1];
  const closePx = api.coord([xVal, closeVal])[1];
  const highPx = api.coord([xVal, highVal])[1];
  const lowPx = api.coord([xVal, lowVal])[1];

  const halfW = api.size([1, 0])[0] * 0.34;

  // Pixel-space: lower y → higher price
  const bodyTop = Math.min(openPx, closePx);
  const bodyBot = Math.max(openPx, closePx);
  const bodyH = Math.max(bodyBot - bodyTop, 1);

  const sellH = bodyH * (1 - buyRatio);
  const buyH = bodyH - sellH;

  const wColor = buyRatio >= 0.5 ? BUY_WICK : SELL_WICK;

  return {
    type: "group",
    children: [
      // upper wick
      { type: "line", shape: { x1: xPx, y1: highPx, x2: xPx, y2: bodyTop }, style: { stroke: wColor, lineWidth: 1 } },
      // lower wick
      { type: "line", shape: { x1: xPx, y1: bodyBot, x2: xPx, y2: lowPx }, style: { stroke: wColor, lineWidth: 1 } },
      // sell portion (top of body)
      { type: "rect", shape: { x: xPx - halfW, y: bodyTop, width: halfW * 2, height: sellH }, style: { fill: SELL } },
      // buy portion (bottom of body)
      { type: "rect", shape: { x: xPx - halfW, y: bodyTop + sellH, width: halfW * 2, height: buyH }, style: { fill: BUY } },
    ],
  };
}

/* ── data fetching (live only) ── */
async function fetchBars(symbol, interval) {
  const url = `/api/bars?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

/* ── chart option builder ── */
function _titleColor() { return document.body.classList.contains('dark') ? '#e0e0e0' : '#1d2218'; }
function _legendColor() { return document.body.classList.contains('dark') ? '#b0b0b0' : '#3f4739'; }

function buildOption(symbol, interval, bars) {
  const times = bars.map((b) => b.time);

  // Custom candle data: [catIdx, open, close, low, high, buyRatio]
  const candleData = bars.map((b, i) => {
    const tot = b.buyVolume + b.sellVolume;
    return [i, b.open, b.close, b.low, b.high, tot > 0 ? b.buyVolume / tot : 0.5];
  });

  const buyVols = bars.map((b) => b.buyVolume);
  const sellVols = bars.map((b) => b.sellVolume);

  return {
    animation: true,
    animationDuration: 500,
    title: {
      text: `${symbol} · ${interval}  —  Binomial Volume Candles`,
      left: 14, top: 8,
      textStyle: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: 14, color: _titleColor() },
    },
    legend: {
      top: 8, right: 14, itemWidth: 14, itemHeight: 8,
      textStyle: { fontFamily: "IBM Plex Mono, monospace", color: _legendColor() },
      data: ["Price", "Buy Vol", "Sell Vol"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(23,26,21,.92)",
      borderWidth: 0,
      textStyle: { color: "#f5f6ef", fontFamily: "IBM Plex Mono, monospace" },
      formatter(params) {
        if (!params?.length) return "";
        const b = bars[params[0].dataIndex];
        if (!b) return "";
        const tot = b.buyVolume + b.sellVolume;
        const bp = tot ? ((b.buyVolume / tot) * 100).toFixed(1) : "–";
        const sp = tot ? ((b.sellVolume / tot) * 100).toFixed(1) : "–";
        return [
          `<b>${b.time}</b>`,
          `O ${b.open}  H ${b.high}  L ${b.low}  C ${b.close}`,
          `<span style="color:${BUY}">▮ Buy  ${b.buyVolume.toLocaleString()} (${bp}%)</span>`,
          `<span style="color:${SELL}">▮ Sell ${b.sellVolume.toLocaleString()} (${sp}%)</span>`,
          `Total ${tot.toLocaleString()}`,
        ].join("<br>");
      },
    },
    grid: [
      { left: 62, right: 20, top: 56, height: "52%" },
      { left: 62, right: 20, top: "66%", height: "24%" },
    ],
    xAxis: [
      {
        type: "category", data: times, boundaryGap: true,
        axisLine: { lineStyle: { color: "#a6ad9d" } },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: "category", gridIndex: 1, data: times, boundaryGap: true,
        axisLabel: { color: "#5f6858", fontFamily: "IBM Plex Mono, monospace", fontSize: 10 },
        axisLine: { lineStyle: { color: "#a6ad9d" } },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true, splitNumber: 5,
        axisLabel: { color: "#4c5545", fontFamily: "IBM Plex Mono, monospace" },
        splitLine: { lineStyle: { color: "rgba(63,71,57,.14)" } },
      },
      {
        gridIndex: 1, splitNumber: 3,
        axisLabel: {
          color: "#4c5545", fontFamily: "IBM Plex Mono, monospace",
          formatter: (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "k" : v),
        },
        splitLine: { lineStyle: { color: "rgba(63,71,57,.12)" } },
      },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1], start: 60, end: 100 },
      { show: true, type: "slider", xAxisIndex: [0, 1], bottom: 10, left: 62, right: 20, height: 18, brushSelect: false },
    ],
    series: [
      {
        name: "Price",
        type: "custom",
        renderItem: renderBicolorCandle,
        encode: { x: 0, y: [1, 2, 3, 4] },
        data: candleData,
        clip: true,
        z: 10,
      },
      {
        name: "Buy Vol", type: "bar",
        xAxisIndex: 1, yAxisIndex: 1,
        stack: "vol", data: buyVols, barWidth: "65%",
        itemStyle: { color: BUY, opacity: 0.88 },
        emphasis: { itemStyle: { opacity: 1 } },
      },
      {
        name: "Sell Vol", type: "bar",
        xAxisIndex: 1, yAxisIndex: 1,
        stack: "vol", data: sellVols, barWidth: "65%",
        itemStyle: { color: SELL, opacity: 0.88 },
        emphasis: { itemStyle: { opacity: 1 } },
      },
    ],
  };
}

// Expose mutable buildOption to allow chatbot to replace it at runtime.
window.buildOption = buildOption;

function setBuildOption(fn) {
  try {
    if (typeof fn === 'function') {
      try { render(true); } catch (e) { console.warn('setBuildOption render failed', e); }
      return true;
    }
  } catch (e) { console.warn('setBuildOption failed', e); }
  return false;
}

// Preserve original builder so we can restore candles
window._originalBuildOption = buildOption;

// ── Line chart builder ──
function lineBuildOption(symbol, interval, bars) {
  const times = bars.map(b => b.time);
  const closes = bars.map(b => b.close);
  return {
    animation: true,
    title: { text: `${symbol} · ${interval} — Line`, left: 14, top: 8, textStyle: { fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: _titleColor() } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, boundaryGap: false, axisLine: { lineStyle: { color: '#a6ad9d' } }, axisLabel: { fontSize: 10 } },
    yAxis: { scale: true },
    grid: { left: 62, right: 20, top: 56, bottom: 50 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 10, left: 62, right: 20 }],
    series: [{ name: 'Close', type: 'line', data: closes, smooth: false, symbol: 'none', lineStyle: { width: 2, color: '#3ba272' } }],
  };
}

// ── Area chart builder ──
function areaBuildOption(symbol, interval, bars) {
  const times = bars.map(b => b.time);
  const closes = bars.map(b => b.close);
  return {
    animation: true,
    title: { text: `${symbol} · ${interval} — Area`, left: 14, top: 8, textStyle: { fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: _titleColor() } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, boundaryGap: false, axisLine: { lineStyle: { color: '#a6ad9d' } }, axisLabel: { fontSize: 10 } },
    yAxis: { scale: true, splitLine: { lineStyle: { color: 'rgba(63,71,57,.14)' } } },
    grid: { left: 62, right: 20, top: 56, bottom: 50 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 10, left: 62, right: 20 }],
    series: [{ name: 'Close', type: 'line', data: closes, smooth: true, showSymbol: false, lineStyle: { width: 2, color: BUY }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(13,138,87,0.35)' }, { offset: 1, color: 'rgba(13,138,87,0.02)' }] } } }],
  };
}

// ── OHLC bar chart builder ──
function ohlcBuildOption(symbol, interval, bars) {
  const times = bars.map(b => b.time);
  const ohlcData = bars.map(b => [b.open, b.close, b.low, b.high]);
  const buyVols = bars.map(b => b.buyVolume);
  const sellVols = bars.map(b => b.sellVolume);
  return {
    animation: true,
    title: { text: `${symbol} · ${interval} — OHLC`, left: 14, top: 8, textStyle: { fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: _titleColor() } },
    legend: { top: 8, right: 14, data: ['Price', 'Buy Vol', 'Sell Vol'] },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: [{ left: 62, right: 20, top: 56, height: '52%' }, { left: 62, right: 20, top: '66%', height: '24%' }],
    xAxis: [{ type: 'category', data: times, axisLabel: { show: false } }, { type: 'category', gridIndex: 1, data: times, axisLabel: { fontSize: 10 } }],
    yAxis: [{ scale: true }, { gridIndex: 1, splitNumber: 3 }],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 }, { type: 'slider', xAxisIndex: [0, 1], bottom: 10 }],
    series: [
      { name: 'Price', type: 'candlestick', data: ohlcData, itemStyle: { color: BUY, color0: SELL, borderColor: BUY, borderColor0: SELL } },
      { name: 'Buy Vol', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'vol', data: buyVols, barWidth: '65%', itemStyle: { color: BUY, opacity: 0.88 } },
      { name: 'Sell Vol', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'vol', data: sellVols, barWidth: '65%', itemStyle: { color: SELL, opacity: 0.88 } },
    ],
  };
}

// ── Heikin-Ashi builder ──
function heikinAshiBuildOption(symbol, interval, bars) {
  const times = bars.map(b => b.time);
  const ha = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (ha[i - 1][0] + ha[i - 1][1]) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    ha.push([haOpen, haClose, haLow, haHigh]);
  }
  const buyVols = bars.map(b => b.buyVolume);
  const sellVols = bars.map(b => b.sellVolume);
  return {
    animation: true,
    title: { text: `${symbol} · ${interval} — Heikin-Ashi`, left: 14, top: 8, textStyle: { fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: _titleColor() } },
    legend: { top: 8, right: 14, data: ['Price', 'Buy Vol', 'Sell Vol'] },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: [{ left: 62, right: 20, top: 56, height: '52%' }, { left: 62, right: 20, top: '66%', height: '24%' }],
    xAxis: [{ type: 'category', data: times, axisLabel: { show: false } }, { type: 'category', gridIndex: 1, data: times, axisLabel: { fontSize: 10 } }],
    yAxis: [{ scale: true }, { gridIndex: 1, splitNumber: 3 }],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 }, { type: 'slider', xAxisIndex: [0, 1], bottom: 10 }],
    series: [
      { name: 'Price', type: 'candlestick', data: ha, itemStyle: { color: BUY, color0: SELL, borderColor: BUY_WICK, borderColor0: SELL_WICK } },
      { name: 'Buy Vol', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'vol', data: buyVols, barWidth: '65%', itemStyle: { color: BUY, opacity: 0.88 } },
      { name: 'Sell Vol', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'vol', data: sellVols, barWidth: '65%', itemStyle: { color: SELL, opacity: 0.88 } },
    ],
  };
}

// ── Mountain (filled line with gradient) builder ──
function mountainBuildOption(symbol, interval, bars) {
  const times = bars.map(b => b.time);
  const closes = bars.map(b => b.close);
  const min = Math.min(...closes);
  return {
    animation: true,
    title: { text: `${symbol} · ${interval} — Mountain`, left: 14, top: 8, textStyle: { fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: _titleColor() } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, boundaryGap: false, axisLabel: { fontSize: 10 } },
    yAxis: { scale: true, min: min * 0.998 },
    grid: { left: 62, right: 20, top: 56, bottom: 50 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 10, left: 62, right: 20 }],
    series: [{ name: 'Close', type: 'line', data: closes, smooth: false, showSymbol: false, lineStyle: { width: 1.5, color: '#4a90d9' },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(74,144,217,0.45)' }, { offset: 1, color: 'rgba(74,144,217,0.03)' }] } } }],
  };
}

// ── Bar (close-price bars) builder ──
function barBuildOption(symbol, interval, bars) {
  const times = bars.map(b => b.time);
  const closes = bars.map(b => b.close);
  const prev = [closes[0], ...closes.slice(0, -1)];
  const colors = closes.map((c, i) => c >= prev[i] ? BUY : SELL);
  return {
    animation: true,
    title: { text: `${symbol} · ${interval} — Close Bars`, left: 14, top: 8, textStyle: { fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: _titleColor() } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, axisLabel: { fontSize: 10 } },
    yAxis: { scale: true },
    grid: { left: 62, right: 20, top: 56, bottom: 50 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 10, left: 62, right: 20 }],
    series: [{ name: 'Close', type: 'bar', data: closes.map((c, i) => ({ value: c, itemStyle: { color: colors[i] } })), barWidth: '70%' }],
  };
}

// Extended setChartType with all modes
const _chartBuilders = {
  candles: buildOption,
  line: lineBuildOption,
  area: areaBuildOption,
  ohlc: ohlcBuildOption,
  heikinashi: heikinAshiBuildOption,
  mountain: mountainBuildOption,
  bar: barBuildOption,
};

let _currentChartType = 'candles';

function setChartType(type) {
  const key = (type || '').toLowerCase().replace(/[^a-z]/g, '');
  const builder = _chartBuilders[key];
  if (!builder) return false;
  _currentChartType = key;
  setBuildOption(builder);
  return true;
}
function getChartType() { return _currentChartType; }
function listChartTypes() { return Object.keys(_chartBuilders); }

function setChartToLine() { return setChartType('line'); }
function setChartToCandles() { return setChartType('candles'); }
function setChartToArea() { return setChartType('area'); }
function setChartToOHLC() { return setChartType('ohlc'); }
function setChartToHeikinAshi() { return setChartType('heikinashi'); }
function setChartToMountain() { return setChartType('mountain'); }
function setChartToBar() { return setChartType('bar'); }

// ── Workspace helpers for chatbot ──
function addTab(sym) {
  const s = normalizeSymbol(sym);
  if (!s) return false;
  if (!workspaceState.tabs.includes(s)) workspaceState.tabs.push(s);
  saveWorkspaceState(); renderWorkspaceUI();
  return true;
}
function removeTab(sym) {
  const s = normalizeSymbol(sym);
  const idx = workspaceState.tabs.indexOf(s);
  if (idx === -1 || workspaceState.tabs.length <= 1) return false;
  workspaceState.tabs.splice(idx, 1);
  if (workspaceState.activeTab >= workspaceState.tabs.length) workspaceState.activeTab = workspaceState.tabs.length - 1;
  symbolInput.value = workspaceState.tabs[workspaceState.activeTab];
  saveWorkspaceState(); renderWorkspaceUI(); render();
  return true;
}
function closeAllTabs() {
  workspaceState.tabs = [workspaceState.tabs[workspaceState.activeTab] || 'AAPL'];
  workspaceState.activeTab = 0;
  symbolInput.value = workspaceState.tabs[0];
  saveWorkspaceState(); renderWorkspaceUI(); render();
  return true;
}
function switchTab(sym) {
  const s = normalizeSymbol(sym);
  const idx = workspaceState.tabs.indexOf(s);
  if (idx === -1) return false;
  workspaceState.activeTab = idx;
  symbolInput.value = s;
  saveWorkspaceState(); renderWorkspaceUI(); render();
  return true;
}
function switchTabByIndex(i) {
  if (i < 0 || i >= workspaceState.tabs.length) return false;
  workspaceState.activeTab = i;
  symbolInput.value = workspaceState.tabs[i];
  saveWorkspaceState(); renderWorkspaceUI(); render();
  return true;
}
function getTabs() { return [...workspaceState.tabs]; }
function getActiveTab() { return workspaceState.tabs[workspaceState.activeTab] || 'AAPL'; }
function getActiveTabIndex() { return workspaceState.activeTab; }
function addBookmark(sym) {
  const s = normalizeSymbol(sym);
  if (!s || workspaceState.bookmarks.includes(s)) return false;
  workspaceState.bookmarks.push(s);
  saveWorkspaceState(); renderWorkspaceUI();
  return true;
}
function removeBookmark(sym) {
  const s = normalizeSymbol(sym);
  const idx = workspaceState.bookmarks.indexOf(s);
  if (idx === -1) return false;
  workspaceState.bookmarks.splice(idx, 1);
  saveWorkspaceState(); renderWorkspaceUI();
  return true;
}
function clearBookmarks() {
  workspaceState.bookmarks = [];
  saveWorkspaceState(); renderWorkspaceUI();
  return true;
}
function getBookmarks() { return [...workspaceState.bookmarks]; }
function isBookmarked(sym) { return workspaceState.bookmarks.includes(normalizeSymbol(sym)); }
function openSymbol(sym) { setActiveSymbol(sym, true); render(); return true; }
function setInterval_(intv) {
  const valid = ['1m','5m','15m','1h','1d'];
  if (!valid.includes(intv)) return false;
  intervalInput.value = intv; render();
  return true;
}

// Make all helpers available on window
Object.assign(window, {
  setChartType, getChartType, listChartTypes, setBuildOption,
  setChartToLine, setChartToCandles, setChartToArea, setChartToOHLC,
  setChartToHeikinAshi, setChartToMountain, setChartToBar,
  addTab, removeTab, closeAllTabs, switchTab, switchTabByIndex,
  getTabs, getActiveTab, getActiveTabIndex,
  addBookmark, removeBookmark, clearBookmarks, getBookmarks, isBookmarked,
  openSymbol, setInterval: setInterval_,
  enableDarkMode, disableDarkMode,
  workspaceState, renderWorkspaceUI, saveWorkspaceState,
});

/* ── render is defined below with poll support ── */

refreshButton.addEventListener("click", render);
intervalInput.addEventListener("change", render);
pollSelect.addEventListener("change", setupPoll);
window.addEventListener("resize", () => chart.resize());

/* ── auto-poll ── */
let pollTimer = null;

function setupPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
  const secs = parseInt(pollSelect.value, 10);
  if (secs > 0) {
    pollDot.classList.add("live");
    pollTimer = setInterval(() => render(true), secs * 1000);
  } else {
    pollDot.classList.remove("live");
  }
}

/* silent render for poll — no loading spinner */
const _origRender = render;
async function render(silent) {
  const symbol = normalizeSymbol(symbolInput.value) || "AAPL";
  symbolInput.value = symbol;

  if (workspaceState.tabs[workspaceState.activeTab] !== symbol) {
    setActiveSymbol(symbol, true);
  }

  const interval = intervalInput.value;
  if (!silent) chart.showLoading({ text: "Loading…", color: BUY, maskColor: "rgba(250,247,241,.8)" });
  try {
    const bars = await fetchBars(symbol, interval);
    if (!silent) chart.hideLoading();
    if (bars.length) {
      const builder = _chartBuilders[_currentChartType] || buildOption;
      chart.setOption(builder(symbol, interval, bars), true);
    } else {
      if (!silent) chart.hideLoading();
      console.warn("No data returned for", symbol);
    }
  } catch (err) {
    if (!silent) chart.hideLoading();
    console.error("Failed to fetch live data:", err);
  }
}

setActiveSymbol(workspaceState.tabs[workspaceState.activeTab] || "AAPL", true);
render();
setupPoll();

/* ── Claude Chat ──────────────────────────────────── */

const chatToggle = document.getElementById("chat-toggle");
const chatPanel = document.getElementById("chat-panel");
const chatClose = document.getElementById("chat-close");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatKeyBanner = document.getElementById("chat-key-banner");
const claudeKeyInput = document.getElementById("claude-key");
const saveKeyBtn = document.getElementById("save-key");
const chatImageBtn = document.getElementById("chat-image-btn");
const chatImageUpload = document.getElementById("chat-image-upload");
const chatImagePreview = document.getElementById("chat-image-preview");

let chatImages = [];

let chatHistory = [];

// Check if API key exists on load
fetch("/api/key-status").then(r => r.json()).then(d => {
  if (d.has_key) chatKeyBanner.classList.add("hidden");
}).catch(() => {});

chatToggle.addEventListener("click", () => {
  chatPanel.classList.add("open");
  chatToggle.classList.add("hidden");
  chatInput.focus();
});

chatClose.addEventListener("click", () => {
  chatPanel.classList.remove("open");
  chatToggle.classList.remove("hidden");
});

saveKeyBtn.addEventListener("click", async () => {
  const key = claudeKeyInput.value.trim();
  if (!key) return;
  try {
    const res = await fetch("/api/save-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (data.ok) {
      chatKeyBanner.classList.add("hidden");
      appendMsg("system", "API key saved.");
    } else {
      appendMsg("system", data.error || "Failed to save key");
    }
  } catch (e) {
    appendMsg("system", "Error saving key: " + e.message);
  }
});

chatSend.addEventListener("click", sendChat);
chatImageBtn.addEventListener("click", () => {
  chatImageUpload.click();
});

chatImageUpload.addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  if (files.length + chatImages.length > 5) {
    alert("You can upload up to 5 images per message.");
    return;
  }
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 50 * 1024 * 1024) {
      alert(`Image ${file.name} is too large (max 50MB).`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      chatImages.push({ name: file.name, data: ev.target.result });
      renderImagePreview();
    };
    reader.readAsDataURL(file);
  }
  chatImageUpload.value = "";
});

function renderImagePreview() {
  chatImagePreview.innerHTML = chatImages.map((img, i) =>
    `<div class="img-thumb"><img src="${img.data}" alt="img"/><button type="button" data-idx="${i}" title="Remove">&times;</button></div>`
  ).join("");
  chatImagePreview.querySelectorAll("button").forEach(btn => {
    btn.onclick = () => {
      chatImages.splice(parseInt(btn.dataset.idx), 1);
      renderImagePreview();
    };
  });
}
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

function appendMsg(role, text) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  if (role === "assistant") {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function renderMarkdown(text) {
  // Minimal markdown: code blocks, inline code, bold, newlines
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function sendChat() {

  const text = chatInput.value.trim();
  if (!text && chatImages.length === 0) return;

  chatInput.value = "";
  if (text) appendMsg("user", text);
  if (chatImages.length) {
    for (const img of chatImages) {
      appendMsg("user", `[Image: ${img.name}]`);
    }
  }
  chatHistory.push({ role: "user", content: text, images: chatImages.map(img => ({ name: img.name })) });

  // Prepare messages for backend: strip 'images' property (Claude API does not allow extra fields)
  const safeMessages = chatHistory.map(({ role, content }) => ({ role, content }));
  // Show typing indicator
  const typing = document.createElement("div");
  typing.className = "chat-msg chat-typing";
  typing.textContent = "Claude is thinking…";
  chatMessages.appendChild(typing);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    // Get current app.js source for context
    const srcRes = await fetch("/app.js");
    const appSource = await srcRes.text();

    // Current chart state
    const sym = symbolInput.value.trim().toUpperCase() || "AAPL";
    const intv = intervalInput.value;
    const tabs = getTabs();
    const bmarks = getBookmarks();
    const chartState = `Symbol: ${sym}, Interval: ${intv}, Chart size: ${chartNode.offsetWidth}x${chartNode.offsetHeight}, Chart type: ${getChartType()}, Tabs: [${tabs.join(', ')}], Active tab: ${getActiveTab()} (#${getActiveTabIndex()}), Bookmarks: [${bmarks.join(', ')}]`;


    // Send as FormData if images, else JSON
    let res;
    if (chatImages.length) {
      const form = new FormData();
      form.append("messages", JSON.stringify(safeMessages));
      form.append("appSource", appSource);
      form.append("chartState", chartState);
      chatImages.forEach((img, i) => {
        // DataURL to Blob
        const arr = img.data.split(",");
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        form.append("image" + i, new Blob([u8arr], { type: mime }), img.name);
      });
      res = await fetch("/api/chat", { method: "POST", body: form });
    } else {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: safeMessages,
          appSource,
          chartState,
        }),
      });
    }
    chatImages = [];
    renderImagePreview();

    typing.remove();
    const data = await res.json();

    if (data.error) {
      appendMsg("system", data.error);
      chatHistory.pop(); // remove failed user msg
      return;
    }

    const reply = data.reply;
    chatHistory.push({ role: "assistant", content: reply });

    // Check for executable code block
    const codeMatch = reply.match(/```json\s*\n(\{[\s\S]*?\})\s*\n```/);
    if (codeMatch) {
      try {
        const action = JSON.parse(codeMatch[1]);
        if (action.action === "execute" && action.code) {
          // Show the explanation (text before/after the JSON block)
          const explanation = reply.replace(/```json\s*\n\{[\s\S]*?\}\s*\n```/, "").trim();
          if (explanation) appendMsg("assistant", explanation);

          // Debug: log the code to be executed
          console.log("[Claude EXECUTE]", action.code);
          appendMsg("system", "[Debug] Executing code: " + action.code);

          // Execute the code
          try {
            const fn = new Function(
              "chart", "echarts", "buildOption", "render",
              "BUY", "SELL", "symbolInput", "intervalInput", "pollSelect", "chartNode",
              "enableDarkMode", "disableDarkMode",
              "addTab", "removeTab", "closeAllTabs", "switchTab", "switchTabByIndex",
              "getTabs", "getActiveTab", "getActiveTabIndex",
              "addBookmark", "removeBookmark", "clearBookmarks", "getBookmarks", "isBookmarked",
              "openSymbol", "setInterval_",
              "setChartType", "getChartType", "listChartTypes",
              "setChartToLine", "setChartToCandles", "setChartToArea", "setChartToOHLC",
              "setChartToHeikinAshi", "setChartToMountain", "setChartToBar",
              "setBuildOption", "workspaceState", "saveWorkspaceState", "renderWorkspaceUI",
              action.code
            );
            fn(
              chart, echarts, buildOption, render,
              BUY, SELL, symbolInput, intervalInput, pollSelect, chartNode,
              enableDarkMode, disableDarkMode,
              addTab, removeTab, closeAllTabs, switchTab, switchTabByIndex,
              getTabs, getActiveTab, getActiveTabIndex,
              addBookmark, removeBookmark, clearBookmarks, getBookmarks, isBookmarked,
              openSymbol, setInterval_,
              setChartType, getChartType, listChartTypes,
              setChartToLine, setChartToCandles, setChartToArea, setChartToOHLC,
              setChartToHeikinAshi, setChartToMountain, setChartToBar,
              setBuildOption, workspaceState, saveWorkspaceState, renderWorkspaceUI
            );
            appendMsg("executed", "Code executed successfully.");
          } catch (execErr) {
            appendMsg("system", "Execution error: " + execErr.message);
          }
          return;
        }
      } catch { /* not valid JSON, show as normal reply */ }
    }

    // Normal text reply
    appendMsg("assistant", reply);

  } catch (err) {
    typing.remove();
    appendMsg("system", "Error: " + err.message);
    chatHistory.pop();
  }
}
