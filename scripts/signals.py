"""RENDER sinyal pilotu.

Basit, açık kurallarla "içeride / dışarıda" durumu üretir ve durum değiştiğinde sinyal verir.
Durum tutulmaz: her çalıştırmada kapanmış mumlardan baştan hesaplanır, bu yüzden sonuç tekrarlanabilir.
Karar mum kapanışında verilir; işlem fiyatı olarak bir sonraki mumun açılışı alınır ve her alım-satımda
maliyet düşülür. Kağıt üstünde denemedir; emir vermez, tavsiye değildir.

Kullanım: python scripts/signals.py [çıktı_yolu]   (tek başına çalıştırılırsa yalnızca dosyayı yazar)
"""
import calendar
import json
import os
import sys
import time
import urllib.request

PAIR = "RENDERUSDT"
INTERVAL = "4h"
COST = 0.0025            # işlem başına %0,25 (BtcTurk komisyonu + alış-satış farkı için kaba pay)
WARM = 200               # göstergelerin oturması için atlanan ilk mumlar
PILOT_START = calendar.timegm((2026, 11, 15, 0, 0, 0))
PILOT_RULE = "ema"       # bildirimi gönderilen kural; diğerleri yalnızca panelde izlenir
API = "https://data-api.binance.vision/api/v3/klines?symbol=%s&interval=%s&limit=1000%s"


