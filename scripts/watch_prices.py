"""Zincirin bekleme süresinde fiyatı sık aralıkla izler; sert harekette hemen bildirim gönderir.

Kullanım: python scripts/watch_prices.py <toplam_saniye> [aralık_saniye]
Standart çıktıya yalnızca gönderilen fiyat bildirimlerinin zamanını yazar ("BTC:1731230000,RENDER:...").
Bu değer bir sonraki tura aktarılır ki aynı hareket için ikinci bildirim gitmesin. Her şey standart hataya yazılır.
"""
import contextlib
import json
import os
import sys
import time
import urllib.request

import impact
import notify

TOTAL = int(sys.argv[1]) if len(sys.argv) > 1 else 140
STEP = int(sys.argv[2]) if len(sys.argv) > 2 else 20
SITE = os.environ.get("SITE", "")


def load(name, default):
    """Az önce yayınlanan veriyi siteden okur (yalnızca https)."""
    if not SITE.startswith("https://"):
        return default
    try:
        req = urllib.request.Request("%s/%s?t=%d" % (SITE, name, time.time()), headers={"User-Agent": impact.UA})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read(5 * 1024 * 1024).decode("utf-8"))
    except Exception as exc:
        print("okunamadı:", name, type(exc).__name__)
        return default


def main():
    end = time.time() + TOTAL
    sent = dict(load("notify_state.json", {}).get("sent", {}))
    events = load("news.json", {}).get("events", [])
    mine = {}
    checks = 0
    while True:
        try:
            now = time.time()
            prices = impact.Prices("")  # her seferinde taze fiyat; hisse verisi gerekmez
            before = {s: sent.get("p:" + s) for s in notify.PRICE_RULES}
            notify.price_alerts(events, prices, sent, now)
            for sym in notify.PRICE_RULES:
                if sent.get("p:" + sym) != before[sym]:
                    mine[sym] = sent["p:" + sym]
            checks += 1
        except Exception as exc:  # izleyici hata verse de zincir sürmeli
            print("izleme hatası:", type(exc).__name__)
        left = end - time.time()
        if left <= 0:
            break
        time.sleep(min(STEP, left))
    print("fiyat kontrolü:", checks, "bildirim:", len(mine))
    return ",".join("%s:%d" % (s, t) for s, t in sorted(mine.items()))


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        out = main()
    print(out)
