"""Hisse ve endeks verisi toplayıcı.

Yahoo Finance grafik uç noktasından 1 aylık, 30 dakikalık mumları çeker ve
data/markets.json dosyasına yazar. Veri yaklaşık 15 dakika gecikmelidir.
Yalnızca standart kütüphaneyi kullanır.

Kullanım: python scripts/fetch_markets.py [çıktı_yolu]
Ortam değişkeni PREV_MARKETS_URL verilirse çekilemeyen semboller önceki çıktıdan korunur.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "markets.json")
PREV_URL = os.environ.get("PREV_MARKETS_URL", "")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
MAX_BARS = 300

# (anahtar, Yahoo sembolü, görünen ad, tür)
SYMBOLS = [
    ("NVDA", "NVDA", "Nvidia", "hisse"),
    ("MSFT", "MSFT", "Microsoft", "hisse"),
    ("AAPL", "AAPL", "Apple", "hisse"),
    ("TSLA", "TSLA", "Tesla", "hisse"),
    ("GOOGL", "GOOGL", "Alphabet", "hisse"),
    ("AMZN", "AMZN", "Amazon", "hisse"),
    ("META", "META", "Meta", "hisse"),
    ("AMD", "AMD", "AMD", "hisse"),
    ("TSM", "TSM", "TSMC", "hisse"),
    ("NDX", "^NDX", "Nasdaq 100", "endeks"),
    ("SOX", "^SOX", "Yarı iletken endeksi", "endeks"),
    ("SPX", "^GSPC", "S&P 500", "endeks"),
    ("VIX", "^VIX", "VIX", "endeks"),
    ("DXY", "DX-Y.NYB", "Dolar endeksi", "endeks"),
    ("US10Y", "^TNX", "ABD 10 yıllık faiz", "endeks"),
]


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise ValueError("yanıt çok büyük")
    return data


def read_symbol(entry):
    key, symbol, name, kind = entry
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol)
           + "?range=1mo&interval=30m")
    result = json.loads(fetch(url).decode("utf-8"))["chart"]["result"][0]
    meta = result["meta"]
    quote = result["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(result.get("timestamp") or []):
        o, h, l, c = quote["open"][i], quote["high"][i], quote["low"][i], quote["close"][i]
        if None in (o, h, l, c):
            continue
        v = quote["volume"][i] or 0
        bars.append([ts, round(o, 4), round(h, 4), round(l, 4), round(c, 4), int(v)])
    if not bars:
        raise ValueError("mum verisi yok")
    price = meta.get("regularMarketPrice") or bars[-1][4]
    prev = meta.get("previousClose") or meta.get("chartPreviousClose")
    period = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    now = time.time()
    return key, {
        "name": name,
        "kind": kind,
        "price": round(price, 4),
        "prev": round(prev, 4) if prev else None,
        "pct": round((price / prev - 1) * 100, 2) if prev else None,
        "time": int(meta.get("regularMarketTime") or bars[-1][0]),
        "open": bool(period.get("start", 0) <= now < period.get("end", 0)),
        "bars": bars[-MAX_BARS:],
    }


def load_previous():
    try:
        if PREV_URL:
            return json.loads(fetch(PREV_URL + "?t=" + str(int(time.time()))).decode("utf-8"))
        with open(OUT, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def main():
    prev = load_previous().get("symbols", {})
    symbols = {}
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [(entry, pool.submit(read_symbol, entry)) for entry in SYMBOLS]
        for entry, fut in futures:
            try:
                key, data = fut.result()
                symbols[key] = data
            except Exception as exc:
                errors.append(entry[0])
                print("HATA", entry[0], repr(exc)[:160], file=sys.stderr)
                if entry[0] in prev:
                    symbols[entry[0]] = prev[entry[0]]  # eski veri kendi saatiyle kalır

    out = {"updated": int(time.time()), "symbols": symbols, "errors": errors}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("sembol:", len(symbols), "hata:", errors)
    if not symbols:
        sys.exit(1)


if __name__ == "__main__":
    main()
