"""Haber ve ekonomik takvim toplayıcı.

RSS kaynaklarından başlıkları çeker, varlık ve tema etiketleri ekler,
önceki çıktıyla birleştirip data/news.json dosyasına yazar.
Yalnızca standart kütüphaneyi kullanır.

Kullanım: python scripts/fetch_news.py [çıktı_yolu]
Ortam değişkeni PREV_URL verilirse önceki haberler oradan alınır.
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import impact
import notify

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "news.json")
PREV_URL = os.environ.get("PREV_URL", "")
MAX_AGE_HOURS = 72
MAX_ITEMS = 400
UA = "Mozilla/5.0 (compatible; finans-paneli/1.0; +https://github.com/)"

# (kaynak adı, adres, kategori, dil, seviye, yayın kuruluşu)
# Seviye A: editoryal süreci olan büyük, küresel haber odası ya da resmi kurum. B: sektör yayını; haber verir ama
# görüş, tanıtım ve sponsorlu içerik de yayımlayabilir. Seviyesi bilinmeyen kaynak eklenmez.
# Yayın kuruluşu teyit sayımında kullanılır: aynı kuruluşun iki akışı tek kaynak sayılır.
FEEDS = [
    # Resmi kurum (birincil kaynak)
    ("Fed (resmi)", "https://www.federalreserve.gov/feeds/press_monetary.xml", "makro", "en", "A", "Fed"),
    # Küresel finans haber odaları
    ("Bloomberg Piyasalar", "https://feeds.bloomberg.com/markets/news.rss", "makro", "en", "A", "Bloomberg"),
    ("Bloomberg Ekonomi", "https://feeds.bloomberg.com/economics/news.rss", "makro", "en", "A", "Bloomberg"),
    ("Bloomberg Teknoloji", "https://feeds.bloomberg.com/technology/news.rss", "teknoloji", "en", "A", "Bloomberg"),
    ("Bloomberg Kripto", "https://feeds.bloomberg.com/crypto/news.rss", "kripto", "en", "A", "Bloomberg"),
    ("WSJ Piyasalar", "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", "makro", "en", "A", "WSJ"),
    ("WSJ Ekonomi", "https://feeds.content.dowjones.io/public/rss/socialeconomyfeed", "makro", "en", "A", "WSJ"),
    ("WSJ Teknoloji", "https://feeds.content.dowjones.io/public/rss/RSSWSJD", "teknoloji", "en", "A", "WSJ"),
    ("Financial Times Piyasalar", "https://www.ft.com/markets?format=rss", "makro", "en", "A", "FT"),
    ("Financial Times Teknoloji", "https://www.ft.com/technology?format=rss", "teknoloji", "en", "A", "FT"),
    ("Financial Times", "https://www.ft.com/cryptofinance?format=rss", "kripto", "en", "A", "FT"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "makro", "en", "A", "CNBC"),
    ("CNBC Piyasalar", "https://www.cnbc.com/id/20910258/device/rss/rss.html", "makro", "en", "A", "CNBC"),
    ("CNBC Teknoloji", "https://www.cnbc.com/id/19854910/device/rss/rss.html", "teknoloji", "en", "A", "CNBC"),
    ("New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "makro", "en", "A", "NYT"),
    ("New York Times Teknoloji", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "teknoloji", "en", "A", "NYT"),
    ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml", "makro", "en", "A", "BBC"),
    ("The Guardian", "https://www.theguardian.com/business/rss", "makro", "en", "A", "Guardian"),
    ("Investing.com", "https://www.investing.com/rss/news_14.rss", "makro", "en", "B", "Investing"),
    ("Investing.com Borsa", "https://www.investing.com/rss/news_25.rss", "makro", "en", "B", "Investing"),
    # Kripto
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss", "kripto", "en", "A", "CoinDesk"),
    ("The Block", "https://www.theblock.co/rss.xml", "kripto", "en", "A", "The Block"),
    ("Cointelegraph", "https://cointelegraph.com/rss", "kripto", "en", "B", "Cointelegraph"),
    ("Decrypt", "https://decrypt.co/feed", "kripto", "en", "B", "Decrypt"),
    ("Bitcoin Magazine", "https://bitcoinmagazine.com/feed", "kripto", "en", "B", "Bitcoin Magazine"),
    # Teknoloji
    ("TechCrunch", "https://techcrunch.com/feed/", "teknoloji", "en", "A", "TechCrunch"),
    ("The Verge", "https://www.theverge.com/rss/index.xml", "teknoloji", "en", "A", "The Verge"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "teknoloji", "en", "A", "Ars Technica"),
    # Türkiye'den büyük ajans ve kanal
    ("Bloomberg HT", "https://www.bloomberght.com/rss", "makro", "tr", "A", "Bloomberg HT"),
    ("Anadolu Ajansı", "https://www.aa.com.tr/tr/rss/default?cat=ekonomi", "makro", "tr", "A", "AA"),
]
OUTLET = {f[0]: f[5] for f in FEEDS}
OFFICIAL = {"Fed"}

CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

# etiket -> başlıkta aranan kalıplar (küçük harf, kelime sınırıyla)
TAGS = {
    "BTC": [r"bitcoin", r"btc"],
    "ETH": [r"ethereum", r"ether", r"eth"],
    "SOL": [r"solana", r"sol"],
    "RENDER": [r"render network", r"render token", r"rndr", r"\$render"],
    "XRP": [r"xrp", r"ripple"],
    "BNB": [r"bnb", r"binance"],
    "DOGE": [r"dogecoin", r"doge"],
    "AI": [r"ai", r"a\.i\.", r"artificial intelligence", r"yapay zek[aâ]", r"openai", r"anthropic",
           r"chatgpt", r"nvidia", r"gpu", r"gpus", r"llm", r"bittensor", r"deepmind", r"gemini", r"claude"],
    "Makro": [r"fed", r"fomc", r"federal reserve", r"federal open market committee", r"inflation", r"enflasyon", r"cpi", r"interest rates?",
              r"rate cut", r"rate hike", r"faiz", r"treasury", r"tariffs?", r"recession", r"jobs report",
              r"payrolls", r"gdp", r"dollar", r"dolar", r"merkez bankası\w*", r"tcmb", r"borsa\w*", r"bist",
              r"altın\w*", r"petrol\w*", r"gold", r"oil", r"nasdaq", r"s&p 500", r"wall street", r"stocks"],
    "Teknoloji": [r"apple", r"microsoft", r"google", r"alphabet", r"meta", r"amazon", r"tesla", r"tsmc", r"amd",
                  r"intel", r"semiconductors?", r"chips?", r"chipmakers?", r"çip\w*", r"earnings", r"ipo",
                  r"data centers?", r"veri merkez\w+", r"spacex", r"palantir", r"samsung"],
    "Regülasyon": [r"sec", r"cftc", r"regulat\w+", r"lawsuit", r"etf", r"etfs", r"congress", r"senate",
                   r"ban", r"bans", r"banned", r"sanctions?", r"düzenleme", r"spk", r"yasak\w*"],
}

HOT = [r"fed", r"fomc", r"rate cut", r"rate hike", r"etf", r"sec", r"hack\w*", r"exploit\w*", r"all-time high",
       r"record high", r"crash\w*", r"plunge\w*", r"liquidat\w+", r"approv\w+", r"ban", r"banned", r"bankrupt\w*",
       r"breaking", r"tariffs?", r"cpi", r"inflation", r"son dakika", r"rekor", r"çök\w+"]

POSITIVE = [r"surg\w+", r"rall\w+", r"soar\w*", r"jump\w*", r"gain\w*", r"climb\w*", r"record high", r"all-time high",
            r"bullish", r"approv\w+", r"adopt\w+", r"inflows?", r"beats?", r"upgrade\w*", r"rebound\w*", r"recover\w*",
            r"breakout", r"tops", r"rises?", r"rose", r"boost\w*", r"yüksel\w+", r"rekor", r"artış", r"ralli"]
NEGATIVE = [r"crash\w*", r"plung\w+", r"drop\w*", r"falls?", r"fell", r"slump\w*", r"slid\w*", r"tumbl\w+", r"hack\w*",
            r"exploit\w*", r"lawsuit", r"sued", r"bearish", r"outflows?", r"liquidat\w+", r"sell-?off", r"fraud",
            r"collaps\w+", r"warn\w*", r"downgrade\w*", r"bankrupt\w*", r"scam\w*", r"losses", r"fear\w*", r"dips?",
            r"düş\w+", r"çök\w+", r"geril\w+", r"kayıp", r"dolandırıcı\w*"]

CAL_TR = {
    "Federal Funds Rate": "Fed faiz kararı",
    "FOMC Statement": "Fed karar metni",
    "FOMC Press Conference": "Fed basın toplantısı",
    "FOMC Meeting Minutes": "Fed toplantı tutanakları",
    "FOMC Economic Projections": "Fed ekonomik tahminleri",
    "CPI m/m": "Enflasyon (TÜFE), aylık",
    "CPI y/y": "Enflasyon (TÜFE), yıllık",
    "Core CPI m/m": "Çekirdek enflasyon, aylık",
    "PPI m/m": "Üretici fiyatları (ÜFE), aylık",
    "Core PPI m/m": "Çekirdek ÜFE, aylık",
    "Core PCE Price Index m/m": "Çekirdek PCE enflasyonu, aylık",
    "Non-Farm Employment Change": "Tarım dışı istihdam",
    "ADP Non-Farm Employment Change": "ADP özel sektör istihdamı",
    "Unemployment Rate": "İşsizlik oranı",
    "Unemployment Claims": "Haftalık işsizlik başvuruları",
    "Average Hourly Earnings m/m": "Ortalama saatlik kazanç, aylık",
    "Retail Sales m/m": "Perakende satışlar, aylık",
    "Core Retail Sales m/m": "Çekirdek perakende satışlar, aylık",
    "Advance GDP q/q": "Büyüme (GSYH), öncü",
    "Prelim GDP q/q": "Büyüme (GSYH), ön veri",
    "Final GDP q/q": "Büyüme (GSYH), nihai",
    "ISM Manufacturing PMI": "ISM imalat PMI",
    "ISM Services PMI": "ISM hizmet PMI",
    "JOLTS Job Openings": "JOLTS açık iş sayısı",
    "CB Consumer Confidence": "Tüketici güveni (CB)",
    "Prelim UoM Consumer Sentiment": "Michigan tüketici güveni, ön veri",
    "Bank Holiday": "Resmi tatil",
}


SKIP = [r"price predictions?", r"price analysis", r"fiyat tahmin\w*", r"sponsored", r"press release", r"partner content",
        r"presale\w*", r"giveaways?", r"airdrops?", r"best crypto\w* to buy", r"top \d+ \w+ to (?:buy|watch)",
        r"could (?:hit|reach)", r"to the moon", r"\d+x", r"here.s what happened", r"how to buy", r"casinos?", r"bonus\w*"]

def compile_words(words):
    return re.compile(r"(?<![\w$])(?:" + "|".join(words) + r")(?!\w)", re.IGNORECASE)


TAG_RE = {tag: compile_words(words) for tag, words in TAGS.items()}
HOT_RE = compile_words(HOT)
POS_RE = compile_words(POSITIVE)
SKIP_RE = compile_words(SKIP)
NEG_RE = compile_words(NEGATIVE)


MAX_BYTES = 3 * 1024 * 1024


def fetch(url, timeout=20):
    """Yalnızca https; yanıt en fazla MAX_BYTES okunur."""
    if not url.startswith("https://"):
        raise ValueError("yalnızca https adresleri okunur")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if not resp.geturl().startswith("https://"):
            raise ValueError("https dışına yönlendirme")
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("yanıt çok büyük")
    return data


def local(tag):
    return tag.rsplit("}", 1)[-1]


def clean(text):
    text = re.sub(r"<[^>]+>", "", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_date(text):
    if not text:
        return None
    text = text.strip()
    try:
        return parsedate_to_datetime(text).timestamp()
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


def parse_feed(raw):
    # Varlık tanımı içeren XML işlenmez (bellek şişirme saldırılarına karşı)
    if b"<!ENTITY" in raw or b"<!entity" in raw:
        raise ValueError("XML varlık tanımı reddedildi")
    root = ET.fromstring(raw)
    for node in root.iter():
        if local(node.tag) not in ("item", "entry"):
            continue
        title = link = date = None
        for child in node:
            name = local(child.tag)
            if name == "title" and title is None:
                title = clean(child.text)
            elif name == "link" and link is None:
                href = child.attrib.get("href")
                if href and child.attrib.get("rel", "alternate") != "alternate":
                    continue
                link = (href or child.text or "").strip()
            elif name in ("pubDate", "published", "updated", "date") and date is None:
                date = parse_date(child.text)
        if title and link and re.match(r"https?://[^\s\"'<>]+$", link):
            yield title, link, date


def classify(title):
    tags = [tag for tag, rx in TAG_RE.items() if rx.search(title)]
    pos = len(POS_RE.findall(title))
    neg = len(NEG_RE.findall(title))
    sent = 1 if pos > neg else -1 if neg > pos else 0
    return tags, sent, bool(HOT_RE.search(title))


def read_feed(feed):
    name, url, cat, lang, tier, outlet = feed
    now = time.time()
    items = []
    for title, link, ts in parse_feed(fetch(url)):
        ts = min(ts or now, now)
        if SKIP_RE.search(title):
            continue  # tahmin, tanıtım ve sponsorlu içerik haber sayılmaz
        tags, sent, hot = classify(title)
        if cat != "kripto" and not tags:
            continue  # piyasayla ilgisi olmayan genel haberleri ele
        items.append({
            "id": hashlib.sha1(link.encode("utf-8")).hexdigest()[:12],
            "title": title[:240],
            "url": link,
            "source": name,
            "outlet": outlet,
            "cat": cat,
            "lang": lang,
            "tier": tier,
            "conf": 1,
            "ts": int(ts),
            "tags": tags,
            "sent": sent,
            "hot": hot,
        })
    return items


def load_previous():
    try:
        if PREV_URL:
            return json.loads(fetch(PREV_URL + "?t=" + str(int(time.time()))).decode("utf-8"))
        with open(OUT, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def translate_event(title):
    if title in CAL_TR:
        return CAL_TR[title]
    m = re.match(r"FOMC Member (.+) Speaks$", title)
    if m:
        return "Fed üyesi " + m.group(1) + " konuşuyor"
    m = re.match(r"Fed Chair (.+) (Speaks|Testifies)$", title)
    if m:
        return "Fed Başkanı " + m.group(1) + (" konuşuyor" if m.group(2) == "Speaks" else " ifade veriyor")
    return ""


def read_calendar():
    rows = json.loads(fetch(CALENDAR_URL).decode("utf-8"))
    events = []
    for row in rows:
        if row.get("country") != "USD" or row.get("impact") not in ("High", "Medium", "Holiday"):
            continue
        ts = parse_date(row.get("date"))
        if ts is None:
            continue
        title = (row.get("title") or "").strip()
        events.append({
            "ts": int(ts),
            "title": title,
            "title_tr": translate_event(title),
            "impact": row.get("impact"),
            "forecast": row.get("forecast") or "",
            "previous": row.get("previous") or "",
        })
    events.sort(key=lambda e: e["ts"])
    return events


def load_log():
    try:
        if PREV_URL:
            return json.loads(fetch(PREV_URL.replace("news.json", "events_log.json") + "?t=" + str(int(time.time()))).decode("utf-8"))
        with open(os.path.join(os.path.dirname(OUT) or ".", "events_log.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return []


def load_side(name, default):
    """news.json ile aynı yerde duran yardımcı dosyayı (önceki yayından ya da diskten) okur."""
    try:
        if PREV_URL:
            return json.loads(fetch(PREV_URL.replace("news.json", name) + "?t=" + str(int(time.time()))).decode("utf-8"))
        with open(os.path.join(os.path.dirname(OUT) or ".", name), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def main():
    prev = load_previous()
    prev_log = load_log()
    errors = []
    fresh = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [(feed, pool.submit(read_feed, feed)) for feed in FEEDS]
        for feed, fut in futures:
            try:
                fresh.extend(fut.result())
            except Exception as exc:
                errors.append(feed[0])
                print("HATA", feed[0], repr(exc)[:160], file=sys.stderr)

    cutoff = time.time() - MAX_AGE_HOURS * 3600
    merged = {}
    seen_titles = set()
    # Yeni gelenler önce: aynı haber iki kez görünürse güncel etiketler kalır
    for item in fresh + list(prev.get("items", [])):
        key = re.sub(r"\W+", "", item.get("title", "").lower())[:80]
        if item.get("ts", 0) < cutoff or item["id"] in merged or key in seen_titles:
            continue
        merged[item["id"]] = item
        seen_titles.add(key)
    items = sorted(merged.values(), key=lambda i: i["ts"], reverse=True)[:MAX_ITEMS]
    items = [i for i in items if i["source"] in OUTLET and not SKIP_RE.search(i["title"])]
    for item in items:
        item["outlet"] = OUTLET[item["source"]]
        item["official"] = item["outlet"] in OFFICIAL
    markets_path = os.path.join(os.path.dirname(OUT) or ".", "markets.json")
    events = impact.analyze(items, markets_path)
    for item in items:
        # "Önemli" rozeti yalnızca A seviye kaynağa ya da birden çok kaynağın teyidine verilir
        item["hot"] = bool(HOT_RE.search(item["title"])) and (item.get("tier") == "A" or item["conf"] >= 2)
    now = time.time()
    top = [e for e in events if e["score"] >= 45 and now - e["ts"] <= 48 * 3600][:8]

    # Olay kaydı: ileride "bu türden olaylardan sonra fiyat ne yaptı" istatistiği için
    log = {e["id"]: e for e in prev_log}
    for e in events:
        if e["score"] >= 55 and e["id"] not in log:
            log[e["id"]] = {"id": e["id"], "ts": e["ts"], "type": e["type"], "score": e["score"],
                            "title": e["title"], "assets": e["assets"], "cat": e["cat"]}
    log_out = sorted(log.values(), key=lambda e: e["ts"])[-3000:]

    try:
        calendar = read_calendar()
    except Exception as exc:
        errors.append("Ekonomik takvim")
        print("HATA takvim", repr(exc)[:160], file=sys.stderr)
        calendar = prev.get("calendar", [])

    out = {"updated": int(time.time()), "items": items, "events": top, "calendar": calendar, "errors": errors}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(os.path.dirname(OUT) or ".", "events_log.json"), "w", encoding="utf-8") as fh:
        json.dump(log_out, fh, ensure_ascii=False, separators=(",", ":"))
    print("olay:", len(top), "kayıt:", len(log_out))

    # Telefona bildirim: gönderilenler tekrar gitmesin diye küçük bir durum dosyası tutulur
    state = load_side("notify_state.json", {})
    # Turlar arasındaki fiyat izleyicisi bildirim gönderdiyse zamanı buradan gelir ("p:BTC=1731230000,...")
    for part in os.environ.get("PRICE_SENT", "").split(","):
        m = re.match(r"^([ptlm]:([A-Z]{2,10})(?::[a-z0-9]{1,12})?)=(\d{10})$", part.strip())
        if m and m.group(2) in notify.PRICE_RULES and int(m.group(3)) <= time.time() + 60:
            sent = state.setdefault("sent", {})
            sent[m.group(1)] = max(int(m.group(3)), sent.get(m.group(1), 0))
    state = notify.run(events, calendar, impact.Prices(markets_path), state)
    with open(os.path.join(os.path.dirname(OUT) or ".", "notify_state.json"), "w", encoding="utf-8") as fh:
        json.dump(state, fh, separators=(",", ":"))
    print("haber:", len(items), "yeni çekilen:", len(fresh), "takvim:", len(calendar), "hata:", errors)
    if not items:
        sys.exit(1)


if __name__ == "__main__":
    main()
