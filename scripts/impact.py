"""Haber kümeleme, etki puanı ve "tipik etki" kural kitabı.

Puan (0-100) beş parçadan oluşur:
  olay türü (0-40) + teyit (0-25) + yayılma hızı (0-10) + kapsam (0-10) + ölçülen piyasa tepkisi (0-15)

"Tipik etki" listeleri, olay türlerinin geçmişte çoğunlukla nasıl fiyatlandığına dair genel
kabullerdir; tahmin ya da tavsiye değildir. Piyasa beklentiyi önceden fiyatladıysa tersi görülebilir.
"""
import json
import re
import urllib.request
from collections import defaultdict

UA = "Mozilla/5.0 (compatible; finans-paneli/1.0)"
BINANCE = "https://data-api.binance.vision/api/v3/klines?symbol=%sUSDT&interval=5m&limit=1000"

STOP = set("""the a an and or of to in on for with from at by as is are was be its it this that after over into amid
new says say will has have had not more than up down out about what why how when who you your their his her our
bir ve ile için bu da de mi den dan olarak göre daha çok""".split())

COIN_TAGS = ["BTC", "ETH", "SOL", "RENDER", "XRP", "BNB", "DOGE"]
COMPANIES = {  # görünen ad -> (kalıp, hisse kodu)
    "Nvidia": (r"nvidia", "NVDA"), "Apple": (r"apple", "AAPL"), "Microsoft": (r"microsoft", "MSFT"),
    "Alphabet": (r"google|alphabet", "GOOGL"), "Amazon": (r"amazon", "AMZN"), "Meta": (r"meta", "META"),
    "Tesla": (r"tesla", "TSLA"), "AMD": (r"amd", "AMD"), "TSMC": (r"tsmc|taiwan semiconductor", "TSM"),
    "OpenAI": (r"openai", None), "Coinbase": (r"coinbase", None), "Binance": (r"binance", None),
    "Strategy": (r"microstrategy|mstr|saylor", None),
}
COMPANY_RE = {name: re.compile(r"(?<![\w$])(?:" + pat + r")(?!\w)", re.I) for name, (pat, _) in COMPANIES.items()}

V = "{varlık}"


def words(*alts):
    return re.compile(r"(?<![\w$])(?:" + "|".join(alts) + r")(?!\w)", re.I)


def both(first, second):
    """Başlıkta iki grubun da geçmesini ister (sıra önemsiz)."""
    a = r"(?<![\w$])(?:" + "|".join(first) + r")(?!\w)"
    b = r"(?<![\w$])(?:" + "|".join(second) + r")(?!\w)"
    return re.compile(r"(?=.*" + a + r")(?=.*" + b + r")", re.I | re.S)


INFL = [r"cpi", r"inflation", r"enflasyon\w*", r"tüfe", r"pce"]
FED = [r"fed", r"fomc", r"federal reserve", r"federal open market committee", r"powell"]
ETF = [r"etfs?"]
EARN = [r"earnings", r"results", r"revenue", r"profit", r"guidance", r"bilanço\w*", r"q[1-4]"]
REGULATOR = [r"sec", r"cftc", r"doj", r"regulators?", r"justice department", r"spk", r"masak"]

