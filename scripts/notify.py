"""Telefona bildirim (ntfy): hızlı tepki gerektiren gelişmeler.

Dört tür bildirim gönderir:
  1) Haber    - erken uyarı (tek büyük küresel kaynak + fiyat tepki veriyor), resmi açıklama,
                teyitli (en az iki ayrı yayın kuruluşu) yüksek etkili olay
  2) Fiyat    - BTC / RENDER'da 5 ya da 15 dakikada sert hareket; saatlik grafikte destek/direnç kırılımı
                ve EMA 200 geçişi
  3) Takvim   - kritik veriden önce hatırlatma
  4) Tepki    - kritik veri açıklandıktan birkaç dakika sonra piyasanın ilk tepkisi
  5) Özet     - günde bir kez sabah özeti

Kanal adı NTFY_TOPIC ortam değişkeninden okunur ve hiçbir yere yazılmaz; yoksa hiçbir şey gönderilmez.
NTFY_DRY=1 ise göndermek yerine ne göndereceğini yazar.
"""
import json
import os
import time
import urllib.request
from urllib.parse import urlparse

TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
DRY = os.environ.get("NTFY_DRY") == "1"
PANEL = "https://muratkavuncu.github.io/finans-paneli/"

# --- Haber
NEWS_MIN_SCORE = 60          # teyitli olay bildirimi için en düşük etki puanı
NEWS_MAX_AGE = 3 * 3600      # bundan eski olay için bildirim gitmez
EARLY_MAX_AGE = 45 * 60      # erken uyarı yalnızca taze haber için
NEWS_PER_RUN = 3
TYPE_COOLDOWN = 3 * 3600     # aynı tür + aynı varlık için tekrar bildirim aralığı
# Erken uyarı verilebilen olay türleri (yönü ve etkisi en net olanlar)
EARLY_TYPES = {"fed_cut", "fed_hike", "infl_hot", "infl_cool", "hack", "collapse", "etf_yes", "etf_no",
               "chip_export", "tariff", "geo", "reg_bad", "reg_good"}
# Tek kaynaklı haberde erken uyarı için fiyatın da tepki vermiş olması gerekir (yüzde)
EARLY_MOVE = {"BTC": 0.5, "Nasdaq": 0.5}
EARLY_MOVE_OTHER = 1.5

# --- Fiyat: varlık -> (15 dakikada yüzde, 5 dakikada yüzde)
PRICE_RULES = {"BTC": (1.0, 0.75), "RENDER": (3.0, 2.0)}
PRICE_COOLDOWN = 3600        # aynı varlık için en erken bir saat sonra tekrar

# --- Takvim
CALENDAR_AHEAD = 25 * 60     # veriden en fazla bu kadar önce hatırlat
REACT_FROM, REACT_TO = 4 * 60, 25 * 60   # açıklamadan şu kadar sonra ilk tepkiyi bildir

# "Haberi aç" düğmesi yalnızca bilinen kaynakların adreslerine konur
NEWS_HOSTS = ("bloomberg.com", "wsj.com", "ft.com", "cnbc.com", "nytimes.com", "bbc.com", "bbc.co.uk", "theguardian.com",
              "federalreserve.gov", "investing.com", "coindesk.com", "theblock.co", "cointelegraph.com", "decrypt.co",
              "bitcoinmagazine.com", "techcrunch.com", "theverge.com", "arstechnica.com", "bloomberght.com", "aa.com.tr")


def trusted(url):
    try:
        parts = urlparse(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host == h or host.endswith("." + h) for h in NEWS_HOSTS)


def send(title, message, priority=3, tags=None, news_url=None):
    actions = [{"action": "view", "label": "Paneli aç", "url": PANEL}]
    if news_url and trusted(news_url):
        actions.insert(0, {"action": "view", "label": "Haberi aç", "url": news_url})
    body = {"topic": TOPIC, "title": title[:120], "message": message[:900], "priority": priority,
            "tags": tags or [], "click": PANEL, "actions": actions}
    if DRY:
        body["topic"] = "(gizli)"
        print("BİLDİRİM", json.dumps(body, ensure_ascii=False))
        return True
    if not TOPIC:
        return False
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception as exc:  # kanal adı hata metnine karışmasın diye ayrıntı yazılmaz
        print("bildirim gönderilemedi:", type(exc).__name__)
        return False


def pct(v):
    return ("+" if v > 0 else "") + ("%.2f" % v).replace(".", ",") + "%"


