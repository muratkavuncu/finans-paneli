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
# Günlük grafikte teknik göstergeler için 1 yıllık günlük mumlar ayrı dosyada tutulur ve 6 saatte bir yenilenir
DAILY_OUT = os.path.join(os.path.dirname(OUT) or ".", "daily.json")
DAILY_MAX_AGE = 6 * 3600

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
    ("AVGO", "AVGO", "Broadcom", "hisse"),
    ("ORCL", "ORCL", "Oracle", "hisse"),
    ("NFLX", "NFLX", "Netflix", "hisse"),
    ("PLTR", "PLTR", "Palantir", "hisse"),
    ("MU", "MU", "Micron", "hisse"),
    ("COIN", "COIN", "Coinbase", "hisse"),
    ("MSTR", "MSTR", "Strategy", "hisse"),
    ("BRK.B", "BRK-B", "Berkshire Hathaway", "hisse"),
    ("JPM", "JPM", "JPMorgan", "hisse"),
    ("LLY", "LLY", "Eli Lilly", "hisse"),
    ("SPY", "SPY", "SPDR S&P 500 ETF", "fon"),
    ("QQQ", "QQQ", "Invesco QQQ ETF", "fon"),
    ("NDX", "^NDX", "Nasdaq 100", "endeks"),
    ("SOX", "^SOX", "Yarı iletken endeksi", "endeks"),
    ("SPX", "^GSPC", "S&P 500", "endeks"),
    ("VIX", "^VIX", "VIX", "endeks"),
    ("DXY", "DX-Y.NYB", "Dolar endeksi", "endeks"),
    ("US10Y", "^TNX", "ABD 10 yıllık faiz", "endeks"),
    ("GOLD", "GC=F", "Altın (ons)", "emtia"),
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


def read_daily(entry):
    key, symbol = entry[0], entry[1]
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol)
           + "?range=1y&interval=1d")
    result = json.loads(fetch(url).decode("utf-8"))["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(result.get("timestamp") or []):
        o, h, l, c = quote["open"][i], quote["high"][i], quote["low"][i], quote["close"][i]
        if None in (o, h, l, c):
            continue
        bars.append([ts, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(quote["volume"][i] or 0)])
    if len(bars) < 30:
        raise ValueError("günlük veri yetersiz")
    return key, bars[-260:]


def update_daily():
    """Günlük geçmişi tazeyse olduğu gibi taşır, eskiyse yeniden çeker; çekilemeyen sembolde eskisi kalır."""
    try:
        if PREV_URL:
            prev = json.loads(fetch(PREV_URL.replace("markets.json", "daily.json") + "?t=" + str(int(time.time()))).decode("utf-8"))
        else:
            with open(DAILY_OUT, encoding="utf-8") as fh:
                prev = json.load(fh)
    except Exception:
        prev = {}
    # altın 30/90 günlük getirisi, NDX ve SPX günlük grafik için
    stocks = [e for e in SYMBOLS if e[3] in ("hisse", "emtia") or e[0] in ("NDX", "SPX")]
    old = prev.get("symbols", {})
    out = prev
    if time.time() - prev.get("updated", 0) > DAILY_MAX_AGE or any(e[0] not in old for e in stocks):
        symbols, errors = {}, []
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [(e, pool.submit(read_daily, e)) for e in stocks]
            for e, fut in futures:
                try:
                    key, bars = fut.result()
                    symbols[key] = bars
                except Exception as exc:
                    errors.append(e[0])
                    print("HATA günlük", e[0], repr(exc)[:160], file=sys.stderr)
                    if e[0] in old:
                        symbols[e[0]] = old[e[0]]
        # Hiçbiri çekilemediyse zaman damgası eski kalsın ki bir sonraki turda yeniden denensin
        stamp = int(time.time()) if len(errors) < len(stocks) else prev.get("updated", 0)
        out = {"updated": stamp, "symbols": symbols}
        print("günlük geçmiş yenilendi:", len(symbols), "hata:", errors)
    with open(DAILY_OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))


# Zincir üstünde 7/24 işlem gören tokenize borsa fonları ve hisseler (CoinGecko kategorileri)
TOKEN_CATS = [("fon", "tokenized-exchange-traded-funds-etfs"), ("hisse", "tokenized-stock")]
TOKEN_MIN_VOL = 50000      # 24 saatlik hacmi bunun altında kalanlar gösterilmez (fiyatı güvenilmez)
TOKEN_PER_CAT = 12
# (adda geçen, görünen ad, sembol eki, sembol öneki): xStocks spyx, Ondo spyon, bStocks spyb, Reality rqqq
ISSUERS = [("xstock", "xStocks", "x", ""), ("ondo", "Ondo", "on", ""), ("bstock", "bStocks", "b", ""),
           ("robinhood", "Robinhood", "", ""), ("reality", "Reality", "", "r"), ("backed", "Backed", "", "b")]


