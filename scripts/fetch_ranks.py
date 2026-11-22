"""Kripto ilk 100 için gerçek tarihsel sıralar (Internet Archive / Wayback Machine).

Kaynak: Internet Archive'ın arşivlediği coinmarketcap.com ana sayfası kopyaları. CoinMarketCap'e
doğrudan bağlanılmaz; arşivin resmi arayüzü (availability API + "id_" ham kopya) kullanılır.
Her dönem için o tarihe en yakın tek kopya okunur (günde ~10 istek, aralarda bekleme).

Karşılaştırma tutarlı olsun diye "bugün" de aynı kaynağın en yeni arşiv kopyasından alınır.
Coinler CoinMarketCap'in sabit sayısal kimliğiyle eşleşir (RNDR→RENDER gibi ad değişikliklerinde bozulmaz).

Çıktı (data/ranks.json):
{"updated": ts, "source": "...", "now": {"ts": "YYYYMMDDhhmmss", "coins": {"SYM": [id, rank], ...}},
 "spans": {"d7": {"ts": "...", "ranks": {"id": rank, ...}, "prices": {"id": usd, ...}}, ...}}
"now.coins" değerleri [id, rank, usd] biçimindedir; fiyat o kopyadaki CoinMarketCap USD fiyatıdır.
"""
import gzip
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "ranks.json")
PREV_URL = os.environ.get("PREV_RANKS_URL", "")
UA = "finans-paneli/1.0 (kisisel, ticari degil)"
TARGET = "coinmarketcap.com/"
SPANS = {"d7": 7, "d30": 30, "m3": 91, "m6": 182, "y1": 365, "y2": 730, "y3": 1095, "y4": 1461, "y5": 1826}
TOL = {"d7": 1, "d30": 3, "m3": 5, "m6": 7, "y1": 10, "y2": 15, "y3": 15, "y4": 20, "y5": 20}  # kabul edilen sapma (gün)
REFRESH = 20 * 3600  # günde bir yenile
BUDGET = 240  # bu adım en fazla 4 dk sürsün (yayın zinciri beklemesin); kalan dönemler önceki veriyle
T0 = time.time()
MAX_BYTES = 8 * 1024 * 1024

NEW_RE = re.compile(r'"id":(\d+),"name":"[^"]*","symbol":"([^"\\]{1,20})","slug":"[^"]*","cmcRank":(\d+)')
USD_RE = re.compile(r'"name":"USD","price":(-?[0-9.]+(?:[eE][-+]?\d+)?)')


def num(v):
    try:
        f = float(v)
        return float("%.6g" % f) if 0 < f < 1e9 else None
    except Exception:
        return None


def fetch(url, accept="*/*"):
    if not url.startswith("https://"):
        raise ValueError("yalnızca https")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("yanıt çok büyük")
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data


def closest(ts):
    q = urllib.parse.urlencode({"url": TARGET, "timestamp": ts})
    d = json.loads(fetch("https://archive.org/wayback/available?" + q, "application/json"))
    c = (d.get("archived_snapshots") or {}).get("closest") or {}
    t = str(c.get("timestamp") or "")
    return t if c.get("available") and str(c.get("status")) == "200" and re.fullmatch(r"\d{14}", t) else ""


def cdx_list(want, tol_days):
    """Pencere içindeki 200 kodlu kopyalar, hedefe yakınlığa göre sıralı."""
    q = urllib.parse.urlencode({"url": TARGET, "from": ymd(want - tol_days * 86400), "to": ymd(want + tol_days * 86400),
                                "filter": "statuscode:200", "fl": "timestamp", "output": "json", "limit": "300", "collapse": "timestamp:8"})
    rows = json.loads(fetch("https://web.archive.org/cdx/search/cdx?" + q, "application/json") or b"[]")
    ts = [r[0] for r in rows[1:] if r and re.fullmatch(r"\d{14}", str(r[0]))]
    return sorted(ts, key=lambda t: abs(ts_sec(t) - want))


def cdx_near(want, tol_days):
    """Hızlı arama uzak tarih döndürürse: dizinde pencere içindeki 200 kodlu kopyalardan hedefe en yakını."""
    q = urllib.parse.urlencode({"url": TARGET, "from": ymd(want - tol_days * 86400), "to": ymd(want + tol_days * 86400),
                                "filter": "statuscode:200", "fl": "timestamp", "output": "json", "limit": "200"})
    rows = json.loads(fetch("https://web.archive.org/cdx/search/cdx?" + q, "application/json") or b"[]")
    ts = [r[0] for r in rows[1:] if r and re.fullmatch(r"\d{14}", str(r[0]))]
    return min(ts, key=lambda t: abs(ts_sec(t) - want)) if ts else ""


