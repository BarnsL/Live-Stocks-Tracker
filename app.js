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
const chart = echarts.init(chartNode);

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
  symbolInput.value = sym;
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
      text: `${symbol} · ${interval}  —  Bicolor Order Flow`,
      left: 14, top: 8,
      textStyle: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: 14, color: "#1d2218" },
    },
    legend: {
      top: 8, right: 14, itemWidth: 14, itemHeight: 8,
      textStyle: { fontFamily: "IBM Plex Mono, monospace", color: "#3f4739" },
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
  const symbol = symbolInput.value.trim().toUpperCase() || "AAPL";
  const interval = intervalInput.value;
  if (!silent) chart.showLoading({ text: "Loading…", color: BUY, maskColor: "rgba(250,247,241,.8)" });
  try {
    const bars = await fetchBars(symbol, interval);
    if (!silent) chart.hideLoading();
    if (bars.length) {
      chart.setOption(buildOption(symbol, interval, bars), true);
    } else {
      if (!silent) chart.hideLoading();
      console.warn("No data returned for", symbol);
    }
  } catch (err) {
    if (!silent) chart.hideLoading();
    console.error("Failed to fetch live data:", err);
  }
}

render();
setupPoll();