def money(v):
    if v >= 1000:
        return "$" + ("%.0f" % v)
    return "$" + ("%.2f" % v if v >= 100 else "%.4f" % v).replace(".", ",")


def live(prices, sym, now):
    """Güncel 5 dakikalık seri; veri bayatsa boş döner."""
    data = prices.series(sym)
    return data if len(data) >= 4 and now - data[-1][0] <= 900 else []


def now_line(prices, now):
    parts = []
    for sym in PRICE_RULES:
        data = live(prices, sym, now)
        if data:
            parts.append("%s %s (15 dk %s)" % (sym, money(data[-1][1]), pct((data[-1][1] / data[-4][1] - 1) * 100)))
    return "Şimdi: " + " · ".join(parts) if parts else ""


def since(data, ts):
    """ts anından bugüne yüzde değişim; ts'den önceki son kapanış taban alınır."""
    base = None
    for t, close in data:
        if t >= ts:
            break
        base = close
    return None if base is None else (data[-1][1] / base - 1) * 100


def early_ok(e):
    """Henüz teyit puanı düşük olsa da haber vermeye değer mi: büyük kaynak + net olay türü + fiyat tepkisi."""
    if e["type"] not in EARLY_TYPES or e.get("tier") != "A" or e.get("foreign") or e.get("lang") != "en":
        return False
    return any(abs(r["pct"]) >= EARLY_MOVE.get(r["k"], EARLY_MOVE_OTHER) for r in e["react"])


def news_body(e, prices, now, confirmed):
    lines = [e["title"]]
    if e["up"]:
        lines.append("▲ " + ", ".join(e["up"]))
    if e["down"]:
        lines.append("▼ " + ", ".join(e["down"]))
    if not e["up"] and not e["down"]:
        lines.append(e["why"])
    if e["react"]:
        lines.append("Haberden beri: " + "  ".join(r["k"] + " " + pct(r["pct"]) for r in e["react"]))
    line = now_line(prices, now)
    if line:
        lines.append(line)
    mins = max(0, round((now - e["ts"]) / 60))
    if confirmed or e["n"] > 1:
        lines.append("%d kaynak: %s · %d dk önce" % (e["n"], ", ".join(e["sources"][:4]), mins))
    else:
        lines.append("Tek kaynak: %s · %d dk önce · teyit bekleniyor" % (e["source"], mins))
    return "\n".join(lines)


def price_alerts(events, prices, sent, now):
    """Sert fiyat hareketi (son 5 ve 15 dakika). sent sözlüğünü günceller, gönderilen sayısını döndürür.

    Hem her turda hem de turlar arasındaki sık fiyat izleyicisinde (watch_prices.py) kullanılır.
    """
    count = 0
    for sym, (lim15, lim5) in PRICE_RULES.items():
        data = live(prices, sym, now)
        if not data or now - sent.get("p:" + sym, 0) < PRICE_COOLDOWN:
            continue
        move15 = (data[-1][1] / data[-4][1] - 1) * 100
        move5 = (data[-1][1] / data[-2][1] - 1) * 100
        if abs(move15) >= lim15:
            move, span, ratio = move15, "15 dakikada", abs(move15) / lim15
        elif abs(move5) >= lim5:
            move, span, ratio = move5, "5 dakikada", abs(move5) / lim5
        else:
            continue
        lines = ["Fiyat: " + money(data[-1][1])]
        cause = [e for e in events if now - e["ts"] <= 3600 and not e.get("preview") and e["score"] >= 40
                 and (e["cat"] == "makro" or sym in e["assets"] or (e["cat"] == "kripto" and not e["assets"]))]
        if cause:
            lines.append("Son 1 saatin öne çıkan haberi (neden olduğu kesin değil): %s (%s)" % (cause[0]["title"], cause[0]["source"]))
        else:
            lines.append("Eşleşen haber henüz yok; panelden kontrol et.")
        tag = "chart_with_upwards_trend" if move > 0 else "chart_with_downwards_trend"
        if send("%s %s %s" % (sym, span, pct(move)), "\n".join(lines), priority=5 if ratio >= 2 else 4, tags=[tag],
                news_url=cause[0]["url"] if cause else None):
            sent["p:" + sym] = int(now)
            count += 1
    return count