# Sıra önemli: özel olanlar önce. w = olay türü ağırlığı (0-40), wide = tüm piyasayı etkiler
PLAYBOOK = [
    dict(id="fed_cut", label="Faiz indirimi sinyali", w=38, wide=True,
         rx=words(r"rate cuts?", r"cuts? (?:interest )?rates", r"cut rates", r"dovish", r"faiz indirim\w*", r"faiz indir\w+"),
         up=["Teknoloji", "Kripto", "Altın"], down=["Dolar"],
         why="Düşük faiz riskli varlıklara ilgiyi artırır ve doları zayıflatır."),
    dict(id="fed_hike", label="Faiz artışı sinyali", w=38, wide=True,
         rx=words(r"rate hikes?", r"hikes? rates", r"raises? rates", r"hawkish", r"faiz art[ıi]r\w+", r"faiz artış\w*"),
         up=["Dolar"], down=["Teknoloji", "Kripto", "Altın"],
         why="Yüksek faiz parayı riskli varlıklardan tahvile ve dolara çeker."),
    dict(id="infl_hot", label="Enflasyon beklentinin üstünde", w=36, wide=True,
         rx=both(INFL, [r"hotter", r"higher than expected", r"above expectations?", r"accelerat\w+", r"jumps?", r"surges?",
                        r"beklenti\w* üzerinde", r"beklenti\w* üstünde", r"hızlan\w+"]),
         up=["Dolar"], down=["Teknoloji", "Kripto"],
         why="Yüksek enflasyon faiz indirimi beklentisini erteler."),
    dict(id="infl_cool", label="Enflasyon beklentinin altında", w=36, wide=True,
         rx=both(INFL, [r"cools?", r"cooled", r"eases?", r"slows?", r"lower than expected", r"below expectations?",
                        r"beklenti\w* altında", r"yavaşla\w+", r"geriled\w+"]),
         up=["Teknoloji", "Kripto", "Altın"], down=["Dolar"],
         why="Düşen enflasyon faiz indirimi beklentisini güçlendirir."),
    dict(id="fed", label="Fed gündemi", w=28, wide=True, rx=words(*FED),
         up=[], down=[], why="Yön, mesajın beklentiye göre şahin mi güvercin mi olduğuna bağlı."),
    dict(id="infl", label="Enflasyon verisi", w=28, wide=True, rx=words(*INFL),
         up=[], down=[], why="Yön, verinin beklentinin üstünde mi altında mı geldiğine bağlı."),
    dict(id="jobs", label="İstihdam verisi", w=24, wide=True,
         rx=words(r"jobs report", r"payrolls", r"unemployment", r"jobless claims", r"istihdam", r"işsizlik"),
         up=[], down=[], why="Güçlü istihdam faiz indirimini erteleyebilir; yön beklentiye bağlı."),
    dict(id="geo", label="Jeopolitik gerilim", w=32, wide=True,
         rx=words(r"declares? war", r"war (?:in|on|with|against) (?!drugs|talent|inflation|crypto|cash)\w+", r"invasion", r"invades?",
                  r"invaded", r"missile (?:strikes?|attacks?)", r"airstrikes?", r"military (?:strikes?|action|operation)s?",
                  r"savaş ilan\w*", r"füze saldırı\w*", r"hava saldırı\w*", r"askeri operasyon\w*", r"işgal et\w+"),
         up=["Altın", "Petrol", "Dolar"], down=["Teknoloji", "Kripto"],
         why="Belirsizlik parayı güvenli limanlara iter."),
    dict(id="tariff", label="Gümrük vergisi / ticaret savaşı", w=30, wide=True,
         rx=words(r"tariffs?", r"trade war", r"gümrük vergi\w*", r"ticaret savaş\w*"),
         up=["Altın"], down=["Teknoloji", "Yarı iletkenler", "Kripto"],
         why="Ticaret engelleri maliyeti artırır, risk iştahını düşürür."),
    dict(id="chip_export", label="Çip ihracat kısıtlaması", w=32, wide=False,
         rx=both([r"export", r"sanctions?", r"ban", r"bans", r"curbs?", r"restrictions?", r"ihracat", r"yasak\w*"],
                 [r"chips?", r"semiconductors?", r"nvidia", r"gpus?", r"çip\w*"]),
         up=[], down=["Yarı iletkenler", "Nvidia", "AMD"],
         why="Satış yapılabilecek pazar daralır."),
    dict(id="hack", label="Hack / güvenlik açığı", w=32, wide=False,
         rx=words(r"hack\w*", r"exploit\w*", r"stolen", r"drained", r"breach\w*", r"heist", r"çalın\w+", r"siber saldırı\w*"),
         up=[], down=[V, "Kripto (kısa vade)"],
         why="Güven sarsılır; çalınan varlıklar satış baskısı yaratabilir."),
    dict(id="collapse", label="İflas / çekim durdurma", w=36, wide=False,
         rx=words(r"bankrupt\w*", r"insolven\w+", r"collaps\w+", r"halts? withdrawals?", r"chapter 11", r"iflas\w*"),
         up=[], down=[V, "Kripto"],
         why="Bulaşma korkusu sektör geneline yayılabilir."),
    dict(id="etf_no", label="ETF reddi / ertelemesi", w=28, wide=False,
         rx=both(ETF, [r"reject\w*", r"delay\w*", r"den(?:y|ies|ied)", r"postpon\w+", r"ertele\w+", r"redded\w+"]),
         up=[], down=[V], why="Beklenen kurumsal talep ertelenir."),
    dict(id="etf_yes", label="ETF onayı / başlangıcı", w=30, wide=False,
         rx=both(ETF, [r"approv\w+", r"launch\w*", r"green ?lights?", r"debuts?", r"wins?", r"onay\w*"]),
         up=[V, "Kripto"], down=[], why="Kurumsal yatırımcının erişimi kolaylaşır."),
    dict(id="etf_flow", label="ETF para akışı", w=18, wide=False, rx=both(ETF, [r"inflows?", r"outflows?", r"giriş\w*", r"çıkış\w*"]),
         up=[], down=[], why="Giriş alım baskısı, çıkış satış baskısı demektir; yön habere bağlı."),
    dict(id="reg_bad", label="Düzenleyici baskı", w=28, wide=False,
         rx=both(REGULATOR + [r"court", r"judge", r"senate", r"congress"],
                 [r"sues?", r"sued", r"charges?", r"lawsuit", r"crackdown", r"fines?", r"probes?", r"investigat\w+", r"subpoena\w*",
                  r"bans?", r"ceza\w*", r"dava\w*", r"soruşturma\w*"]),
         up=[], down=[V], why="Hukuki risk ve belirsizlik değerlemeyi baskılar."),
    dict(id="reg_good", label="Olumlu düzenleme adımı", w=26, wide=False,
         rx=words(r"trust charter", r"wins? approval", r"regulatory approval", r"gets? license", r"granted license", r"legal tender",
                  r"strategic reserve", r"bill passes", r"signs? (?:\w+ )?bill", r"clarity act", r"lisans ald\w+"),
         up=[V, "Kripto"], down=[], why="Hukuki belirsizlik azalır, kurumsal katılım kolaylaşır."),
    dict(id="ai_capex", label="Büyük AI / veri merkezi yatırımı", w=26, wide=False,
         rx=both([r"data cent(?:er|re)s?", r"ai", r"chips?", r"gpus?", r"compute", r"veri merkez\w+"],
                 [r"\$\d[\d.,]* ?(?:billion|bn|trillion)", r"capex", r"invest(?:s|ing|ment)?", r"spending", r"yatırım\w*"]),
         up=["Yarı iletkenler", "Veri merkezi ve enerji", "AI tokenları (dolaylı)"], down=[],
         why="AI harcaması çip, sunucu ve enerji talebine doğrudan yansır."),
    dict(id="ceo", label="Yönetim krizi", w=24, wide=False,
         rx=both([r"ceo", r"chief executive", r"founder", r"board"],
                 [r"resigns?", r"steps? down", r"ousted", r"fired", r"investigat\w+", r"probes?", r"scandal", r"affair", r"arrest\w*"]),
         up=[], down=[V], why="Liderlik belirsizliği yatırımcı güvenini zedeler."),
    dict(id="earn_bad", label="Zayıf bilanço / beklenti", w=24, wide=False,
         rx=both(EARN, [r"miss\w*", r"falls? short", r"disappoint\w*", r"warns?", r"cuts? (?:guidance|forecast|outlook)", r"slump\w*", r"plung\w+"]),
         up=[], down=[V, "Sektördeki benzer şirketler"], why="Kazanç beklentisi aşağı çekilir."),
    dict(id="earn_good", label="Güçlü bilanço / beklenti", w=24, wide=False,
         rx=both(EARN, [r"beats?", r"tops?", r"record", r"raises? (?:guidance|forecast|outlook)", r"surg\w+", r"soar\w*", r"jumps?"]),
         up=[V, "Sektördeki benzer şirketler"], down=[], why="Kazanç beklentisi yukarı çekilir."),
    dict(id="earn", label="Bilanço", w=18, wide=False, rx=words(r"earnings", r"quarterly results", r"bilanço\w*"),
         up=[], down=[], why="Yön, sonuçların beklentiyi aşıp aşmadığına bağlı."),
    dict(id="etf", label="ETF gündemi", w=18, wide=False, rx=words(*ETF),
         up=[], down=[], why="Yön, haberin onay mı, ret mi, para girişi mi olduğuna bağlı."),
    dict(id="selloff", label="Sert satış / likidasyon", w=24, wide=False,
         rx=words(r"crash\w*", r"plung\w+", r"sell-?off", r"liquidat\w+", r"tumbl\w+", r"çök\w+", r"sert düş\w+"),
         up=[], down=[], why="Olayın kendisi bir fiyat hareketi; devamı kaldıracın ne kadar temizlendiğine bağlı."),
    dict(id="ath", label="Rekor seviye", w=20, wide=False,
         rx=words(r"all-time high", r"record high", r"new high", r"rekor kır\w+", r"tüm zamanların en yükseğ\w+"),
         up=[], down=[], why="Olayın kendisi bir fiyat hareketi; momentum sürebilir ya da kâr satışı gelebilir."),
    dict(id="treasury", label="Kurumsal alım", w=14, wide=False,
         rx=both([r"buys?", r"bought", r"acquires?", r"adds?", r"purchas\w+", r"satın al\w+"], [r"bitcoin", r"btc", r"ether(?:eum)?", r"eth"]),
         up=[V], down=[], why="Kurumsal talep arzı sıkıştırır; tek başına etkisi genelde sınırlıdır."),
]
PLAY = {p["id"]: p for p in PLAYBOOK}

