"""Kripto ilk 100 için gerçek tarihsel sıralar (Internet Archive / Wayback Machine).

Kaynak: Internet Archive'ın arşivlediği coinmarketcap.com ana sayfası kopyaları. CoinMarketCap'e
doğrudan bağlanılmaz; arşivin resmi arayüzü (availability API + "id_" ham kopya) kullanılır.
Her dönem için o tarihe en yakın tek kopya okunur (günde ~10 istek, aralarda bekleme).

Karşılaştırma tutarlı olsun diye "bugün" de aynı kaynağın en yeni arşiv kopyasından alınır.
Coinler CoinMarketCap'in sabit sayısal kimliğiyle eşleşir (RNDR→RENDER gibi ad değişikliklerinde bozulmaz).

Çıktı (data/ranks.json):
{"updated": ts, "source": "...", "now": {"ts": "YYYYMMDDhhmmss", "coins": {"SYM": [id, rank], ...}},
 "spans": {"d7": {"ts": "...", "ranks": {"id": rank, ...}}, ...}}
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
SPANS = {"d7": 7, "d30": 30, "m3": 91, "m6": 182, "y1": 365, "y2": 730, "y3": 1095, "y5": 1826}
TOL = {"d7": 1, "d30": 3, "m3": 5, "m6": 7, "y1": 10, "y2": 15, "y3": 15, "y5": 20}  # kabul edilen sapma (gün)
REFRESH = 20 * 3600  # günde bir yenile
MAX_BYTES = 8 * 1024 * 1024

NEW_RE = re.compile(r'"id":(\d+),"name":"[^"]*","symbol":"([^"\\]{1,20})","slug":"[^"]*","cmcRank":(\d+)')


def fetch(url, accept="*/*"):
    if not url.startswith("https://"):
        raise ValueError("yalnızca https")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as resp:
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


def cdx_near(want, tol_days):
    """Hızlı arama uzak tarih döndürürse: dizinde pencere içindeki 200 kodlu kopyalardan hedefe en yakını."""
    q = urllib.parse.urlencode({"url": TARGET, "from": ymd(want - tol_days * 86400), "to": ymd(want + tol_days * 86400),
                                "filter": "statuscode:200", "fl": "timestamp", "output": "json", "limit": "200"})
    rows = json.loads(fetch("https://web.archive.org/cdx/search/cdx?" + q, "application/json") or b"[]")
    ts = [r[0] for r in rows[1:] if r and re.fullmatch(r"\d{14}", str(r[0]))]
    return min(ts, key=lambda t: abs(ts_sec(t) - want)) if ts else ""


def parse(html):
    """{cmc_id: (rank, symbol)} — iki biçim: 2021-2024 keysArr dizisi, 2025+ nesne listesi."""
    s = html.decode("utf-8", "replace")
    out = {}
    for m in NEW_RE.finditer(s):
        cid, sym, rank = int(m.group(1)), m.group(2), int(m.group(3))
        if 1 <= rank <= 100:
            out.setdefault(cid, (rank, sym))
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
        for r in rows[1:]:
            try:
                cid, rank, sym = int(r[ii]), int(r[ir]), str(r[isy])[:20]
            except Exception:
                continue
            if 1 <= rank <= 100:
                out.setdefault(cid, (rank, sym))
    return out


def snapshot(ts, cache):
    if ts in cache:
        return cache[ts]
    time.sleep(2)  # arşive nazik ol
    data = parse(fetch("https://web.archive.org/web/%sid_/https://coinmarketcap.com/" % ts, "text/html"))
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
    t_now = closest(ymd(now))
    if not t_now or now - ts_sec(t_now) > 3 * 86400:
        raise SystemExit("güncel arşiv kopyası yok")
    cur = snapshot(t_now, cache)
    res = {"updated": int(now), "source": "Internet Archive · coinmarketcap.com kopyaları",
           "now": {"ts": t_now, "coins": {}}, "spans": {}}
    for cid, (rank, sym) in sorted(cur.items(), key=lambda x: x[1][0]):
        res["now"]["coins"].setdefault(sym.upper(), [cid, rank])
    pspans = prev.get("spans", {})
    for key, days in SPANS.items():
        want = ts_sec(t_now) - days * 86400
        try:
            t = closest(ymd(want))
            if not t or abs(ts_sec(t) - want) > TOL[key] * 86400:
                t = cdx_near(want, TOL[key])
            if not t:
                raise ValueError("yakın tarihli kopya yok")
            p = pspans.get(key)
            if p and p.get("ts") == t:  # aynı kopya: yeniden indirme
                res["spans"][key] = p
                continue
            snap = snapshot(t, cache)
            res["spans"][key] = {"ts": t, "ranks": {str(cid): r for cid, (r, _s) in snap.items()}}
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
