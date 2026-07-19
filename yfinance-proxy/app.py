"""Internal Yahoo Finance quote proxy.

Yahoo gates its quote APIs behind browser TLS fingerprinting, so the Node
collector cannot call them directly (plain undici/curl receive HTTP 429
regardless of a valid cookie + crumb). The yfinance library ships curl_cffi
browser impersonation that passes the gate, so this sidecar wraps it and
re-emits the classic v7 ``quoteResponse`` shape the collector's normaliser
already understands. It listens only on the internal Compose network and
must never be published on a host port.
"""

from __future__ import annotations

import logging
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from json import dumps
from urllib.parse import parse_qs, urlparse

import yfinance as yf

MAX_SYMBOLS = 50
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.\-=^]{1,20}$")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("yfinance-proxy")


def quote_for_symbol(ticker: yf.Ticker, symbol: str) -> dict | None:
    info = ticker.fast_info
    last = info["lastPrice"]
    previous = info["previousClose"]
    if last is None:
        return None
    quote = {
        "symbol": symbol,
        "quoteType": info.get("quoteType") or "UNKNOWN",
        "currency": info.get("currency"),
        "regularMarketPrice": float(last),
        "regularMarketTime": int(time.time()),
    }
    if previous:
        quote["regularMarketChangePercent"] = (float(last) / float(previous) - 1.0) * 100.0
    return quote


def build_payload(symbols: list[str]) -> dict:
    tickers = yf.Tickers(" ".join(symbols))
    results = []
    errors = {}
    for symbol in symbols:
        try:
            quote = quote_for_symbol(tickers.tickers[symbol], symbol)
        except Exception as caught:  # noqa: BLE001 - per-symbol isolation
            errors[symbol] = f"{type(caught).__name__}: {caught}"[:200]
            continue
        if quote is not None:
            results.append(quote)
    payload: dict = {"quoteResponse": {"result": results, "error": None}}
    if errors:
        payload["quoteResponse"]["proxyErrors"] = errors
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "yfinance-proxy"

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.respond(200, {"status": "ok"})
            return
        if parsed.path != "/v7/finance/quote":
            self.respond(404, {"error": "unknown path"})
            return

        raw_symbols = parse_qs(parsed.query).get("symbols", [""])[0]
        symbols = [s.strip().upper() for s in raw_symbols.split(",") if s.strip()]
        if not symbols or len(symbols) > MAX_SYMBOLS:
            self.respond(400, {"error": f"symbols must list 1-{MAX_SYMBOLS} tickers"})
            return
        invalid = [s for s in symbols if not SYMBOL_PATTERN.match(s)]
        if invalid:
            self.respond(400, {"error": f"invalid symbols: {invalid[:5]}"})
            return

        try:
            payload = build_payload(symbols)
        except Exception as caught:  # noqa: BLE001 - keep the proxy alive
            log.exception("quote lookup failed")
            self.respond(502, {"error": f"{type(caught).__name__}: {caught}"[:200]})
            return
        self.respond(200, payload)

    def respond(self, status: int, payload: dict) -> None:
        body = dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        log.info("%s %s", self.address_string(), format % args)


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 8321), Handler)
    log.info("yfinance-proxy listening on :8321 (yfinance %s)", yf.__version__)
    server.serve_forever()


if __name__ == "__main__":
    main()