# Aynı olayda zıt yönlü iki kalıp birden tutuyorsa yön verilmez, genel türe düşülür
OPPOSITES = {"infl_hot": ("infl_cool", "infl"), "infl_cool": ("infl_hot", "infl"),
             "fed_cut": ("fed_hike", "fed"), "fed_hike": ("fed_cut", "fed"),
             "earn_good": ("earn_bad", "earn"), "earn_bad": ("earn_good", "earn"),
             "etf_yes": ("etf_no", "etf"), "etf_no": ("etf_yes", "etf")}
# Kural kitabı ABD verisine göre yazıldı; başka ülke verisinde yön verilmez ve ağırlık yarıya iner
US_ONLY = {"infl_hot", "infl_cool", "infl", "fed_cut", "fed_hike", "jobs"}
FOREIGN = words(r"china\w*", r"chinese", r"japan\w*", r"euro(?:zone|pe\w*)?", r"ecb", r"uk", r"u\.k\.", r"brit\w+", r"german\w*",
                r"india\w*", r"turkey", r"turkish", r"türkiye\w*", r"tcmb", r"korea\w*", r"canad\w+", r"australia\w*", r"brazil\w*",
                r"çin\w*", r"boj", r"boe", r"bank of (?:england|japan|canada|korea|israel|russia|mexico)", r"rba", r"rbnz", r"pboc",
                r"snb", r"riksbank", r"norges", r"norw\w+", r"swed\w+", r"swiss", r"switzerland", r"denmark", r"danish", r"franc\w+",
                r"french", r"ital\w+", r"spain", r"spanish", r"poland", r"polish", r"russia\w*", r"mexic\w+", r"argentin\w+",
                r"indonesia\w*", r"new zealand", r"south africa\w*", r"nigeria\w*", r"egypt\w*", r"israel\w*", r"hong kong",
                r"singapore", r"thai\w*", r"vietnam\w*", r"philippin\w+", r"malaysia\w*", r"pakistan\w*", r"saudi", r"hungar\w+",
                r"czech", r"romania\w*", r"chile\w*", r"colombia\w*", r"peru\w*", r"ireland", r"irish", r"dutch", r"netherlands",
                r"belgi\w+", r"austria\w*", r"portug\w+", r"gree(?:ce|k)", r"almanya\w*", r"japonya\w*", r"ingiltere\w*",
                r"avrupa\w*", r"rusya\w*", r"hindistan\w*", r"amb", r"lagarde")