def split_symbol(sym, name):
    """Token sembolünü dayanak varlık ve ihraççıya ayırır: spyx -> (SPY, xStocks, x)."""
    s, low = sym.lower(), name.lower()
    for key, issuer, suf, pre in ISSUERS:
        if key in low:
            if suf and s.endswith(suf) and len(s) > len(suf):
                s = s[:-len(suf)]
            if pre and s.startswith(pre) and len(s) > len(pre):
                s = s[len(pre):]
            return s.upper(), issuer, suf
    return s.upper(), "", ""


def fetch_tokens(known):
    """Her dayanak varlık için en çok işlem gören tokeni alır; kaç ihraççıda bulunduğunu da yazar."""
    out = []
    for kind, cat in TOKEN_CATS:
        url = ("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=80"
               "&category=" + cat)
        groups = {}
        for r in json.loads(fetch(url).decode("utf-8")):
            if not r.get("current_price") or (r.get("total_volume") or 0) < TOKEN_MIN_VOL:
                continue
            base, issuer, suf = split_symbol(r.get("symbol") or "", r.get("name") or "")
            g = groups.setdefault(base, {"mcap": 0, "issuers": set(), "best": None})
            g["mcap"] += r.get("market_cap") or 0
            if issuer:
                g["issuers"].add(issuer)
            if not g["best"] or (r.get("total_volume") or 0) > g["best"][0]["total_volume"]:
                g["best"] = (r, issuer, suf)
        ranked = sorted(groups.items(), key=lambda kv: -kv[1]["mcap"])[:TOKEN_PER_CAT]
        for base, g in ranked:
            r, issuer, suf = g["best"]
            pct = r.get("price_change_percentage_24h")
            out.append({
                "kind": kind,
                "sym": base + suf,
                "name": (r.get("name") or "").split(" (")[0].split(" •")[0].replace(" xStock", "").replace(" Tokenized Stock", ""),
                "issuer": issuer,
                "issuers": len(g["issuers"]),
                "base": base if base in known else None,
                "u": base,
                "price": r["current_price"],
                "pct": round(pct, 2) if pct is not None else None,
                "mcap": round(g["mcap"]),
                "vol": round(r.get("total_volume") or 0),
            })
        time.sleep(2)  # CoinGecko ücretsiz sınırı
    if not out:
        raise ValueError("tokenize veri boş")
    # Listede olmayan dayanakların borsa fiyatı: Yahoo'daki şirket adı token adıyla eşleşmezse alınmaz
    # (halka açık olmayan şirketlerde aynı kısaltmalı başka bir şirketle karışmasın)
    missing = [t for t in out if not t["base"]]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for t, ref in zip(missing, pool.map(lambda t: ref_price(t["u"], t["name"]), missing)):
            if ref:
                t["ref"] = ref
    return out


def ref_price(ticker, name):
    try:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(ticker) + "?range=1d&interval=1d"
        meta = json.loads(fetch(url, 10).decode("utf-8"))["chart"]["result"][0]["meta"]
    except Exception:
        return None
    first = name.lower().replace(",", " ").split()[0]
    long = " ".join(str(meta.get(k) or "") for k in ("longName", "shortName")).lower()
    price = meta.get("regularMarketPrice")
    return round(price, 4) if price and first and first in long else None


def load_previous():
    try:
        if PREV_URL:
            return json.loads(fetch(PREV_URL + "?t=" + str(int(time.time()))).decode("utf-8"))
        with open(OUT, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def main():
    prev_all = load_previous()
    prev = prev_all.get("symbols", {})
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
    try:
        out["tokens"] = fetch_tokens(set(symbols) | {e[0] for e in SYMBOLS})
        out["tokens_at"] = out["updated"]
    except Exception as exc:  # çekilemezse önceki liste kendi saatiyle kalır
        print("HATA tokenize", repr(exc)[:160], file=sys.stderr)
        if prev_all.get("tokens"):
            out["tokens"], out["tokens_at"] = prev_all["tokens"], prev_all.get("tokens_at", 0)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("sembol:", len(symbols), "hata:", errors)
    try:
        update_daily()
    except Exception as exc:
        print("HATA günlük geçmiş", repr(exc)[:160], file=sys.stderr)
    if not symbols:
        sys.exit(1)


if __name__ == "__main__":
    main()