def parse(html):
    """{cmc_id: (rank, symbol, usd)} — iki biçim: 2021-2024 keysArr dizisi, 2025+ nesne listesi."""
    s = html.decode("utf-8", "replace")
    out = {}
    ms = list(NEW_RE.finditer(s))
    for k, m in enumerate(ms):
        cid, sym, rank = int(m.group(1)), m.group(2), int(m.group(3))
        seg = s[m.end():ms[k + 1].start() if k + 1 < len(ms) else m.end() + 20000]
        pm = USD_RE.search(seg)
        if 1 <= rank <= 100:
            out.setdefault(cid, (rank, sym, num(pm.group(1)) if pm else None))
    if len(out) >= 50:
        return out
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', s, re.S)
    if not m:
        return out
    d = json.loads(m.group(1))
    st = (d.get("props") or {}).get("initialState")
    if isinstance(st, str):
        st = json.loads(st)
    rows = (((st or {}).get("cryptocurrency") or {}).get("listingLatest") or {}).get("data") or []
    if rows and isinstance(rows[0], dict) and "keysArr" in rows[0]:
        keys = rows[0]["keysArr"]
        ii, ir, isy = keys.index("id"), keys.index("cmcRank"), keys.index("symbol")
        ip = keys.index("quote.USD.price") if "quote.USD.price" in keys else -1
        for r in rows[1:]:
            try:
                cid, rank, sym = int(r[ii]), int(r[ir]), str(r[isy])[:20]
            except Exception:
                continue
            if 1 <= rank <= 100:
                out.setdefault(cid, (rank, sym, num(r[ip]) if ip >= 0 and ip < len(r) else None))
    return out


def snapshot(ts, cache):
    if ts in cache:
        return cache[ts]
    url = "https://web.archive.org/web/%sid_/https://coinmarketcap.com/" % ts
    for attempt in range(2):  # arşiv GitHub sunucularına karşı bazen yavaş: bir kez daha dene
        time.sleep(2 + attempt * 8)  # arşive nazik ol
        try:
            data = parse(fetch(url, "text/html"))
            break
        except Exception:
            if attempt:
                raise
    if len(data) < 80:  # eksik/bozuk kopya: kullanma
        raise ValueError("kopyada yeterli sıra yok (%d)" % len(data))
    cache[ts] = data
    return data


def ymd(sec):
    return time.strftime("%Y%m%d", time.gmtime(sec))


def ts_sec(ts):
    return int(time.mktime(time.strptime(ts[:8], "%Y%m%d")) - time.timezone)


def main():
    prev = {}
    if PREV_URL.startswith("https://"):
        try:
            prev = json.loads(fetch(PREV_URL, "application/json"))
        except Exception:
            prev = {}
    now = time.time()
    full = len(prev.get("spans", {})) >= len(SPANS)
    age = now - prev.get("updated", 0)
    # tamsa günde bir; eksik dönem varsa saatte bir yeniden dene (arşiv bazen zaman aşımına düşer)
    if prev.get("now") and (age < 3600 or (full and age < REFRESH)):
        json.dump(prev, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("sıralar güncel, önceki kullanıldı")
        return
    cache, errors = {}, []
    cands = []
    try:
        t = closest(ymd(now))
        if t and now - ts_sec(t) <= 3 * 86400:
            cands.append(t)
    except Exception:
        pass
    try:
        cands += [t for t in cdx_list(now - 86400, 3) if t not in cands]
    except Exception:
        pass
    cur, t_now = None, ""
    for t in cands[:4]:
        try:
            cur, t_now = snapshot(t, cache), t
            break
        except Exception:
            continue
    if not cur:
        raise SystemExit("güncel arşiv kopyası yok")
    res = {"updated": int(now), "source": "Internet Archive · coinmarketcap.com kopyaları",
           "now": {"ts": t_now, "coins": {}}, "spans": {}}
    for cid, (rank, sym, usd) in sorted(cur.items(), key=lambda x: x[1][0]):
        res["now"]["coins"].setdefault(sym.upper(), [cid, rank, usd])
    pspans = prev.get("spans", {})
    for key, days in SPANS.items():
        want = ts_sec(t_now) - days * 86400
        if time.time() - T0 > BUDGET:
            errors.append("%s: süre doldu" % key)
            if key in pspans:
                res["spans"][key] = pspans[key]
            continue
        try:
            cands = []
            try:
                t = closest(ymd(want))
                if t and abs(ts_sec(t) - want) <= TOL[key] * 86400:
                    cands.append(t)
            except Exception:
                pass
            if not cands:
                cands = cdx_list(want, TOL[key])[:4]
            if not cands:
                raise ValueError("yakın tarihli kopya yok")
            p = pspans.get(key)
            if p and p.get("ts") in cands[:1] and "prices" in p:  # aynı kopya: yeniden indirme
                res["spans"][key] = p
                continue
            last = None
            for t in cands[:4]:  # bir kopya zaman aşımına düşerse sıradaki yakın kopyayı dene
                if time.time() - T0 > BUDGET:
                    break
                try:
                    snap = snapshot(t, cache)
                    res["spans"][key] = {"ts": t, "ranks": {str(cid): r for cid, (r, _s, _u) in snap.items()},
                                         "prices": {str(cid): u for cid, (_r, _s, u) in snap.items() if u}}
                    break
                except Exception as e:
                    last = e
            else:
                raise last or ValueError("kopya okunamadı")
        except Exception as e:
            errors.append("%s: %s" % (key, e))
            if key in pspans:
                res["spans"][key] = pspans[key]
    if errors:
        res["errors"] = errors
    json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("sıralar:", ", ".join("%s=%s" % (k, v["ts"][:8]) for k, v in res["spans"].items()), "|", errors)


if __name__ == "__main__":
    main()