# --- Teknik seviye (saatlik grafik)
LEVEL_TOUCHES = 3           # seviye sayılması için en az kaç kez dönülmüş olmalı
TECH_MARGIN = 0.75           # kırılım sayılması için seviyenin ötesine geçilmesi gereken pay (ATR'nin katı)
TECH_COOLDOWN = 4 * 3600     # aynı varlık + aynı yön için tekrar aralığı
LEVEL_COOLDOWN = 24 * 3600   # aynı seviye için tekrar aralığı
EMA_COOLDOWN = 12 * 3600     # EMA 200 geçişi için tekrar aralığı


def _ema(vals, n):
    if len(vals) < n:
        return None
    e = sum(vals[:n]) / n
    k = 2.0 / (n + 1)
    for v in vals[n:]:
        e = v * k + e * (1 - k)
    return e


def _atr(bars, n=14):
    tr = [max(b[2] - b[3], abs(b[2] - a[4]), abs(b[3] - a[4])) for a, b in zip(bars[-n - 1:-1], bars[-n:])]
    return sum(tr) / len(tr) if tr else 0


def _levels(bars, atr, w=4):
    """Fiyatın en az LEVEL_TOUCHES kez döndüğü seviyeler: [(fiyat, dönüş sayısı)], küçükten büyüğe."""
    pivots = []
    for i in range(max(w, len(bars) - 300), len(bars) - w):
        win = bars[i - w:i + w + 1]
        if bars[i][2] >= max(b[2] for b in win):
            pivots.append(bars[i][2])
        if bars[i][3] <= min(b[3] for b in win):
            pivots.append(bars[i][3])
    pivots.sort()
    out = []
    for p in pivots:
        if out and p - out[-1][0] <= atr * 0.6:
            price, n = out[-1]
            out[-1] = ((price * n + p) / (n + 1), n + 1)
        else:
            out.append((p, 1))
    return [x for x in out if x[1] >= LEVEL_TOUCHES]


def _breakouts(closed, price):
    """Kapanmış mumlara göre şu anki fiyatın kırdığı seviyeler: [(yön, seviye, sıradaki seviye)]."""
    atr = _atr(closed)
    if atr <= 0:
        return []
    margin = atr * TECH_MARGIN
    recent = [b[4] for b in closed[-6:]]
    levels = _levels(closed, atr)
    out = []
    up = [x for x in levels if max(recent) < x[0] and price > x[0] + margin]
    if up:
        nxt = [x for x in levels if x[0] > price]
        out.append(("u", up[-1], nxt[0] if nxt else None))
    down = [x for x in levels if min(recent) > x[0] and price < x[0] - margin]
    if down:
        nxt = [x for x in levels if x[0] < price]
        out.append(("d", down[0], nxt[-1] if nxt else None))
    return out


def scorecard(bars, way, horizon=12):
    """Aynı kuralın geçmiş karnesi: (aynı yönde kalan, toplam). Kırılımdan `horizon` mum sonraki kapanışa bakılır."""
    wins = total = 0
    last_dir, last_level = -99, {}
    for cut in range(260, len(bars) - horizon):
        price = bars[cut][4]
        for w, level, _ in _breakouts(bars[:cut], price):
            code = "%.5g" % level[0]
            if w != way or cut - last_dir < 4 or cut - last_level.get(code, -99) < 24:
                continue
            last_dir, last_level[code] = cut, cut
            later = bars[cut + horizon][4]
            total += 1
            wins += (later > price) if way == "u" else (later < price)
    return wins, total


