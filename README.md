Live Stocks Tracker
===================

Lightweight local stock charting app using ECharts and yfinance with a chat-driven UI.

Features
- Binomial-volume candles: each candle body is split into buy/sell portions and colored separately.
- Live / cached bar data via `yfinance` (`/api/bars`).
- Symbol search (`/api/search`) with basic caching.
- Chat integration: send messages to the backend which forwards to Claude; assistant replies may include JSON/JS blocks that the client safely executes to modify the UI.
- Replaceable `buildOption(symbol, interval, bars)` at runtime (exposed as `window.buildOption`).
- Demo runner: `?demo=1` or call `runChatDemo()` in the browser to load a simple line chart.

Security & design notes
- The server binds to `127.0.0.1` only — do NOT expose this process to the public network.
- Claude API key is stored locally at `%APPDATA%/LiveStocksTracker/claude_key.txt` (set via the UI or `/api/save-key`).
- Assistant-sent code runs in the page context. The page exposes a limited set of helper globals (chart, `buildOption`, `render`, color constants, and safe DOM helpers). Review these helpers before enabling remote access.

Quick start
1. Create and activate a Python 3.11+ virtualenv. Example (Windows PowerShell):

```powershell
python -m venv .venv
& .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Run the server (the script finds a free port starting at 8080):

```powershell
python server.py
```

3. Open the URL printed by the server (e.g. http://localhost:8080). The page will auto-open in your default browser.

Using the chat assistant
- Click the chat toggle, save your Claude API key (starts with `sk-`) via the UI, then ask the assistant to change colors, add indicators, or return JS code.
- To instruct the assistant to run code on the page, it should return a JSON block like:

```json
```json
{"action":"execute","code":"/* JavaScript to run in the browser */"}
```
```

Developer notes
- Primary files:
  - `app.js` — client UI, ECharts option builder, chat integration and safe helpers.
  - `index.html` / `styles.css` — static UI assets.
  - `server.py` — minimal Python HTTP server: serves static files, proxies chat to Claude, and serves `/api/bars` and `/api/search`.
  - `requirements.txt` — Python dependencies used by the server.

- To experiment with assistant-driven UI changes, use the demo (`?demo=1`) or open the browser console and call `window.runChatDemo()`.

Troubleshooting
- If the assistant reports "No API key configured" save your Claude key in the chat panel or write the key to `%APPDATA%/LiveStocksTracker/claude_key.txt`.
- If charts look blank, check the server logs for `/api/bars` responses and ensure `yfinance` can fetch the symbol.

Contributing / Next steps
- Add unit tests for `server.py` endpoints.
- Harden chat handling and sandboxing if deploying the app to multi-user environments.

License
- (Choose a license or keep proprietary.)
