"""Telefona bildirim (ntfy): hızlı tepki gerektiren gelişmeler.

Dört tür bildirim gönderir:
  1) Haber    - erken uyarı (tek büyük küresel kaynak + fiyat tepki veriyor), resmi açıklama,
                teyitli (en az iki ayrı yayın kuruluşu) yüksek etkili olay
  2) Fiyat    - BTC / RENDER'da 5 ya da 15 dakikada sert hareket
  3) Takvim   - kritik veriden önce hatırlatma
  4) Tepki    - kritik veri açıklandıktan birkaç dakika sonra piyasanın ilk tepkisi

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

    # 2) Sert fiyat hareketi (son 5 ve 15 dakika)
    for sym, (lim15, lim5) in PRICE_RULES.items():
        data = live(prices, sym, now)
        if not data or recent("p:" + sym, PRICE_COOLDOWN):
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