def fetch(pair, interval, pages=2):
    rows, end = [], ""
    for _ in range(pages):
        req = urllib.request.Request(API % (pair, interval, end), headers={"User-Agent": "finans-paneli"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            part = json.loads(resp.read(5 * 1024 * 1024).decode("utf-8"))
        if not part:
            break
        rows = part + rows
        if len(part) < 1000:
            break
        end = "&endTime=%d" % (part[0][0] - 1)
    now_ms = time.time() * 1000
    return [r for r in rows if r[6] < now_ms]  # yalnızca kapanmış mumlar


def ema(vals, n):
    out = [None] * len(vals)
    if len(vals) < n:
        return out
    e = sum(vals[:n]) / n
    out[n - 1] = e
    k = 2.0 / (n + 1)
    for i in range(n, len(vals)):
        e = vals[i] * k + e * (1 - k)
        out[i] = e
    return out


def rsi(vals, n=14):
    out = [None] * len(vals)
    if len(vals) <= n:
        return out
    g = sum(max(vals[i] - vals[i - 1], 0) for i in range(1, n + 1)) / n
    l = sum(max(vals[i - 1] - vals[i], 0) for i in range(1, n + 1)) / n
    out[n] = 100 if l == 0 else 100 - 100 / (1 + g / l)
    for i in range(n + 1, len(vals)):
        d = vals[i] - vals[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
        out[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
    return out


def indicators(rows):
    o = [float(r[1]) for r in rows]
    h = [float(r[2]) for r in rows]
    l = [float(r[3]) for r in rows]
    c = [float(r[4]) for r in rows]
    n = len(c)
    e12, e26 = ema(c, 12), ema(c, 26)
    macd = [None if e26[i] is None else e12[i] - e26[i] for i in range(n)]
    first = next((i for i, v in enumerate(macd) if v is not None), n)
    sig = [None] * first + ema(macd[first:], 9)
    hist = [None if sig[i] is None else macd[i] - sig[i] for i in range(n)]
    return {"t": [int(r[0] / 1000) for r in rows], "tc": [int(r[6] / 1000) for r in rows], "o": o, "h": h, "l": l, "c": c, "n": n,
            "e20": ema(c, 20), "e50": ema(c, 50), "e200": ema(c, 200), "rsi": rsi(c), "hist": hist}


# (kimlik, ad, açıklama, kural). Kural: (veri, mum, şu an içeride mi) -> içeride olmalı mı
RULES = [
    ("ema", "EMA 20 / 50 kesişimi", "Kısa ortalama uzunun üstüne çıkınca al, altına inince sat.",
     lambda d, i, p: d["e20"][i] > d["e50"][i]),
    ("trend", "EMA 200 trend filtresi", "Kapanış EMA 200'ün üstüne çıkınca al, altına inince sat.",
     lambda d, i, p: d["c"][i] > d["e200"][i]),
    ("macd", "MACD kesişimi", "MACD pozitife dönünce al, negatife dönünce sat.",
     lambda d, i, p: d["hist"][i] > 0),
    ("rsi", "RSI dipten dönüş", "RSI 30'un altından yukarı dönünce al, 65'i geçince sat.",
     lambda d, i, p: (d["rsi"][i] < 65) if p else (d["rsi"][i - 1] < 30 <= d["rsi"][i])),
    ("brk", "20 mumluk kırılım", "Son 20 mumun zirvesi aşılınca al, son 10 mumun dibi kırılınca sat.",
     lambda d, i, p: (d["c"][i] >= min(d["l"][i - 10:i])) if p else (d["c"][i] > max(d["h"][i - 20:i]))),
]


def drawdown(curve):
    peak, worst = curve[0], 0.0
    for v in curve:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1)
    return worst * 100


def simulate(d, step, start=WARM, cost=COST):
    """Geçmişi baştan oynatır. Son mumdaki karar henüz uygulanmamış "bekleyen sinyal" olarak ayrıca döner."""
    cash, units, pos, entry, entry_t = 1.0, 0.0, False, 0.0, 0
    trades, curve = [], []
    for i in range(start, d["n"]):
        want = step(d, i - 1, pos)
        if want and not pos:
            entry, entry_t = d["o"][i] * (1 + cost), d["t"][i]
            units, pos = cash / entry, True
        elif not want and pos:
            out = d["o"][i] * (1 - cost)
            cash = units * out
            trades.append({"in_t": entry_t, "in_p": d["o"][i] if False else round(entry / (1 + cost), 6), "out_t": d["t"][i],
                           "out_p": round(d["o"][i], 6), "ret": round((out / entry - 1) * 100, 2)})
            pos = False
        curve.append(units * d["c"][i] if pos else cash)
    last = d["n"] - 1
    want = step(d, last, pos)  # son kapanan mumun kararı: bir sonraki açılışta (şimdi) uygulanır
    signal = None
    if want != pos:
        signal = {"side": "AL" if want else "SAT", "t": d["tc"][last], "price": round(d["c"][last], 6)}
    open_pos = None
    if pos:
        open_pos = {"in_t": entry_t, "in_p": round(entry / (1 + cost), 6), "ret": round((d["c"][last] * (1 - cost) / entry - 1) * 100, 2)}
    return {"trades": trades, "curve": curve, "open": open_pos, "signal": signal, "in": pos}


def summarize(trades, curve=None):
    wins = sum(1 for t in trades if t["ret"] > 0)
    total = 1.0
    for t in trades:
        total *= 1 + t["ret"] / 100
    out = {"trades": len(trades), "wins": wins, "ret": round((total - 1) * 100, 2)}
    if curve:
        out["ret"] = round((curve[-1] - 1) * 100, 2)
        out["dd"] = round(drawdown(curve), 2)
    return out


def build(out_path=None):
    d = indicators(fetch(PAIR, INTERVAL))
    if d["n"] < WARM + 50:
        raise ValueError("yeterli mum yok")
    hold = [d["c"][i] / (d["o"][WARM] * (1 + COST)) for i in range(WARM, d["n"])]
    rules = []
    for rid, name, desc, step in RULES:
        sim = simulate(d, step)
        pilot_trades = [t for t in sim["trades"] if t["in_t"] >= PILOT_START]
        rules.append({
            "id": rid, "name": name, "desc": desc, "in": sim["in"], "open": sim["open"], "signal": sim["signal"],
            "hist": summarize(sim["trades"], sim["curve"]), "pilot": summarize(pilot_trades),
            "pilot_open": bool(sim["open"] and sim["open"]["in_t"] >= PILOT_START),
            "recent": sim["trades"][-5:],
        })
    out = {"updated": int(time.time()), "pair": "RENDER/USDT", "interval": INTERVAL, "cost": COST, "pilot_start": PILOT_START,
           "pilot_rule": PILOT_RULE, "price": d["c"][-1], "candle": d["tc"][-1], "from": d["t"][WARM], "bars": d["n"] - WARM,
           "hold": {"ret": round((hold[-1] - 1) * 100, 2), "dd": round(drawdown(hold), 2)}, "rules": rules}
    if out_path:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    return out


if __name__ == "__main__":
    res = build(sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "signals.json"))
    print("sinyal pilotu:", {r["id"]: ("içeride" if r["in"] else "dışarıda") for r in res["rules"]})
