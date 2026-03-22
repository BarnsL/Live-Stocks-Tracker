Live Stocks Tracker
===================

**Version 3.3.0** — Mobile UX fixes: chart title/legend overlap, search results opacity, tooltip confinement

Lightweight local stock charting app built with ECharts 5, vanilla JS, and a Python backend (yfinance). Features a unified AI chat panel with both a local Ollama model (Qwen 2.5-Coder) and Claude for controlling the chart via natural language.

## Features

### AI Chat (Local + Claude)
- Unified chat panel with model selector — switch between **Local Qwen** and **Claude** mid-conversation.
- Local model runs offline via [Ollama](https://ollama.com/) (no API key needed).
- Claude integration for more complex requests (requires API key).
- Both models can execute chart commands: change chart types, open symbols, manage tabs/bookmarks, toggle dark/light mode, and more.
- Local model also provides stock analysis and trading opinions when asked.

### Charts
- **7 chart display modes**: candles, line, area, OHLC, Heikin-Ashi, mountain, bar.
- Binomial-volume candles: each candle body is split into buy/sell portions and colored separately.
- Live/cached bar data via `yfinance`.
- Multiple intervals: 1m, 5m, 15m, 1h, 1d.
- **1-second live polling** (default) for near-real-time updates.
- Dark and light mode support with instant chart re-render.

### Tabs & Bookmarks
- Open multiple symbols as tabs for quick switching.
- Bookmark favorite symbols for persistent access.
- All state persists across sessions (localStorage + server-side workspace).

### Mobile
- Chart title text shifts down on small screens so it doesn't overlap the Buy Vol / Sell Vol legend items.
- Search results dropdown renders at full opacity with elevated z-index — the chart is no longer visible through the results.
- Tooltip data popup is confined within the chart container and cannot overflow left or right on mobile viewports.

### Other
- Symbol search with caching.
- Dynamic chart tips and kicker text.
- Auto-polling with configurable intervals (1s, 5s, 10s, 30s, 60s).
- Server-side workspace persistence (`%APPDATA%\LiveStocksTracker\workspace.json`).

## Quick Start

1. Download and run `LiveStocksTracker.exe` — a browser tab opens automatically.
2. The local AI model works out of the box if [Ollama](https://ollama.com/) is installed with `qwen2.5-coder:1.5b`.
3. For Claude: create a key at https://console.anthropic.com/settings/keys and enter it in the chat panel.
4. Click the chat button (lower-right), pick a model, and start chatting.

### Local Model Setup

```bash
# Install Ollama from https://ollama.com/
ollama pull qwen2.5-coder:1.5b
```

The app auto-detects the local model when Ollama is running.

## Development Setup

1. Create and activate a Python 3.11+ virtualenv:

```powershell
python -m venv .venv
& .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Start the server:

```powershell
python server.py
```

3. Opens automatically at http://localhost:8080.

## Building the Executable

```powershell
pyinstaller build.spec --noconfirm
```

Produces `dist\LiveStocksTracker.exe`.

## Project Structure

| File | Description |
|------|-------------|
| `app.js` | Client UI, ECharts chart builder, chat integration, sandbox helpers |
| `index.html` | Page structure and layout |
| `styles.css` | Styling with dark mode support |
| `server.py` | Python HTTP server: static files, yfinance proxy, Claude proxy, local model proxy, workspace API |
| `local_model.py` | Ollama wrapper for the local Qwen model |
| `build.spec` | PyInstaller build configuration |
| `requirements.txt` | Python dependencies |

## Security Notes
- Server binds to `127.0.0.1` only — not exposed to the network.
- Claude API key stored locally at `%APPDATA%\LiveStocksTracker\claude_key.txt`.
- AI-generated code runs in a sandboxed `new Function()` scope with a limited set of helper globals.

## Troubleshooting
- **"No API key configured"** — Save your Claude key in the chat panel.
- **Blank chart** — Check server logs for `/api/bars` errors; ensure `yfinance` can fetch the symbol.
- **Local model not connecting** — Ensure Ollama is running (`ollama serve`) and the model is pulled.
- **Chat status dot is red** — Ollama is not reachable at `localhost:11434`.

## License
Proprietary