def tech_alerts(prices, sent, now):
    """Saatlik grafikte destek/direnç kırılımı ve EMA 200 geçişi. sent sözlüğünü günceller."""
    fetch = getattr(prices, "candles", None)
    if not fetch:
        return 0
    count = 0
    for sym in PRICE_RULES:
        bars = fetch(sym, "1h")
        if len(bars) < 250 or now - bars[-1][0] > 2 * 3600:
            continue
        closed, price = bars[:-1], bars[-1][4]
        fired = False
        for way, level, ahead in _breakouts(closed, price):
            code = "".join(ch if ch.isdigit() else "p" for ch in "%.6g" % level[0])[:12]
            dkey, lkey = "t:%s:%s" % (sym, way), "l:%s:%s" % (sym, code)
            if now - sent.get(dkey, 0) < TECH_COOLDOWN or now - sent.get(lkey, 0) < LEVEL_COOLDOWN:
                continue
            up = way == "u"
            lines = ["Fiyat: %s · seviye saatlik grafikte %d kez dönüş noktasıydı" % (money(price), level[1]),
                     ("Sıradaki %s: %s" % ("direnç" if up else "destek", money(ahead[0]))) if ahead
                     else ("Yakın geçmişte %s başka seviye görünmüyor" % ("üstte" if up else "altta"))]
            wins, total = scorecard(closed, way)
            if total >= 3:
                lines.append("Karne: son %d günde benzer %d kırılımın %d tanesi 12 saat sonra aynı yöndeydi."
                             % (round((len(closed) - 260) / 24), total, wins))
            lines.append("Kırılım geri dönebilir; saatlik kapanış seviyenin %s kalırsa güçlenir." % ("üstünde" if up else "altında"))
            if send("%s %s · %s" % (sym, "direnci aştı" if up else "desteği kırdı", money(level[0])), "\n".join(lines), priority=4,
                    tags=["chart_with_upwards_trend" if up else "chart_with_downwards_trend"]):
                sent[dkey] = sent[lkey] = int(now)
                count += 1
                fired = True
        if fired:
            continue
        atr = _atr(closed)
        ema = _ema([b[4] for b in closed], 200)
        last12 = [b[4] for b in closed[-12:]]  # yarım gün boyunca öbür tarafta kalmış olmalı
        if ema and atr > 0:
            margin = atr * TECH_MARGIN
            way = "u" if max(last12) < ema and price > ema + margin else "d" if min(last12) > ema and price < ema - margin else ""
            mkey = "m:%s:%s" % (sym, way)
            if way and now - sent.get(mkey, 0) >= EMA_COOLDOWN:
                lines = ["Fiyat: %s · EMA 200: %s" % (money(price), money(ema)),
                         "Uzun ortalamanın %s. Tek başına işaret değildir; panelden teknik görünüme bak."
                         % ("üstü genelde yükseliş eğilimi sayılır" if way == "u" else "altı genelde düşüş eğilimi sayılır")]
                if send("%s saatlik EMA 200'ün %s" % (sym, "üstüne çıktı" if way == "u" else "altına indi"), "\n".join(lines),
                        priority=3, tags=["chart_with_upwards_trend" if way == "u" else "chart_with_downwards_trend"]):
                    sent[mkey] = int(now)
                    count += 1
    return count


# --- Sabah özeti: günde bir kez, Türkiye saatiyle 09:00-12:00 arasındaki ilk turda
SUMMARY_HOURS_UTC = (6, 9)


def daily_summary(events, calendar, prices, sent, now):
    t = time.gmtime(now)
    key = "d:%04d%02d%02d" % (t.tm_year, t.tm_mon, t.tm_mday)
    if not SUMMARY_HOURS_UTC[0] <= t.tm_hour < SUMMARY_HOURS_UTC[1] or key in sent:
        return 0
    lines = []
    for sym in PRICE_RULES:
        data = live(prices, sym, now)
        if data:
            back = data[-289][1] if len(data) >= 289 else data[0][1]
            lines.append("%s %s · 24 sa %s" % (sym, money(data[-1][1]), pct((data[-1][1] / back - 1) * 100)))
    top = [e for e in events if now - e["ts"] <= 12 * 3600 and not e.get("preview") and e["score"] >= 45][:3]
    if top:
        lines.append("Gece öne çıkanlar:")
        lines.extend("• (etki %d) %s" % (e["score"], e["title"][:110]) for e in top)
    else:
        lines.append("Gece büyük bir olay kaydedilmedi.")
    today = [ev for ev in calendar if ev.get("impact") == "High" and now <= ev["ts"] < now + 18 * 3600]
    for ev in today[:4]:
        tr = time.gmtime(ev["ts"] + 3 * 3600)
        lines.append("⏰ %02d:%02d %s" % (tr.tm_hour, tr.tm_min, ev.get("title_tr") or ev["title"]))
    if not today:
        lines.append("Bugün takvimde kritik veri yok.")
    if send("Sabah özeti", "\n".join(lines), priority=3, tags=["sunrise"]):
        sent[key] = int(now)
        return 1
    return 0


