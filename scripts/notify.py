"""Telefona bildirim (ntfy).

Üç tür bildirim gönderir: yüksek etkili haber, sert fiyat hareketi, yaklaşan kritik veri.
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

NEWS_MIN_SCORE = 60        # bu puanın altındaki haber için bildirim gitmez
NEWS_MAX_AGE = 6 * 3600    # eski olay için bildirim gitmez
NEWS_PER_RUN = 3
PRICE_SYMBOLS = ["BTC", "RENDER"]
PRICE_MOVE = 2.0           # 15 dakikada yüzde
PRICE_COOLDOWN = 3600      # aynı varlık için en erken bir saat sonra tekrar
CALENDAR_AHEAD = 25 * 60   # veriden en fazla bu kadar önce haber ver

# "Haberi aç" düğmesi yalnızca bilinen kaynakların adreslerine konur
NEWS_HOSTS = ("coindesk.com", "cointelegraph.com", "decrypt.co", "theblock.co", "bitcoinmagazine.com", "investing.com",
              "techcrunch.com", "theverge.com", "arstechnica.com", "cnbc.com", "bloomberght.com", "aa.com.tr",
              "dunya.com", "bbc.com", "bbc.co.uk", "ft.com")


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


def run(events, calendar, prices, state):
    """state: {"sent": {anahtar: zaman}}; gönderilenleri işaretler ve güncel state'i döndürür."""
    sent = dict(state.get("sent", {}))
    now = time.time()
    if not TOPIC and not DRY:
        print("bildirim: kanal tanımlı değil, atlandı")
        return {"sent": sent}
    count = 0

    # Elle başlatılan deneme: zincirin uçtan uca çalıştığını gösterir
    if os.environ.get("NTFY_TEST") == "true":
        ok = send("Deneme bildirimi", "Finans Paneli bildirimleri çalışıyor. Önemli bir olay olduğunda buraya düşecek.",
                  priority=3, tags=["white_check_mark"])
        print("deneme bildirimi:", "gönderildi" if ok else "gönderilemedi")

    # 1) Yüksek etkili haber
    fresh = [e for e in events if e["score"] >= NEWS_MIN_SCORE and now - e["ts"] <= NEWS_MAX_AGE
             and not e.get("preview") and "n:" + e["id"] not in sent]
    for e in fresh[:NEWS_PER_RUN]:
        lines = [e["title"]]
        if e["up"]:
            lines.append("▲ " + ", ".join(e["up"]))
        if e["down"]:
            lines.append("▼ " + ", ".join(e["down"]))
        if not e["up"] and not e["down"]:
            lines.append(e["why"])
        if e["react"]:
            lines.append("İlk tepki: " + "  ".join(r["k"] + " " + pct(r["pct"]) for r in e["react"]))
        lines.append("%d kaynak · %s" % (e["n"], e["source"]))
        if send("Etki %d · %s" % (e["score"], e["type_label"]), "\n".join(lines),
                priority=5 if e["score"] >= 75 else 4, tags=["rotating_light"], news_url=e["url"]):
            sent["n:" + e["id"]] = int(now)
            count += 1

    # 2) Sert fiyat hareketi (son 15 dakika)
    for sym in PRICE_SYMBOLS:
        data = prices.series(sym)
        if len(data) < 4 or now - data[-1][0] > 900 or now - sent.get("p:" + sym, 0) < PRICE_COOLDOWN:
            continue
        move = (data[-1][1] / data[-4][1] - 1) * 100
        if abs(move) >= PRICE_MOVE:
            price = ("%.2f" % data[-1][1]) if data[-1][1] >= 100 else ("%.4f" % data[-1][1])
            tag = "chart_with_upwards_trend" if move > 0 else "chart_with_downwards_trend"
            if send("%s 15 dakikada %s" % (sym, pct(move)), "Fiyat: $%s\nHaber henüz düşmemiş olabilir; panelden kontrol et." % price,
                    priority=4, tags=[tag]):
                sent["p:" + sym] = int(now)
                count += 1

    # 3) Yaklaşan kritik veri
    for ev in calendar:
        key = "c:%d:%s" % (ev["ts"], ev["title"])
        left = ev["ts"] - now
        if ev.get("impact") != "High" or not 0 < left <= CALENDAR_AHEAD or key in sent:
            continue
        detail = []
        if ev.get("forecast"):
            detail.append("beklenti " + ev["forecast"])
        if ev.get("previous"):
            detail.append("önceki " + ev["previous"])
        if send("%d dk sonra: %s" % (round(left / 60), ev.get("title_tr") or ev["title"]),
                " · ".join(detail) or "Açıklanınca piyasa sert hareket edebilir.", priority=4, tags=["alarm_clock"]):
            sent[key] = int(now)
            count += 1

    print("bildirim:", count)
    return {"sent": {k: v for k, v in sent.items() if now - v < 7 * 86400}}
