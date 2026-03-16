import gzip
import http.server
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser
from datetime import timezone, timedelta

import anthropic
import yfinance as yf

# Pacific Time: UTC-8 (PST) — fixed offset for display consistency
PACIFIC = timezone(timedelta(hours=-8), name="PST")


def resource_dir():
    """Return the directory where static files live.
    When frozen by PyInstaller this is the temp _MEIPASS folder;
    otherwise it's the script's own directory."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

PERIOD_MAP = {
    "1m": "1d",
    "5m": "5d",
    "15m": "5d",
    "1h": "1mo",
    "1d": "3mo",
}
ALLOWED_INTERVALS = set(PERIOD_MAP.keys())
SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-]{1,10}$")

# Simple in-memory cache: {key: (timestamp, data)}
_cache = {}
CACHE_TTL = {
    "1m": 10,
    "5m": 15,
    "15m": 30,
    "1h": 60,
    "1d": 120,
}

# Search results cache
_search_cache = {}

# Claude API key storage
_CLAUDE_KEY_FILE = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")),
    "LiveStocksTracker",
    "claude_key.txt",
)


def _load_claude_key() -> str:
    try:
        with open(_CLAUDE_KEY_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _save_claude_key(key: str):
    os.makedirs(os.path.dirname(_CLAUDE_KEY_FILE), exist_ok=True)
    with open(_CLAUDE_KEY_FILE, "w", encoding="utf-8") as f:
        f.write(key.strip())


class Handler(http.server.SimpleHTTPRequestHandler):
    def _handle_chat_core(self, messages, app_source, chart_state, images=None):
        api_key = _load_claude_key()
        if not api_key:
            self._json_response(401, {"error": "No API key configured"})
            return

        system_prompt = (
            "You are an expert assistant embedded in a live stock charting app "
            "(ECharts 5, vanilla JS, Python backend with yfinance). The user can "
            "ask you to modify the chart, add indicators, change colors, add "
            "features, manage tabs/bookmarks, or explain the code.\n\n"
            "When the user asks for a code change, return a JSON block wrapped in "
            "```json\\n{...}\\n``` with this schema:\n"
            '{"action":"execute","code":"<JavaScript to eval in browser>"}'
            "\n\nThe code runs in the page context. Available globals:\n"
            "- chart (ECharts instance)\n"
            "- buildOption(symbol, interval, bars) → option object\n"
            "- setBuildOption(fn) → replace the option builder at runtime\n"
            "- render(silent?) → re-fetches and redraws\n"
            "- BUY, SELL (color constants)\n"
            "- symbolInput, intervalInput, pollSelect (DOM inputs)\n"
            "- echarts (the library)\n\n"
            "CHART TYPE HELPERS:\n"
            "- setChartType(type) → switch chart: 'candles','line','area','ohlc','heikinashi','mountain','bar'\n"
            "- getChartType() → current chart type string\n"
            "- listChartTypes() → array of available type names\n"
            "- Shortcuts: setChartToLine(), setChartToCandles(), setChartToArea(), setChartToOHLC(), "
            "setChartToHeikinAshi(), setChartToMountain(), setChartToBar()\n\n"
            "TAB HELPERS:\n"
            "- addTab(sym) → add symbol as a new tab\n"
            "- removeTab(sym) → close a tab by symbol\n"
            "- closeAllTabs() → close all tabs except active\n"
            "- switchTab(sym) → switch to tab by symbol\n"
            "- switchTabByIndex(i) → switch to tab by index\n"
            "- getTabs() → array of open tab symbols\n"
            "- getActiveTab() → current active symbol\n"
            "- getActiveTabIndex() → current active tab index\n"
            "- openSymbol(sym) → open symbol (adds tab + renders)\n\n"
            "BOOKMARK HELPERS:\n"
            "- addBookmark(sym) → bookmark a symbol\n"
            "- removeBookmark(sym) → remove a bookmark\n"
            "- clearBookmarks() → remove all bookmarks\n"
            "- getBookmarks() → array of bookmarked symbols\n"
            "- isBookmarked(sym) → boolean\n\n"
            "OTHER:\n"
            "- enableDarkMode() / disableDarkMode()\n"
            "- setInterval_('5m') → change interval ('1m','5m','15m','1h','1d')\n"
            "- workspaceState, saveWorkspaceState(), renderWorkspaceUI()\n\n"
            "Tabs and bookmarks persist in localStorage automatically.\n\n"
            "You can call chart.setOption({...}, false) to merge new options, "
            "or override functions, or add event listeners.\n\n"
            "If the user just asks a question (no code change needed), respond "
            "normally in markdown without a JSON block.\n\n"
            "CURRENT APP.JS SOURCE:\n```javascript\n" + app_source + "\n```\n\n"
            "CURRENT CHART STATE:\n" + chart_state
        )

        # Optionally, include image info in the prompt if images are present
        if images:
            system_prompt += ("\n\nThe user has uploaded screenshots. "
                              "You may reference them as needed, but you cannot see their content directly.")

        try:
            client = anthropic.Anthropic(api_key=api_key)
            resp = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=system_prompt,
                messages=messages,
            )
            reply = resp.content[0].text if resp.content else ""
            self._json_response(200, {"reply": reply})
        except anthropic.AuthenticationError:
            self._json_response(401, {"error": "Invalid API key"})
        except Exception as exc:
            self._json_response(500, {"error": str(exc)})
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/bars":
            self._handle_bars(parsed)
        elif parsed.path == "/api/search":
            self._handle_search(parsed)
        elif parsed.path == "/api/key-status":
            self._json_response(200, {"has_key": bool(_load_claude_key())})
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len else b""
        if parsed.path == "/api/chat":
            self._handle_chat(body)
        elif parsed.path == "/api/save-key":
            self._handle_save_key(body)
        else:
            self.send_error(404)

    def _handle_chat(self, body):
        content_type = self.headers.get("Content-Type", "")
        if content_type.startswith("multipart/form-data"):
            # Handle multipart (with images)
            self._handle_chat_multipart(content_type, body)
        else:
            # Handle regular JSON
            try:
                data = json.loads(body)
                messages = data.get("messages", [])
                app_source = data.get("appSource", "")
                chart_state = data.get("chartState", "")
            except Exception as exc:
                self._json_response(400, {"error": f"Invalid JSON: {exc}"})
                return
            self._handle_chat_core(messages, app_source, chart_state, images=None)

    def _handle_chat_multipart(self, content_type, body):
        import email
        from io import BytesIO
        msg = email.message_from_bytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body)
        fields = {}
        images = []
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            name = part.get_param('name', header='content-disposition')
            if name is None:
                continue
            if name.startswith("image"):
                images.append({
                    "filename": part.get_filename(),
                    "content_type": part.get_content_type(),
                    "data": part.get_payload(decode=True)
                })
            else:
                fields[name] = part.get_payload(decode=True)
        # messages, appSource, chartState
        try:
            messages = json.loads(fields.get("messages", b"[]").decode("utf-8"))
            app_source = fields.get("appSource", b"").decode("utf-8")
            chart_state = fields.get("chartState", b"").decode("utf-8")
        except Exception as exc:
            self._json_response(400, {"error": f"Invalid form fields: {exc}"})
            return
        self._handle_chat_core(messages, app_source, chart_state, images)

    def _handle_save_key(self, body):
        try:
            data = json.loads(body)
            key = data.get("key", "").strip()
            if not key.startswith("sk-"):
                self._json_response(400, {"error": "Invalid key format"})
                return
            _save_claude_key(key)
            self._json_response(200, {"ok": True})
        except Exception as exc:
            self._json_response(500, {"error": str(exc)})

            api_key = _load_claude_key()
            if not api_key:
                self._json_response(401, {"error": "No API key configured"})
                return

            system_prompt = (
                "You are an expert assistant embedded in a live stock charting app "
                "(ECharts 5, vanilla JS, Python backend with yfinance). The user can "
                "ask you to modify the chart, add indicators, change colors, add "
                "features, or explain the code.\n\n"
                "When the user asks for a code change, return a JSON block wrapped in "
                "```json\\n{...}\\n``` with this schema:\n"
                '{"action":"execute","code":"<JavaScript to eval in browser>"}\n\n'
                "The code runs in the page context. Available globals:\n"
                "- chart (ECharts instance)\n"
                "- buildOption(symbol, interval, bars) → option object\n"
                "- render(silent?) → re-fetches and redraws\n"
                "- BUY, SELL (color constants)\n"
                "- symbolInput, intervalInput, pollSelect (DOM inputs)\n"
                "- echarts (the library)\n\n"
                "You can call chart.setOption({...}, false) to merge new options, "
                "or override functions, or add event listeners.\n\n"
                "If the user just asks a question (no code change needed), respond "
                "normally in markdown without a JSON block.\n\n"
                "CURRENT APP.JS SOURCE:\n```javascript\n" + app_source + "\n```\n\n"
                "CURRENT CHART STATE:\n" + chart_state
            )

            client = anthropic.Anthropic(api_key=api_key)
            resp = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=system_prompt,
                messages=messages,
            )

            reply = resp.content[0].text if resp.content else ""
            self._json_response(200, {"reply": reply})

        except anthropic.AuthenticationError:
            self._json_response(401, {"error": "Invalid API key"})
        except Exception as exc:
            self._json_response(500, {"error": str(exc)})

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        super().end_headers()

    def _handle_search(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        query = qs.get("q", [""])[0].strip().upper()[:20]
        if len(query) < 1:
            self._json_response(200, [])
            return

        # Check search cache (10 min TTL)
        cached = _search_cache.get(query)
        if cached and (time.time() - cached[0]) < 600:
            self._json_response(200, cached[1])
            return

        try:
            from yfinance import Search
            results = Search(query, max_results=12)
            items = []
            for q in getattr(results, "quotes", []):
                sym = q.get("symbol", "")
                name = q.get("shortname") or q.get("longname") or ""
                exchange = q.get("exchange", "")
                qtype = q.get("quoteType", "")
                if sym and qtype in ("EQUITY", "ETF", "INDEX", "MUTUALFUND", ""):
                    items.append({"symbol": sym, "name": name, "exchange": exchange})
            _search_cache[query] = (time.time(), items)
            self._json_response(200, items)
        except Exception:
            # Fallback: just try the symbol directly
            self._json_response(200, [{"symbol": query, "name": "", "exchange": ""}])

    def _handle_bars(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)

        symbol = qs.get("symbol", ["AAPL"])[0].upper()
        if not SYMBOL_RE.match(symbol):
            symbol = "AAPL"

        interval = qs.get("interval", ["5m"])[0]
        if interval not in ALLOWED_INTERVALS:
            interval = "5m"

        # Check cache
        cache_key = f"{symbol}:{interval}"
        ttl = CACHE_TTL.get(interval, 60)
        cached = _cache.get(cache_key)
        if cached and (time.time() - cached[0]) < ttl:
            self._json_response(200, cached[1])
            return

        period = PERIOD_MAP[interval]

        try:
            df = yf.Ticker(symbol).history(period=period, interval=interval)
            if df.empty:
                self._json_response(200, [])
                return

            bars = []
            for idx, row in df.iterrows():
                o = float(row["Open"])
                h = float(row["High"])
                l = float(row["Low"])
                c = float(row["Close"])
                v = int(row["Volume"])

                buy_ratio = (c - l) / (h - l) if h != l else 0.5
                buy_ratio = max(0.08, min(0.92, buy_ratio))
                bv = int(v * buy_ratio)
                sv = v - bv

                # Convert to Pacific time
                try:
                    pac = idx.tz_convert("America/Los_Angeles")
                except Exception:
                    pac = idx
                time_fmt = (
                    pac.strftime("%Y-%m-%d")
                    if interval == "1d"
                    else pac.strftime("%m-%d %H:%M")
                )

                bars.append(
                    {
                        "time": time_fmt,
                        "open": round(o, 2),
                        "high": round(h, 2),
                        "low": round(l, 2),
                        "close": round(c, 2),
                        "volume": v,
                        "buyVolume": bv,
                        "sellVolume": sv,
                    }
                )

            _cache[cache_key] = (time.time(), bars)
            self._json_response(200, bars)

        except Exception as exc:
            self._json_response(500, {"error": str(exc)})

    def _json_response(self, code, payload):
        body = json.dumps(payload).encode()
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        if accepts_gzip and len(body) > 512:
            body = gzip.compress(body)
            self.send_response(code)
            self.send_header("Content-Encoding", "gzip")
        else:
            self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0]):
            super().log_message(fmt, *args)


def find_free_port():
    """Find an available port starting from 8080."""
    for port in range(8080, 8180):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return 8080


if __name__ == "__main__":
    static_dir = resource_dir()
    os.chdir(static_dir)

    port = find_free_port()
    # Bind to 127.0.0.1 only — never expose to the network
    srv = http.server.HTTPServer(("127.0.0.1", port), Handler)

    url = f"http://localhost:{port}"
    print(f"Live Stocks Tracker server -> {url}")
    print("Press Ctrl+C to stop.\n")

    # Auto-open browser after a short delay
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        srv.shutdown()
