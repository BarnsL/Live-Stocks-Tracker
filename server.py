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


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/bars":
            self._handle_bars(parsed)
        elif parsed.path == "/api/search":
            self._handle_search(parsed)
        else:
            super().do_GET()

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
    print(f"FlowLens server → {url}")
    print("Press Ctrl+C to stop.\n")

    # Auto-open browser after a short delay
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down…")
        srv.shutdown()