def run(events, calendar, prices, state):
    """state: {"sent": {anahtar: zaman}}; gönderilenleri işaretler ve güncel state'i döndürür."""
    sent = dict(state.get("sent", {}))
    now = time.time()
    if not TOPIC and not DRY:
        print("bildirim: kanal tanımlı değil, atlandı")
        return {"sent": sent}
    count = 0

    def recent(key, span):
        return now - sent.get(key, 0) < span

    # Elle başlatılan deneme: zincirin uçtan uca çalıştığını gösterir
    if os.environ.get("NTFY_TEST") == "true":
        ok = send("Deneme bildirimi", "Finans Paneli bildirimleri çalışıyor. Önemli bir olay olduğunda buraya düşecek.",
                  priority=3, tags=["white_check_mark"])
        print("deneme bildirimi:", "gönderildi" if ok else "gönderilemedi")

    # 1) Haber: teyitli olay, resmi açıklama ya da erken uyarı
    news_sent = 0
    for e in events:
        if news_sent >= NEWS_PER_RUN:
            break
        age = now - e["ts"]
        if e.get("preview") or age > NEWS_MAX_AGE:
            continue
        tkey = e["type"] + ":" + (e["assets"][0] if e["assets"] else "-")
        if e["score"] >= NEWS_MIN_SCORE and e["n"] >= 2:  # tek kaynaklı haber "teyitli" sayılmaz
            if "n:" + e["id"] in sent or recent("N:" + tkey, TYPE_COOLDOWN):
                continue
            was_early = "e:" + e["id"] in sent or recent("E:" + tkey, TYPE_COOLDOWN)
            title = ("Teyit edildi · %s · etki %d" if was_early else "%s · etki %d") % (e["type_label"], e["score"])
            if send(title, news_body(e, prices, now, True), priority=5 if e["score"] >= 75 else 4,
                    tags=["rotating_light"], news_url=e["url"]):
                sent["n:" + e["id"]] = sent["N:" + tkey] = int(now)
                news_sent += 1
        elif age <= EARLY_MAX_AGE and (e.get("official") or early_ok(e)):
            if "e:" + e["id"] in sent or recent("E:" + tkey, TYPE_COOLDOWN) or recent("N:" + tkey, TYPE_COOLDOWN):
                continue
            title = ("Resmi açıklama · " if e.get("official") else "Erken uyarı · ") + e["type_label"]
            if send(title, news_body(e, prices, now, False), priority=4,
                    tags=["classical_building" if e.get("official") else "zap"], news_url=e["url"]):
                sent["e:" + e["id"]] = sent["E:" + tkey] = int(now)
                news_sent += 1
    count += news_sent

    # 2) Sert fiyat hareketi
    count += price_alerts(events, prices, sent, now)
    count += tech_alerts(prices, sent, now)
    count += daily_summary(events, calendar, prices, sent, now)

    # 3) ve 4) Kritik veri: önce hatırlatma, açıklandıktan sonra ilk tepki. Aynı saatteki veriler tek bildirimde toplanır.
    slots = {}
    for ev in calendar:
        if ev.get("impact") == "High":
            slots.setdefault(ev["ts"], []).append(ev)
    for ts, group in sorted(slots.items()):
        names = " + ".join((ev.get("title_tr") or ev["title"]) for ev in group[:3])
        left = ts - now
        if 0 < left <= CALENDAR_AHEAD and "c:%d" % ts not in sent:
            detail = []
            for ev in group[:3]:
                bits = [b for b in ("beklenti " + ev["forecast"] if ev.get("forecast") else "",
                                    "önceki " + ev["previous"] if ev.get("previous") else "") if b]
                if bits:
                    detail.append((ev.get("title_tr") or ev["title"]) + ": " + ", ".join(bits))
            detail.append(now_line(prices, now) or "Açıklanınca piyasa sert hareket edebilir.")
            if send("%d dk sonra: %s" % (round(left / 60), names), "\n".join(detail), priority=4, tags=["alarm_clock"]):
                sent["c:%d" % ts] = int(now)
                count += 1
        if REACT_FROM <= -left <= REACT_TO and "r:%d" % ts not in sent:
            moves = []
            for sym in PRICE_RULES:
                data = live(prices, sym, now)
                got = since(data, ts) if data else None
                if got is not None:
                    moves.append((sym, got, data[-1][1]))
            if moves:
                head = "  ".join("%s %s" % (sym, pct(m)) for sym, m, _ in moves)
                body = ["Açıklamadan bu yana %d dakika geçti." % round(-left / 60),
                        " · ".join("%s %s" % (sym, money(p)) for sym, _, p in moves),
                        "Açıklanan rakam burada yok; haber akışından ya da panelden bak."]
                if send("Veri açıklandı: %s · %s" % (names, head), "\n".join(body),
                        priority=5 if abs(moves[0][1]) >= 1 else 4, tags=["bar_chart"]):
                    sent["r:%d" % ts] = int(now)
                    count += 1

    print("bildirim:", count)
    return {"sent": {k: v for k, v in sent.items() if now - v < 7 * 86400}}
