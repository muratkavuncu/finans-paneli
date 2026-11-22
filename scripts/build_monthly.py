"""Bir kerelik: son 4 yılın her ayının 1'ine en yakın coinmarketcap.com arşiv kopyasından ilk 100 (sıra + USD fiyat).

Internet Archive'dan okunur (fetch_ranks.py ile aynı ayrıştırıcı). Elle, kişisel bilgisayardan bir kez çalıştırılır;
çıktı depoya girer (hist/cmc_monthly.json) ve değişmez. Yarıda kalırsa yeniden çalıştırınca eksik ayları tamamlar.

Çıktı: {"source": "...", "syms": {"id": "SYM"}, "months": [{"ts": "YYYYMMDDhhmmss", "c": {"id": [rank, usd]}}]}
"""
import calendar
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_ranks as f  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hist", "cmc_monthly.json")
MONTHS = 48
TOL = 3  # gün


def month_starts():
    y, m = time.gmtime().tm_year, time.gmtime().tm_mon
    out = []
    for _ in range(MONTHS):
        out.append(calendar.timegm((y, m, 1, 12, 0, 0)))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return sorted(out)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    try:
        res = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        res = {"source": "Internet Archive · coinmarketcap.com kopyaları", "syms": {}, "months": []}
    have = {m["ts"][:6] for m in res["months"]}
    cache = {}
    for want in month_starts():
        ym = time.strftime("%Y%m", time.gmtime(want))
        if ym in have:
            continue
        ok = False
        try:
            cands = f.cdx_list(want, TOL)[:5]
        except Exception as e:
            print(ym, "dizin hatası", e)
            continue
        for t in cands:
            try:
                snap = f.snapshot(t, cache)
            except Exception as e:
                print(ym, t, "okunamadı", e)
                continue
            c = {}
            for cid, (rank, sym, usd) in snap.items():
                c[str(cid)] = [rank, usd]
                res["syms"].setdefault(str(cid), sym.upper())
            res["months"].append({"ts": t, "c": c})
            res["months"].sort(key=lambda m: m["ts"])
            json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            print(ym, t, len(c), "fiyatlı:", sum(1 for v in c.values() if v[1]))
            ok = True
            break
        if not ok:
            print(ym, "EKSİK (aday:", len(cands), ")")
    print("toplam ay:", len(res["months"]))


if __name__ == "__main__":
    main()