# Olayın kendisi değil, yorumu ya da ön izlemesi olan başlıklar
PREVIEW = words(r"ahead of", r"await\w*", r"braces?", r"bracing", r"markets wrap", r"öncesi\w*", r"odaklan\w+",
                r"bekleniyor", r"bekliyor", r"week ahead", r"what to watch", r"what to expect", r"here.s what", r"what (?:do )?we know", r"explained",
                r"preview", r"things to know", r"should you", r"opinion", r"analysis", r"haftaya bakış", r"neler bekleniyor")
REACT_HOURS = 3


def keywords(title):
    return {w for w in re.findall(r"[\w$]+", title.lower()) if len(w) > 2 and w not in STOP}


def clusters(items):
    """Aynı olayı anlatan haberleri gruplar (36 saat içinde, ortak anahtar kelimelere göre)."""
    keys = [keywords(i["title"]) for i in items]
    parent = list(range(len(items)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            if abs(items[a]["ts"] - items[b]["ts"]) > 36 * 3600 or not keys[a] or not keys[b]:
                continue
            common = len(keys[a] & keys[b])
            if common >= 4 and common / min(len(keys[a]), len(keys[b])) >= 0.6:
                parent[find(a)] = find(b)
    groups = defaultdict(list)
    for idx, item in enumerate(items):
        groups[find(idx)].append(item)
    return list(groups.values())


def fetch_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read(5 * 1024 * 1024).decode("utf-8"))


class Prices:
    """Tepki ölçümü için fiyat serileri: kripto Binance'ten, hisse/endeks markets.json'dan."""

    def __init__(self, markets_path):
        self.cache = {}
        try:
            with open(markets_path, encoding="utf-8") as fh:
                self.markets = json.load(fh).get("symbols", {})
        except Exception:
            self.markets = {}

    def series(self, key):
        if key not in self.cache:
            try:
                if key in self.markets:
                    self.cache[key] = [(b[0], b[4]) for b in self.markets[key]["bars"]]
                else:
                    self.cache[key] = [(int(r[0] / 1000), float(r[4])) for r in fetch_json(BINANCE % key)]
            except Exception:
                self.cache[key] = []
        return self.cache[key]

    def candles(self, key, interval="1h", limit=1000):
        """Kripto için mum listesi: (zaman, açılış, yüksek, düşük, kapanış). Alınamazsa boş."""
        ckey = key + ":" + interval
        if ckey not in self.cache:
            try:
                url = BINANCE.replace("interval=5m&limit=1000", "interval=%s&limit=%d" % (interval, limit)) % key
                self.cache[ckey] = [(int(r[0] / 1000), float(r[1]), float(r[2]), float(r[3]), float(r[4])) for r in fetch_json(url)]
            except Exception:
                self.cache[ckey] = []
        return self.cache[ckey]

    def move(self, key, ts):
        """Olaydan sonraki ilk REACT_HOURS saatteki yüzde değişim: (yüzde, pencere doldu mu) ya da None.

        Piyasa kapalıyken gelen haberde ölçüm, açılıştan sonraki ilk mumlarla yapılır.
        """
        data = self.series(key)
        base = None
        for idx, (t, _) in enumerate(data):
            if t > ts:
                break
            base = idx
        if base is None or len(data) < 3:
            return None
        step = min(data[i + 1][0] - data[i][0] for i in range(len(data) - 1)) or 300
        span = max(1, int(REACT_HOURS * 3600 / step))
        end = min(base + span, len(data) - 1)
        if end == base:
            return None
        return round((data[end][1] / data[base][1] - 1) * 100, 2), end - base >= span


def analyze(items, markets_path):
    """Haberlere conf ve score ekler; büyük olayların listesini döndürür."""
    prices = Prices(markets_path)
    events = []
    for group in clusters(items):
        group.sort(key=lambda i: i["ts"])
        first_ts = group[0]["ts"]
        sources = []
        for item in group:
            name = item.get("outlet") or item["source"]
            if name not in sources:
                sources.append(name)
        tier_a = [i for i in group if i.get("tier") == "A"]
        lead = (tier_a or group)[0]
        tags = sorted({t for i in group for t in i["tags"]})
        titles = [i["title"] for i in group]

        best, best_hits = None, 0
        for play in PLAYBOOK:
            hits = sum(1 for t in titles if play["rx"].search(t))
            if hits > best_hits:
                best, best_hits = play, hits
        if best and best["id"] in OPPOSITES:
            other, generic = OPPOSITES[best["id"]]
            if any(PLAY[other]["rx"].search(t) for t in titles):
                best = PLAY[generic]
        foreign = bool(best and best["id"] in US_ONLY and any(FOREIGN.search(t) for t in titles))
        preview = bool(PREVIEW.search(lead["title"]))

        # Varlıklar: başlıkların en az yarısında geçenler, en çok geçen önce
        need = max(1, (len(group) + 1) // 2)
        counts = {}
        for coin in COIN_TAGS:
            counts[coin] = sum(1 for i in group if coin in i["tags"])
        for name, rx in COMPANY_RE.items():
            counts[name] = sum(1 for t in titles if rx.search(t))
        assets = sorted([k for k, v in counts.items() if v >= need], key=lambda k: -counts[k])
        coins = [x for x in assets if x in COIN_TAGS]
        companies = [x for x in assets if x in COMPANIES]
        tickers = [COMPANIES[n][1] for n in companies if COMPANIES[n][1]]
        is_crypto = bool(coins) or lead["cat"] == "kripto"
        is_tech = bool(tickers) or lead["cat"] == "teknoloji"
        wide = bool(best and best["wide"] and not foreign)

        pts_type = best["w"] if best else 8
        if foreign or preview:
            pts_type = pts_type // 2
        pts_conf = min(25, {1: 0, 2: 10, 3: 16, 4: 20}.get(len(sources), 24) + (4 if tier_a else 0))
        early = {i.get("outlet") or i["source"] for i in group if i["ts"] - first_ts <= 3600}
        pts_speed = 10 if len(early) >= 3 else 5 if len(early) == 2 else 0
        pts_scope = 10 if wide else 8 if "BTC" in coins else 6 if len(assets) >= 2 else 3

        # Tepki yalnızca olayla doğrudan ilgili göstergede ölçülür
        if wide:
            watch = ["BTC", "NDX"]
        elif coins or tickers:
            watch = (coins + tickers)[:2]
        elif is_crypto:
            watch = ["BTC"]
        elif is_tech:
            watch = ["NDX"]
        else:
            watch = []
        react = []
        if best and pts_type + pts_conf + pts_speed + pts_scope >= 30:  # fiyat sorgusunu yalnızca aday olaylar için yap
            for key in watch:
                got = prices.move(key, first_ts)
                if got is not None:
                    react.append({"k": "Nasdaq" if key == "NDX" else key, "pct": got[0], "full": got[1]})
        biggest = max([abs(r["pct"]) for r in react] or [0])
        pts_react = 15 if biggest >= 3 else 11 if biggest >= 2 else 7 if biggest >= 1 else 3 if biggest >= 0.5 else 0

        score = min(100, pts_type + pts_conf + pts_speed + pts_scope + pts_react)
        for item in group:
            item["conf"] = len(sources)
            item["score"] = score

        if not best:
            continue
        label = ", ".join(assets[:2]) or "İlgili varlık"
        up, down, why = best["up"], best["down"], best["why"]
        if foreign:
            up, down, why = [], [], "ABD dışı veri; küresel piyasaya etkisi genelde sınırlı kalır."
        events.append({
            "id": lead["id"], "score": score, "ts": first_ts, "title": lead["title"], "url": lead["url"],
            "source": lead["source"], "n": len(sources), "sources": sources[:6], "type": best["id"], "type_label": best["label"],
            "up": [x.replace(V, label) for x in up], "down": [x.replace(V, label) for x in down],
            "why": why, "react": react, "preview": preview, "foreign": foreign, "tier": lead.get("tier", "B"), "lang": lead.get("lang", ""),
            "official": any(i.get("official") for i in group), "cat": "makro" if wide else lead["cat"], "tags": tags, "assets": assets,
            "parts": {"tur": pts_type, "teyit": pts_conf, "hiz": pts_speed, "kapsam": pts_scope, "tepki": pts_react},
        })
    events.sort(key=lambda e: (e["score"], e["ts"]), reverse=True)
    # Aynı olayın ikinci kümesini ele: aynı tür ve aynı baş varlık
    seen, unique = set(), []
    for e in events:
        key = (e["type"], e["assets"][0] if e["assets"] else e["id"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(e)
    return unique
