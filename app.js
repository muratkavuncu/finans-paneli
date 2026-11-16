(() => {
  'use strict';

  // ---------- Sürüm uyumu ----------
  // Yayında BUILD ve sayfadaki fp-build etiketi aynı commit kimliğiyle damgalanır. Telefon önbelleğinden eski sayfa ile
  // yeni kod (ya da tersi) gelirse ikisi tutmaz: önbelleği atlayarak dosyaları yeniden indirip bir kez yeniler.
  const BUILD = 'dev';
  (function checkBuild() {
    const m = document.querySelector('meta[name="fp-build"]');
    const want = m && m.content;
    if (BUILD === 'dev' || !want || want === BUILD) return;
    try {
      if (sessionStorage.getItem('fp.rl') === want + BUILD) return; // aynı uyumsuzlukta ikinci kez yenileme
      sessionStorage.setItem('fp.rl', want + BUILD);
    } catch (err) { return; }
    Promise.all(['./', 'app.js', 'style.css'].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)))
      .then(() => location.reload());
  })();

  // ---------- Ayarlar ----------
  const REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
  const WS_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

  const COINS = [
    { s: 'RENDER', name: 'Render', main: true, ai: true },
    { s: 'BTC', name: 'Bitcoin', main: true },
    { s: 'ETH', name: 'Ethereum', main: true },
    { s: 'SOL', name: 'Solana', main: true },
    { s: 'BNB', name: 'BNB' },
    { s: 'XRP', name: 'XRP' },
    { s: 'DOGE', name: 'Dogecoin' },
    { s: 'ADA', name: 'Cardano' },
    { s: 'AVAX', name: 'Avalanche' },
    { s: 'LINK', name: 'Chainlink' },
    { s: 'TAO', name: 'Bittensor', ai: true },
    { s: 'FET', name: 'Fetch.ai', ai: true },
    { s: 'NEAR', name: 'NEAR', ai: true },
    { s: 'WLD', name: 'Worldcoin', ai: true },
    { s: 'SUI', name: 'Sui' },
  ];
  const INTERVALS = [
    { id: '1m', label: '1dk' },
    { id: '15m', label: '15dk' },
    { id: '1h', label: '1sa' },
    { id: '4h', label: '4sa' },
    { id: '1d', label: '1G' },
  ];
  const COIN_NAMES = { btc: 'Bitcoin', eth: 'Ethereum', usdt: 'Tether', usdc: 'USD Coin', bnb: 'BNB', xrp: 'XRP', sol: 'Solana', doge: 'Dogecoin', steth: 'Lido stETH', ada: 'Cardano', trx: 'TRON' };

  const $ = (id) => document.getElementById(id);
  const bySym = Object.fromEntries(COINS.map((c) => [c.s, c]));
  const state = {}; // sembol -> { price, pct, high, low, qvol }
  COINS.forEach((c) => { state[c.s] = {}; });
  const els = {};   // sembol -> { card parçaları, tile parçaları }

  function load(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* önemli değil */ }
  }

  let selected = load('fp.symbol', 'RENDER');
  if (!bySym[selected]) selected = 'BTC';
  let interval = load('fp.interval', '1h');
  // Grafiğin karşılığı: USDT (dolar fiyatı) ya da BTC (varlığın BTC'ye göre performansı)
  let quote = load('fp.quote', 'USDT') === 'BTC' ? 'BTC' : 'USDT';
  const q = () => (quote === 'BTC' && selected !== 'BTC' ? 'BTC' : 'USDT');
  // BTC cinsinden fiyatlar çok küçük olduğu için grafik 10'un katıyla çarpılır (çoğu varlıkta satoshi: 1 BTC = 100 milyon sat)
  let qPow = 8;
  const fmtBtc = (p) => NF[Math.max(0, 8 - qPow)].format(p) + (qPow === 8 ? ' sat' : '');
  const qNote = () => (qPow === 8 ? 'satoshi' : '×' + NF[0].format(Math.pow(10, qPow))) + ' · hesaplanan oran';
  if (!INTERVALS.some((i) => i.id === interval)) interval = '1h';

  // Hisseler: veri GitHub zamanlayıcısının hazırladığı data/markets.json dosyasından gelir
  const STOCKS = [
    { s: 'NVDA', name: 'Nvidia', main: true },
    { s: 'MSFT', name: 'Microsoft', main: true },
    { s: 'AAPL', name: 'Apple', main: true },
    { s: 'TSLA', name: 'Tesla', main: true },
    { s: 'GOOGL', name: 'Alphabet' },
    { s: 'AMZN', name: 'Amazon' },
    { s: 'META', name: 'Meta' },
    { s: 'AMD', name: 'AMD' },
    { s: 'TSM', name: 'TSMC' },
  ];
  const STOCK_INTERVALS = [{ id: '30m', label: '30dk' }, { id: '1d', label: '1G' }];
  const stockBy = Object.fromEntries(STOCKS.map((c) => [c.s, c]));
  const sEls = {};
  let markets = null, marketsStamp = 0;
  let tab = load('fp.tab', 'kripto');
  if (!['kripto', 'tek'].includes(tab)) tab = 'kripto';
  let stock = load('fp.stock', 'NVDA');
  if (!stockBy[stock]) stock = 'NVDA';
  let stockInterval = load('fp.sint', '30m') === '1d' ? '1d' : '30m';

  // ---------- Biçimlendirme ----------
  const nf = (min, max) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const NF = { 0: nf(0, 0), 1: nf(1, 1), 2: nf(2, 2), 3: nf(3, 3), 4: nf(4, 4), 5: nf(5, 5), 6: nf(6, 6) };

  function decimalsFor(p) {
    if (p >= 100) return 2;
    if (p >= 1) return 3;
    if (p >= 0.01) return 4;
    return 6;
  }
  function fmtPrice(p) {
    if (!isFinite(p)) return '—';
    return '$' + NF[decimalsFor(p)].format(p);
  }
  function fmtPct(p) {
    if (!isFinite(p)) return '—';
    return (p > 0 ? '+' : '') + NF[2].format(p) + '%';
  }
  function fmtBig(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1e12) return '$' + NF[2].format(n / 1e12) + ' Tn';
    if (n >= 1e9) return '$' + NF[1].format(n / 1e9) + ' Mr';
    if (n >= 1e6) return '$' + NF[1].format(n / 1e6) + ' Mn';
    return '$' + NF[0].format(n);
  }
  const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  function setSigned(el, base, v) {
    el.className = base + (signClass(v) ? ' ' + signClass(v) : '');
  }

  // ---------- Arayüz kurulumu ----------
  function buildUI() {
    const watch = $('watch');
    const heat = $('heat');
    COINS.forEach((c) => {
      const e = (els[c.s] = {});
      if (c.main) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'card';
        b.innerHTML =
          '<div class="card-top"><span><span class="sym">' + c.s + '</span>' +
          (c.ai ? '<span class="tag">AI</span>' : '') +
          '<span class="name">' + c.name + '</span></span><span class="chip">—</span></div>' +
          '<div class="price">—</div>' +
          '<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"></svg>';
        b.addEventListener('click', () => selectSymbol(c.s));
        watch.appendChild(b);
        e.card = b;
        e.cardPrice = b.querySelector('.price');
        e.cardPct = b.querySelector('.chip');
        e.spark = b.querySelector('.spark');
      }
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tile';
      t.title = c.name;
      t.innerHTML = '<b>' + c.s + (c.ai ? ' <span class="tag">AI</span>' : '') + '</b><span>—</span><small>—</small>';
      t.addEventListener('click', () => {
        selectSymbol(c.s);
        document.querySelector('.chart-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      heat.appendChild(t);
      e.tile = t;
      e.tilePct = t.querySelector(':scope > span');
      e.tilePrice = t.querySelector('small');
    });

    const watchTek = $('watch-tek');
    const heatTek = $('heat-tek');
    STOCKS.forEach((c) => {
      const e = (sEls[c.s] = {});
      if (c.main) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'card';
        b.innerHTML =
          '<div class="card-top"><span><span class="sym">' + c.s + '</span><span class="name">' + c.name +
          '</span></span><span class="chip">—</span></div><div class="price">—</div>' +
          '<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"></svg>';
        b.addEventListener('click', () => selectStock(c.s));
        watchTek.appendChild(b);
        e.card = b;
        e.cardPrice = b.querySelector('.price');
        e.cardPct = b.querySelector('.chip');
        e.spark = b.querySelector('.spark');
      }
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tile';
      t.title = c.name;
      t.innerHTML = '<b>' + c.s + '</b><span>—</span><small>—</small>';
      t.addEventListener('click', () => {
        selectStock(c.s);
        document.querySelector('.chart-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      heatTek.appendChild(t);
      e.tile = t;
      e.tilePct = t.querySelector(':scope > span');
      e.tilePrice = t.querySelector('small');
    });

    document.querySelectorAll('#maintabs button').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.id === tab) return;
        tab = b.dataset.id;
        save('fp.tab', tab);
        applyTab();
      });
    });
  }

  function buildIntervals() {
    const box = $('intervals');
    box.textContent = '';
    (tab === 'tek' ? STOCK_INTERVALS : INTERVALS).forEach((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.textContent = i.label;
      b.dataset.id = i.id;
      b.addEventListener('click', () => (tab === 'tek' ? selectStockInterval(i.id) : selectInterval(i.id)));
      box.appendChild(b);
    });
  }

  function markSelection() {
    COINS.forEach((c) => {
      if (els[c.s].card) els[c.s].card.setAttribute('aria-pressed', String(c.s === selected));
    });
    STOCKS.forEach((c) => {
      if (sEls[c.s].card) sEls[c.s].card.setAttribute('aria-pressed', String(c.s === stock));
    });
    const tek = tab === 'tek';
    document.querySelectorAll('#intervals button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.id === (tek ? stockInterval : interval)));
    });
    $('chart-name').textContent = tek ? stockBy[stock].name : bySym[selected].name;
    $('chart-pair').textContent = tek ? stock + ' · ABD borsası' : selected + '/' + q() + (q() === 'BTC' ? ' · ' + qNote() : '');
    const tq = $('tg-q');
    tq.hidden = tek || selected === 'BTC';
    tq.setAttribute('aria-pressed', String(quote === 'BTC'));
    $('chart-l1').textContent = tek ? 'Seans en yüksek' : '24s en yüksek';
    $('chart-l2').textContent = tek ? 'Seans en düşük' : '24s en düşük';
    $('chart-l3').textContent = tek ? 'Seans hacmi (adet)' : '24s hacim';
  }

  // Sekme değişince görünür bölümleri, grafiği ve haber filtrelerini eşitle
  function applyTab() {
    applyPage();
    document.querySelectorAll('#maintabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.id === tab));
    });
    buildIntervals();
    markSelection();
    if (tab === 'kripto') { state[selected].shown = null; markDirty(selected); } else renderStocks();
    buildFilters();
    renderNews();
    renderAi();
    loadChart();
  }

  // ---------- Çizim (kare başına en fazla bir kez) ----------
  const dirty = new Set();
  let frame = 0;
  function markDirty(sym) {
    dirty.add(sym);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function flush() {
    frame = 0;
    dirty.forEach(renderCoin);
    dirty.clear();
  }

  function flash(el, dir) {
    if (!dir) return;
    el.classList.remove('flash-up', 'flash-down');
    el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 350);
  }

  function renderCoin(sym) {
    const st = state[sym];
    const e = els[sym];
    if (!e || st.price == null) return;
    const dir = st.shown == null ? 0 : Math.sign(st.price - st.shown);
    st.shown = st.price;
    const priceText = fmtPrice(st.price);

    if (e.card) {
      e.cardPrice.textContent = priceText;
      flash(e.cardPrice, dir);
      e.cardPct.textContent = fmtPct(st.pct);
      setSigned(e.cardPct, 'chip', st.pct);
    }
    e.tilePct.textContent = fmtPct(st.pct);
    e.tilePrice.textContent = priceText;
    if (isFinite(st.pct)) {
      const mix = Math.min(70, 12 + (Math.abs(st.pct) / 8) * 58);
      e.tile.style.setProperty('--heat', st.pct >= 0 ? 'var(--up)' : 'var(--down)');
      e.tile.style.setProperty('--mix', mix.toFixed(0) + '%');
    }
    if (sym === 'ETH' || sym === 'BTC') {
      const ratio = state.ETH.price / state.BTC.price;
      if (isFinite(ratio)) $('g-ethbtc').textContent = NF[5].format(ratio);
    }
    if (sym === 'RENDER' || sym === 'BTC') renderOzet();
    if (sym === 'RENDER') renderOzRange();
    if (sym === selected && tab === 'kripto') {
      const big = $('chart-price');
      big.textContent = priceText;
      flash(big, dir);
      $('chart-pct').textContent = fmtPct(st.pct);
      setSigned($('chart-pct'), 'chip', st.pct);
      $('chart-high').textContent = fmtPrice(st.high);
      $('chart-low').textContent = fmtPrice(st.low);
      $('chart-vol').textContent = fmtBig(st.qvol);
    }
  }

  setInterval(() => {
    if (tab === 'tek') {
      const m = markets && markets.symbols[stock];
      if (m) document.title = stock + ' $' + NF[2].format(m.price) + ' · Finans Paneli';
      return;
    }
    const st = state[selected];
    if (st.price != null) document.title = selected + ' ' + fmtPrice(st.price) + ' · Finans Paneli';
  }, 1000);

  // ---------- Binance REST ----------
  async function binance(path) {
    let lastErr;
    for (const host of REST_HOSTS) {
      try {
        const r = await fetch(host + path);
        if (r.ok) return await r.json();
        lastErr = new Error('HTTP ' + r.status);
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }

  function applyTicker(sym, t) {
    const st = state[sym];
    st.price = +t.price;
    st.pct = +t.pct;
    st.high = +t.high;
    st.low = +t.low;
    st.qvol = +t.qvol;
    markDirty(sym);
  }

  function renderTry(price, pct) {
    usdtTry = price;
    $('g-try').textContent = '₺' + NF[2].format(price);
    const el = $('g-try-chg');
    el.textContent = '24s ' + fmtPct(pct);
    setSigned(el, 'sub', pct);
  }

  async function loadSnapshot() {
    const symbols = COINS.map((c) => c.s + 'USDT').concat('USDTTRY');
    const rows = await binance('/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symbols)));
    rows.forEach((r) => {
      if (r.symbol === 'USDTTRY') { renderTry(+r.lastPrice, +r.priceChangePercent); return; }
      const sym = r.symbol.slice(0, -4);
      if (state[sym]) applyTicker(sym, { price: r.lastPrice, pct: r.priceChangePercent, high: r.highPrice, low: r.lowPrice, qvol: r.quoteVolume });
    });
  }

  async function loadSparks() {
    await Promise.all(COINS.filter((c) => c.main).map(async (c) => {
      try {
        const rows = await binance('/api/v3/klines?symbol=' + c.s + 'USDT&interval=1h&limit=24');
        drawSpark(els[c.s].spark, rows.map((r) => +r[4]));
      } catch (err) { /* kıvılcım grafiği isteğe bağlı */ }
    }));
  }

  // mode: true = renksiz, 1 / -1 = yönü dışarıdan ver, boş = ilk ve son değere göre
  function drawSpark(svg, values, mode) {
    const neutral = mode === true;
    if (values.length < 2) return;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 31 - ((v - min) / span) * 28]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    const up = mode === 1 || mode === -1 ? mode === 1 : values[values.length - 1] >= values[0];
    const color = neutral ? 'var(--muted)' : up ? 'var(--up)' : 'var(--down)';
    const soft = neutral ? 'var(--line)' : up ? 'var(--up-soft)' : 'var(--down-soft)';
    svg.innerHTML =
      '<path d="' + line + ' L100 34 L0 34 Z" fill="' + soft + '" opacity=".45"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';
  }

  // ---------- Grafik ----------
  const tzShift = -new Date().getTimezoneOffset() * 60;
  let chart, candles, volume, chartToken = 0, haveData = false, chartMul = 1;
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function initChart() {
    if (!window.LightweightCharts) {
      $('chart-msg').textContent = 'Grafik kütüphanesi yüklenemedi. Sayfayı yenilemeyi dene.';
      return;
    }
    chart = LightweightCharts.createChart($('chart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, attributionLogo: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: { locale: 'tr-TR' },
    });
    candles = chart.addCandlestickSeries({ borderVisible: false });
    volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
    maSeries = MA_DEFS.map(() => chart.addLineSeries({
      lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    }));
    initLayers();
    themeChart();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeChart(); loadChart(); });
  }

  function themeChart() {
    const up = cssVar('--up');
    const down = cssVar('--down');
    const line = cssVar('--line');
    chart.applyOptions({
      layout: { textColor: cssVar('--muted'), fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif' },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
    });
    candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
    maSeries.forEach((s, i) => s.applyOptions({ color: cssVar(MA_DEFS[i].v) }));
    levelKey = '';
  }

  const toCandle = (t, o, h, l, c) => ({ time: t / 1000 + tzShift, open: +o, high: +h, low: +l, close: +c });
  const toVolume = (t, o, c, v) => ({ time: t / 1000 + tzShift, value: +v, color: +c >= +o ? cssVar('--up-soft') : cssVar('--down-soft') });

  // 30 dakikalık mumları günlük mumlara toplar
  function dailyBars(rows) {
    const out = [];
    let day = null, cur = null;
    rows.forEach((r) => {
      const d = Math.floor(r[0] / 86400);
      if (d !== day) { cur = [d * 86400, r[1], r[2], r[3], r[4], r[5]]; out.push(cur); day = d; return; }
      cur[2] = Math.max(cur[2], r[2]);
      cur[3] = Math.min(cur[3], r[3]);
      cur[4] = r[4];
      cur[5] += r[5];
    });
    return out;
  }

  function loadStockChart() {
    ++chartToken;
    haveData = false;
    const msg = $('chart-msg');
    const m = markets && markets.symbols[stock];
    if (!m) {
      candles.setData([]);
      volume.setData([]);
      setTaBars([]);
      msg.hidden = false;
      msg.textContent = markets ? 'Bu hisse için veri alınamadı.' : 'Hisse verisi yükleniyor…';
      return;
    }
    let rows = m.bars;
    if (stockInterval === '1d') {
      // Geçmiş günler 1 yıllık günlük dosyadan, bugünün mumu 30 dakikalık veriden gelir
      rows = dailyBars(m.bars);
      const hist = daily && daily.symbols && daily.symbols[stock];
      if (hist && hist.length && rows.length) {
        const today = rows[rows.length - 1];
        const byDay = new Map();
        hist.forEach((r) => {
          const d = Math.floor(r[0] / 86400) * 86400;
          if (d < today[0]) byDay.set(d, [d, r[1], r[2], r[3], r[4], r[5]]);
        });
        rows = Array.from(byDay.values()).concat([today]);
      } else if (!daily) loadDaily();
    }
    candles.applyOptions({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    const list = rows.map((r) => toCandle(r[0] * 1000, r[1], r[2], r[3], r[4]));
    candles.setData(list);
    volume.setData(rows.map((r) => toVolume(r[0] * 1000, r[1], r[4], r[5])));
    setTaBars(list);
    const bars = $('chart').clientWidth < 520 ? 60 : 130;
    if (rows.length <= bars) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleLogicalRange({ from: rows.length - bars, to: rows.length + 2 });
    msg.hidden = true;
  }

  // SEMBOL/BTC oranı iki dolar paritesinden hesaplanır (Binance'te bazı BTC pariteleri artık işlem görmüyor).
  // Mumun yüksek/düşük değeri açılış ve kapanıştan türetilir; fitiller bu yüzden gerçekten kısadır.
  function ratioRows(a, b) {
    const byTime = new Map(b.map((r) => [r[0], r]));
    const out = [];
    a.forEach((r) => {
      const x = byTime.get(r[0]);
      if (!x) return;
      const o = r[1] / x[1], c = r[4] / x[4];
      out.push([r[0], o, Math.max(o, c), Math.min(o, c), c, r[5]]);
    });
    return out;
  }
  async function klinesFor(sym, quote, iv, extra) {
    const a = await binance('/api/v3/klines?symbol=' + sym + 'USDT&interval=' + iv + extra);
    if (quote !== 'BTC') return a;
    return ratioRows(a, await binance('/api/v3/klines?symbol=BTCUSDT&interval=' + iv + extra));
  }

  async function loadChart() {
    if (!chart) return;
    if (tab === 'tek') { loadStockChart(); return; }
    const token = ++chartToken;
    const sym = selected;
    const msg = $('chart-msg');
    haveData = false;
    try {
      const rows = await klinesFor(sym, q(), interval, '&limit=500');
      if (token !== chartToken) return;
      const last = +rows[rows.length - 1][4];
      const btcQ = q() === 'BTC';
      if (btcQ) qPow = Math.max(0, Math.min(8, 3 - Math.floor(Math.log10(last))));
      chartMul = btcQ ? Math.pow(10, qPow) : 1;
      const d = btcQ ? 8 - qPow : decimalsFor(last);
      candles.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / Math.pow(10, d) } });
      if (btcQ) markSelection();
      const m = chartMul;
      const list = rows.map((r) => toCandle(r[0], r[1] * m, r[2] * m, r[3] * m, r[4] * m));
      candles.setData(list);
      volume.setData(rows.map((r) => toVolume(r[0], r[1], r[4], r[5])));
      setTaBars(list);
      const bars = $('chart').clientWidth < 520 ? 60 : 130;
      chart.timeScale().setVisibleLogicalRange({ from: rows.length - bars, to: rows.length + 2 });
      haveData = true;
      msg.hidden = true;
    } catch (err) {
      if (token !== chartToken) return;
      msg.hidden = false;
      msg.textContent = 'Grafik verisi alınamadı. Bağlantı gelince yeniden denenecek.';
    }
  }

  function onKline(d) {
    const k = d.k;
    if (tab !== 'kripto' || !haveData || d.s !== selected + 'USDT' || k.i !== interval) return;
    const m = chartMul;
    let c;
    if (q() === 'BTC') {
      // Canlı oran: iki canlı dolar fiyatının bölümü
      const r = state[selected].price / state.BTC.price * m;
      if (!isFinite(r) || r <= 0) return;
      const t = k.t / 1000 + tzShift, last = taBars[taBars.length - 1];
      if (last && t < last.time) return;
      c = last && last.time === t
        ? { time: t, open: last.open, high: Math.max(last.high, r), low: Math.min(last.low, r), close: r }
        : { time: t, open: r, high: r, low: r, close: r };
    } else c = toCandle(k.t, k.o * m, k.h * m, k.l * m, k.c * m);
    candles.update(c);
    volume.update(toVolume(k.t, k.o, k.c, k.v));
    taUpdate(c);
  }

  // ---------- Teknik analiz ----------
  // Hepsi grafikteki mumlardan tarayıcıda hesaplanır; yeni veri kaynağı yoktur.
  const MA_DEFS = [{ n: 20, v: '--ma1' }, { n: 50, v: '--ma2' }, { n: 200, v: '--ma3' }];
  let taBars = [], maSeries = [], levelLines = [], levelKey = '', taTimer = 0;
  let showMA = load('fp.ma', '1') !== '0';
  let showLevels = load('fp.lv', '1') !== '0';

  function emaArr(vals, n) {
    const out = new Array(vals.length).fill(null);
    if (vals.length < n) return out;
    let e = 0;
    for (let i = 0; i < n; i++) e += vals[i];
    e /= n;
    out[n - 1] = e;
    const k = 2 / (n + 1);
    for (let i = n; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }

  function rsiArr(vals, n) {
    const out = new Array(vals.length).fill(null);
    if (vals.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  // MACD histogramı (12, 26, 9); yeterli mum yoksa boş dizi
  function macdHist(vals) {
    const fast = emaArr(vals, 12), slow = emaArr(vals, 26);
    const line = [];
    for (let i = 0; i < vals.length; i++) if (slow[i] != null) line.push(fast[i] - slow[i]);
    const sig = emaArr(line, 9);
    const hist = [];
    for (let i = 0; i < line.length; i++) if (sig[i] != null) hist.push(line[i] - sig[i]);
    return hist;
  }

  // Ortalama gerçek aralık: mum başına tipik hareket
  function atrArr(bars, n) {
    const tr = [];
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], pc = bars[i - 1].close;
      tr.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
    }
    const out = [];
    for (let i = n; i <= tr.length; i++) {
      let s = 0;
      for (let j = i - n; j < i; j++) s += tr[j];
      out.push(s / n);
    }
    return out;
  }

  // Destek / direnç: fiyatın döndüğü tepe ve dipler, birbirine yakın olanlar tek seviyede toplanır
  function findLevels(bars, atr) {
    const n = bars.length;
    const w = n >= 120 ? 4 : 2;
    const pivots = [];
    for (let i = Math.max(w, n - 300); i < n - w; i++) {
      let hi = true, lo = true;
      for (let j = i - w; j <= i + w; j++) {
        if (bars[j].high > bars[i].high) hi = false;
        if (bars[j].low < bars[i].low) lo = false;
      }
      if (hi) pivots.push(bars[i].high);
      if (lo) pivots.push(bars[i].low);
    }
    pivots.sort((a, b) => a - b);
    const price = bars[n - 1].close;
    const tol = atr ? atr * 0.6 : price * 0.003;
    const out = [];
    pivots.forEach((p) => {
      const last = out[out.length - 1];
      if (last && p - last.p <= tol) { last.p = (last.p * last.n + p) / (last.n + 1); last.n++; } else out.push({ p, n: 1 });
    });
    const pick = (list) => {
      const strong = list.filter((x) => x.n >= 2);
      return (strong.length ? strong : list).slice(0, 2);
    };
    return {
      res: pick(out.filter((x) => x.p > price * 1.0015)),
      sup: pick(out.filter((x) => x.p < price * 0.9985).reverse()),
    };
  }

  function computeTA(bars) {
    const closes = bars.map((b) => b.close);
    const n = closes.length;
    const price = closes[n - 1];
    const ema = MA_DEFS.map((d) => emaArr(closes, d.n));
    const rsi = rsiArr(closes, 14);
    const hist = macdHist(closes);
    const atrs = atrArr(bars, 14);
    const atr = atrs.length ? atrs[atrs.length - 1] : null;
    let cross = null;
    for (let i = hist.length - 1; i > 0; i--) {
      if ((hist[i] > 0) !== (hist[i - 1] > 0)) { cross = hist.length - 1 - i; break; }
    }
    const base = atrs.slice(-100).sort((a, b) => a - b);
    return {
      price, ema, atr,
      e20: ema[0][n - 1], e50: ema[1][n - 1], e200: ema[2][n - 1],
      rsi: rsi[n - 1],
      hist: hist.length ? hist[hist.length - 1] : null,
      histPrev: hist.length > 1 ? hist[hist.length - 2] : null,
      cross,
      atrMid: base.length >= 30 ? base[Math.floor(base.length / 2)] : null,
      levels: n >= 20 ? findLevels(bars, atr) : { res: [], sup: [] },
    };
  }

  function setTaBars(list) {
    taBars = list;
    clearTimeout(taTimer);
    taTimer = 0;
    refreshTA();
    // Veri değişince fiyat eksenini yeniden otomatik ölçeğe al: elle kaydırılmış eksen eski aralıkta kalmasın
    if (chart) candles.priceScale().applyOptions({ autoScale: true });
  }
  function taUpdate(c) {
    const last = taBars[taBars.length - 1];
    if (!last) return;
    if (last.time === c.time) taBars[taBars.length - 1] = c;
    else if (c.time > last.time) taBars.push(c);
    if (!taTimer) taTimer = setTimeout(() => { taTimer = 0; refreshTA(); }, 2500);
  }

  function taCard(id, value, verdict, tone) {
    $(id).textContent = value;
    setVerdict(id + '-v', verdict, tone);
  }

  function refreshTA() {
    if (!chart) return;
    const tek = tab === 'tek';
    const btcQ = !tek && q() === 'BTC';
    const fmt = (p) => (tek ? usd(p) : btcQ ? fmtBtc(p) : fmtPrice(p));
    const iv = (tek ? STOCK_INTERVALS : INTERVALS).find((i) => i.id === (tek ? stockInterval : interval));
    $('ta-sym').textContent = (tek ? stock : btcQ ? selected + '/BTC' : selected) + ' · ' + (iv ? iv.label : '');
    const pips = $('ta-pips');
    pips.textContent = '';

    if (taBars.length < 30) {
      maSeries.forEach((s) => s.setData([]));
      levelLines.forEach((l) => candles.removePriceLine(l));
      levelLines = [];
      levelKey = '';
      $('ta-label').textContent = taBars.length ? 'Bu zaman diliminde yeterli mum yok' + (tek ? ' (hisselerde 30dk seç)' : '') : '—';
      $('ta-label').className = '';
      ['ta-trend', 'ta-rsi', 'ta-macd', 'ta-sup', 'ta-res', 'ta-atr'].forEach((id) => taCard(id, '—', taBars.length ? 'veri yetersiz' : ' '));
      $('ta-rsi-dot').hidden = true;
      return;
    }
    const t = computeTA(taBars);

    // Grafik katmanları
    maSeries.forEach((s, i) => {
      const data = [];
      if (showMA) t.ema[i].forEach((v, k) => { if (v != null) data.push({ time: taBars[k].time, value: v }); });
      s.setData(data);
    });
    const want = showLevels ? t.levels.res.map((x) => ['Direnç', x.p]).concat(t.levels.sup.map((x) => ['Destek', x.p])) : [];
    const key = want.map((x) => x[0] + x[1].toPrecision(6)).join('|');
    if (key !== levelKey) {
      levelLines.forEach((l) => candles.removePriceLine(l));
      levelLines = want.map((x) => candles.createPriceLine({
        price: x[1], color: cssVar(x[0] === 'Direnç' ? '--down' : '--up'), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: x[0],
      }));
      levelKey = key;
    }

    // Kartlar
    const signals = [];
    if (t.e50 == null) {
      taCard('ta-trend', '—', 'veri yetersiz');
    } else {
      const dir = t.price > t.e20 && t.e20 > t.e50 ? 1 : t.price < t.e20 && t.e20 < t.e50 ? -1 : 0;
      signals.push(['Trend', dir]);
      const d20 = (t.price / t.e20 - 1) * 100;
      taCard('ta-trend', dir > 0 ? 'Yukarı' : dir < 0 ? 'Aşağı' : 'Kararsız',
        'fiyat EMA 20\'nin %' + NF[2].format(Math.abs(d20)) + (d20 >= 0 ? ' üstünde' : ' altında') + ' · EMA 20, EMA 50\'nin ' + (t.e20 >= t.e50 ? 'üstünde' : 'altında'),
        dir > 0 ? 'pos' : dir < 0 ? 'neg' : '');
    }

    const dot = $('ta-rsi-dot');
    if (t.rsi == null) {
      taCard('ta-rsi', '—', 'veri yetersiz');
      dot.hidden = true;
    } else {
      signals.push(['RSI', t.rsi >= 55 ? 1 : t.rsi <= 45 ? -1 : 0]);
      const v = t.rsi >= 70 ? ['aşırı alım bölgesi', 'warn'] : t.rsi <= 30 ? ['aşırı satım bölgesi', 'warn']
        : t.rsi >= 55 ? ['alıcılar güçlü', 'pos'] : t.rsi <= 45 ? ['satıcılar güçlü', 'neg'] : ['dengeli', ''];
      taCard('ta-rsi', NF[0].format(t.rsi), v[0], v[1]);
      dot.hidden = false;
      dot.style.left = Math.max(0, Math.min(100, t.rsi)).toFixed(1) + '%';
    }

    if (t.hist == null) {
      taCard('ta-macd', '—', 'veri yetersiz');
    } else {
      signals.push(['MACD', t.hist > 0 ? 1 : t.hist < 0 ? -1 : 0]);
      let note = t.histPrev == null ? '' : (t.hist > 0 ? 'yukarı' : 'aşağı') + ' ivme ' + (Math.abs(t.hist) >= Math.abs(t.histPrev) ? 'güçleniyor' : 'zayıflıyor');
      if (t.cross != null && t.cross <= 5) {
        note = (t.cross === 0 ? 'bu mumda ' : t.cross + ' mum önce ') + (t.hist > 0 ? 'yukarı kesti' : 'aşağı kesti');
      }
      taCard('ta-macd', t.hist > 0 ? 'Pozitif' : 'Negatif', note, t.hist > 0 ? 'pos' : 'neg');
    }
    if (t.e200 != null) signals.push(['EMA 200', t.price > t.e200 ? 1 : -1]);

    const level = (id, list, word) => {
      if (!list.length) { taCard(id, '—', 'yakın geçmişte ' + word + ' seviye yok'); return; }
      const x = list[0];
      const dist = (x.p / t.price - 1) * 100;
      taCard(id, fmt(x.p), '%' + NF[2].format(Math.abs(dist)) + (dist >= 0 ? ' yukarıda · ' : ' aşağıda · ') + (x.n >= 2 ? x.n + ' kez dönüş' : 'tek dönüş, zayıf'));
    };
    level('ta-sup', t.levels.sup, 'altta');
    level('ta-res', t.levels.res, 'üstte');

    if (t.atr == null) {
      taCard('ta-atr', '—', 'veri yetersiz');
    } else {
      const ratio = t.atrMid ? t.atr / t.atrMid : 1;
      const v = ratio >= 1.5 ? ['normalden hareketli', 'warn'] : ratio <= 0.7 ? ['normalden sakin', ''] : ['normal', ''];
      taCard('ta-atr', '%' + NF[2].format(t.atr / t.price * 100), 'mum başına ≈ ' + fmt(t.atr) + ' · ' + v[0], v[1]);
    }

    // Özet: kaç işaret yukarı, kaç işaret aşağı
    const up = signals.filter((s) => s[1] > 0).length;
    const dn = signals.filter((s) => s[1] < 0).length;
    const lab = $('ta-label');
    let text = up - dn >= 2 ? 'Yukarı ağırlıklı' : dn - up >= 2 ? 'Aşağı ağırlıklı' : 'Karışık';
    lab.className = up - dn >= 2 ? 'pos' : dn - up >= 2 ? 'neg' : '';
    if (t.rsi != null && t.rsi >= 70) text += ' · RSI aşırı alımda';
    if (t.rsi != null && t.rsi <= 30) text += ' · RSI aşırı satımda';
    lab.textContent = text;
    signals.forEach((s) => {
      const pip = el('span', 'ta-pip ' + (s[1] > 0 ? 'up' : s[1] < 0 ? 'dn' : 'flat'), (s[1] > 0 ? '▲ ' : s[1] < 0 ? '▼ ' : '• ') + s[0]);
      pips.appendChild(pip);
    });
  }

  function initLayers() {
    const bind = (id, get, set, key) => {
      const b = $(id);
      b.setAttribute('aria-pressed', String(get()));
      b.addEventListener('click', () => {
        set(!get());
        save(key, get() ? '1' : '0');
        b.setAttribute('aria-pressed', String(get()));
        $('ma-legend').hidden = !showMA;
        refreshTA();
      });
    };
    bind('tg-ma', () => showMA, (v) => { showMA = v; }, 'fp.ma');
    bind('tg-lv', () => showLevels, (v) => { showLevels = v; }, 'fp.lv');
    $('tg-q').addEventListener('click', () => {
      quote = quote === 'BTC' ? 'USDT' : 'BTC';
      save('fp.quote', quote);
      markSelection();
      swapKline();
      loadChart();
      btMark();
    });
    $('ma-legend').hidden = !showMA;
  }

  // ---------- Canlı akış ----------
  let ws = null, wsHost = 0, retry = 0, lastMsg = 0, reqId = 1, everOpen = false, reconnectTimer = 0;
  const klineStream = () => (selected + 'USDT').toLowerCase() + '@kline_' + interval;
  let activeKline = klineStream();

  function baseStreams() {
    const list = COINS.map((c) => c.s.toLowerCase() + 'usdt@ticker');
    COINS.filter((c) => c.main).forEach((c) => list.push(c.s.toLowerCase() + 'usdt@aggTrade'));
    list.push('usdttry@ticker');
    return list;
  }

  // Durum göstergesi iki şeyi birlikte izler: canlı fiyat bağlantısı ve 3 dakikalık veri zinciri.
  // Zincir verisi 6 dakikadan eskiyse sarı, 12 dakikadan eskiyse kırmızı olur.
  const DATA_LATE = 6 * 60, DATA_DEAD = 12 * 60;
  let wsState = 'connecting';
  const pageStart = Date.now();
  function setStatus(s) {
    wsState = s;
    refreshStatus();
  }
  function refreshStatus() {
    const age = news && news.updated ? Date.now() / 1000 - news.updated : null;
    const mins = age == null ? null : Math.floor(age / 60);
    let state = wsState, text, detail = '';
    if (wsState === 'down') {
      text = 'Fiyat bağlantısı koptu';
      detail = 'yeniden deneniyor';
    } else if (age == null && Date.now() - pageStart > 20000) {
      state = 'down';
      text = 'Veri alınamıyor';
      detail = 'haber ve hisse verisi yüklenemedi';
    } else if (age != null && age > DATA_DEAD) {
      state = 'down';
      text = 'Veri zinciri durdu';
      detail = 'son güncelleme ' + (mins >= 120 ? Math.floor(mins / 60) + ' sa' : mins + ' dk') + ' önce';
    } else if (age != null && age > DATA_LATE) {
      state = 'late';
      text = 'Veri gecikiyor';
      detail = 'son güncelleme ' + mins + ' dk önce';
    } else if (wsState === 'live') {
      text = 'Canlı';
      detail = age == null ? '' : 'veri ' + (mins < 1 ? 'az önce' : mins + ' dk önce');
    } else {
      text = 'Bağlanıyor…';
    }
    $('status').dataset.state = state;
    $('status-text').textContent = text;
    $('status-time').textContent = detail;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    setStatus('connecting');
    activeKline = klineStream();
    const sock = new WebSocket(WS_HOSTS[wsHost] + '/stream?streams=' + baseStreams().concat(activeKline).join('/'));
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      retry = 0;
      lastMsg = Date.now();
      setStatus('live');
      if (everOpen) { loadSnapshot().catch(() => {}); loadChart(); }
      everOpen = true;
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      lastMsg = Date.now();
      const m = JSON.parse(ev.data);
      if (m.data) onStream(m.data);
    };
    sock.onerror = () => { try { sock.close(); } catch (e) { /* zaten kapalı */ } };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      setStatus('down');
      wsHost = (wsHost + 1) % WS_HOSTS.length;
      reconnectTimer = setTimeout(connect, Math.min(1000 * Math.pow(2, retry++), 15000));
    };
  }

  function onStream(d) {
    if (d.e === '24hrTicker') {
      if (d.s === 'USDTTRY') { renderTry(+d.c, +d.P); return; }
      const sym = d.s.slice(0, -4);
      if (state[sym]) applyTicker(sym, { price: d.c, pct: d.P, high: d.h, low: d.l, qvol: d.q });
    } else if (d.e === 'aggTrade') {
      const sym = d.s.slice(0, -4);
      if (state[sym]) { state[sym].price = +d.p; markDirty(sym); }
    } else if (d.e === 'kline') {
      onKline(d);
    }
  }

  function swapKline() {
    const next = klineStream();
    if (next === activeKline) return;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [activeKline], id: reqId++ }));
      ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [next], id: reqId++ }));
    }
    activeKline = next;
  }

  // Sessiz kalan bağlantıyı yakala
  setInterval(() => {
    if (ws && ws.readyState === 1 && Date.now() - lastMsg > 15000) ws.close();
    refreshStatus();
  }, 1000);

  // Telefon sayfayı arka plana alınca bağlantı uyur; geri dönünce tazele
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!ws || ws.readyState > 1 || Date.now() - lastMsg > 5000) {
      if (ws) { const old = ws; ws = null; try { old.close(); } catch (e) { /* yok say */ } }
      retry = 0;
      connect();
    }
  });
  window.addEventListener('online', () => { if (!ws) { retry = 0; connect(); } });

  // ---------- Seçimler ----------
  function selectSymbol(sym) {
    if (sym === selected) return;
    selected = sym;
    save('fp.symbol', sym);
    markSelection();
    state[sym].shown = null;
    markDirty(sym);
    swapKline();
    loadChart();
    loadFutures();
    loadMA();
    loadVsBtc();
    btMark();
  }
  function selectInterval(id) {
    if (id === interval) return;
    interval = id;
    save('fp.interval', id);
    markSelection();
    swapKline();
    loadChart();
  }

  // ---------- Kripto göstergeleri ----------
  const FAPI = 'https://fapi.binance.com';
  let indToken = 0;
  function setVerdict(id, text, tone) {
    const n = $(id);
    n.textContent = text;
    n.className = 'verdict' + (tone ? ' ' + tone : '');
  }
  async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ---------- Vadeli göstergelerin geçmişi (fonlama ve açık pozisyon, 30 gün) ----------
  let fhSym = '', fhLoaded = 0;
  async function loadFutHist() {
    const sym = selected;
    if (sym === fhSym && Date.now() - fhLoaded < 1800000) return;
    fhSym = sym;
    fhLoaded = Date.now();
    const pair = sym + 'USDT';
    const fresh = () => sym === selected;
    const fail = (id, tid) => { if (!fresh()) return; $(id).textContent = ''; $(tid).textContent = 'bu varlık için veri yok'; };

    getJson(FAPI + '/fapi/v1/fundingRate?symbol=' + pair + '&limit=90').then((rows) => {
      if (!fresh() || !Array.isArray(rows) || rows.length < 3) { fail('fh-fund', 'fh-fund-t'); return; }
      const v = rows.map((r) => +r.fundingRate * 100);
      const max = Math.max(1e-6, ...v.map(Math.abs));
      const w = 300 / v.length;
      let svg = '<line x1="0" x2="300" y1="35" y2="35" class="fh-zero" vector-effect="non-scaling-stroke"/>';
      v.forEach((x, i) => {
        const h = Math.max(0.6, Math.abs(x) / max * 32);
        svg += '<rect x="' + (i * w + 0.4).toFixed(1) + '" y="' + (x >= 0 ? 35 - h : 35).toFixed(1) + '" width="' + Math.max(0.6, w - 0.8).toFixed(1)
          + '" height="' + h.toFixed(1) + '" class="' + (x >= 0 ? 'fh-pos' : 'fh-neg') + '"/>';
      });
      $('fh-fund').innerHTML = svg; // yalnızca sayılardan üretilir
      const avg = v.reduce((s, x) => s + x, 0) / v.length;
      const pos = v.filter((x) => x > 0).length;
      $('fh-fund-t').textContent = 'ortalama %' + NF[4].format(avg) + ' · ' + v.length + ' dönemin ' + pos + "'inde artı · en yüksek %"
        + NF[4].format(Math.max(...v)) + ' · en düşük %' + NF[4].format(Math.min(...v));
    }).catch(() => fail('fh-fund', 'fh-fund-t'));

    getJson(FAPI + '/futures/data/openInterestHist?symbol=' + pair + '&period=4h&limit=180').then((rows) => {
      if (!fresh() || !Array.isArray(rows) || rows.length < 3) { fail('fh-oi', 'fh-oi-t'); return; }
      const v = rows.map((r) => +r.sumOpenInterestValue).filter((x) => x > 0);
      const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
      const d = v.map((x, i) => (i ? 'L' : 'M') + (i / (v.length - 1) * 300).toFixed(1) + ' ' + (66 - (x - lo) / span * 60).toFixed(1)).join('');
      $('fh-oi').innerHTML = '<path d="' + d + 'L300 70L0 70Z" class="fh-area"/><path d="' + d + '" class="fh-line" vector-effect="non-scaling-stroke"/>';
      const chg = (v[v.length - 1] / v[0] - 1) * 100;
      $('fh-oi-t').textContent = 'şimdi ' + fmtBig(v[v.length - 1]) + ' · 30 günde ' + fmtPct(chg) + ' · en yüksek ' + fmtBig(hi) + ' · en düşük ' + fmtBig(lo);
    }).catch(() => fail('fh-oi', 'fh-oi-t'));
  }

  async function loadFutures() {
    const token = ++indToken;
    const sym = selected;
    const pair = sym + 'USDT';
    $('ind-sym').textContent = sym;
    const fresh = () => token === indToken;
    loadFutHist();

    getJson(FAPI + '/fapi/v1/premiumIndex?symbol=' + pair).then((d) => {
      if (!fresh()) return;
      const rate = +d.lastFundingRate * 100;
      $('ind-fund').textContent = '%' + NF[4].format(rate);
      const v = rate >= 0.05 ? ['aşırı ısınmış, long kalabalık', 'warn'] : rate >= 0.02 ? ['long ağırlıklı', '']
        : rate <= -0.05 ? ['aşırı short, sıkışma riski', 'warn'] : rate <= -0.01 ? ['short ağırlıklı', ''] : ['nötr', ''];
      setVerdict('ind-fund-v', v[0], v[1]);
    }).catch(() => { if (fresh()) { $('ind-fund').textContent = '—'; setVerdict('ind-fund-v', 'bu varlık için veri yok'); } });

    getJson(FAPI + '/futures/data/openInterestHist?symbol=' + pair + '&period=1h&limit=25').then((rows) => {
      if (!fresh() || !rows.length) return;
      const now = +rows[rows.length - 1].sumOpenInterestValue;
      const chg = (now / +rows[0].sumOpenInterestValue - 1) * 100;
      $('ind-oi').textContent = fmtBig(now);
      const v = chg >= 5 ? ['kaldıraç artıyor', 'warn'] : chg <= -5 ? ['kaldıraç boşalıyor', ''] : ['yatay', ''];
      setVerdict('ind-oi-v', '24s ' + fmtPct(chg) + ' · ' + v[0], v[1]);
    }).catch(() => { if (fresh()) { $('ind-oi').textContent = '—'; setVerdict('ind-oi-v', 'bu varlık için veri yok'); } });

    getJson(FAPI + '/futures/data/globalLongShortAccountRatio?symbol=' + pair + '&period=1h&limit=1').then((rows) => {
      if (!fresh() || !rows.length) return;
      const long = +rows[0].longAccount * 100;
      $('ind-ls').textContent = '%' + NF[1].format(long) + ' long';
      $('ind-ls-bar').style.width = long.toFixed(1) + '%';
      const v = long >= 70 ? ['kalabalık long tarafta', 'warn'] : long <= 40 ? ['kalabalık short tarafta', 'warn'] : ['dengeli', ''];
      setVerdict('ind-ls-v', v[0], v[1]);
    }).catch(() => { if (fresh()) { $('ind-ls').textContent = '—'; setVerdict('ind-ls-v', 'bu varlık için veri yok'); } });
  }

  async function loadMA() {
    const sym = selected;
    try {
      const rows = await binance('/api/v3/klines?symbol=' + sym + 'USDT&interval=1d&limit=200');
      if (sym !== selected) return;
      const closes = rows.map((r) => +r[4]);
      const ma = closes.reduce((a, b) => a + b, 0) / closes.length;
      const dist = (closes[closes.length - 1] / ma - 1) * 100;
      $('ind-ma').textContent = fmtPrice(ma);
      const short = closes.length < 200 ? ' (' + closes.length + ' gün veri)' : '';
      setVerdict('ind-ma-v', 'fiyat ' + fmtPct(dist) + (dist >= 0 ? ' üstünde' : ' altında') + short, dist >= 0 ? 'pos' : 'neg');
    } catch (err) { $('ind-ma').textContent = '—'; setVerdict('ind-ma-v', 'veri alınamadı'); }
  }

  // Seçili varlığın BTC'ye göre performansı (SEMBOL/BTC paritesinin değişimi)
  async function loadVsBtc() {
    const sym = selected;
    $('ind-vs-label').textContent = sym === 'BTC' ? 'BTC\'ye göre performans' : sym + ' / BTC performansı (30 gün)';
    if (sym === 'BTC') { $('ind-vs').textContent = '—'; setVerdict('ind-vs-v', 'bir altcoin seçince görünür'); return; }
    try {
      const rows = await klinesFor(sym, 'BTC', '1d', '&limit=31');
      if (sym !== selected) return;
      const c = rows.map((r) => +r[4]);
      const n = c.length - 1;
      const chg = (back) => (c[n] / c[Math.max(0, n - back)] - 1) * 100;
      const m = chg(30);
      $('ind-vs').textContent = fmtPct(m);
      $('ind-vs').className = 'value ' + signClass(m);
      setVerdict('ind-vs-v', '7 gün ' + fmtPct(chg(7)) + ' · 24 sa ' + fmtPct(chg(1)) + ' · ' + (m >= 0 ? 'BTC\'den iyi' : 'BTC\'den zayıf'), m >= 0 ? 'pos' : 'neg');
    } catch (err) { $('ind-vs').textContent = '—'; setVerdict('ind-vs-v', 'veri alınamadı'); }
  }

  async function loadAltStrength() {
    try {
      const rets = await Promise.all(COINS.map(async (c) => {
        const rows = await binance('/api/v3/klines?symbol=' + c.s + 'USDT&interval=1d&limit=31');
        return { s: c.s, r: +rows[rows.length - 1][4] / +rows[0][1] - 1 };
      }));
      const btc = rets.find((x) => x.s === 'BTC').r;
      const alts = rets.filter((x) => x.s !== 'BTC');
      const better = alts.filter((x) => x.r > btc);
      $('ind-alt').textContent = better.length + ' / ' + alts.length;
      const share = better.length / alts.length;
      const label = share >= 0.75 ? 'altcoinler önde' : share <= 0.25 ? 'BTC önde' : 'karışık';
      const best = alts.slice().sort((a, b) => b.r - a.r)[0];
      setVerdict('ind-alt-v', label + ' · en iyi ' + best.s + ' ' + fmtPct(best.r * 100) + ', BTC ' + fmtPct(btc * 100));
    } catch (err) { setVerdict('ind-alt-v', 'veri alınamadı'); }
  }

  function selectStock(sym) {
    if (sym === stock) return;
    stock = sym;
    save('fp.stock', sym);
    markSelection();
    renderStocks();
    loadChart();
  }
  function selectStockInterval(id) {
    if (id === stockInterval) return;
    stockInterval = id;
    save('fp.sint', id);
    markSelection();
    loadChart();
  }

  // ---------- Strateji testi (geri test) ----------
  // Basit kuralları geçmiş mumlarda dener. Karar mum kapanışında verilir, işlem bir sonraki mumun açılışında yapılır.
  // Her alım ve satımda komisyon + kayma payı düşülür. Yalnızca alış yönlü, tüm bakiye ile.
  const BT_INTERVALS = [{ id: '1h', label: '1sa' }, { id: '4h', label: '4sa' }, { id: '1d', label: '1G' }];
  const BT_COST = 0.0015;   // işlem başına %0,15 (komisyon %0,10 + kayma %0,05)
  const BT_WARM = 200;      // göstergelerin oturması için atlanan ilk mumlar
  const BT_STRATS = [
    { id: 'ema', name: 'EMA 20 / 50 kesişimi', desc: 'Kısa ortalama uzunun üstündeyken içeride, altına inince dışarıda.',
      step: (d, i) => d.e20[i] > d.e50[i] },
    { id: 'trend', name: 'EMA 200 trend filtresi', desc: 'Kapanış EMA 200\'ün üstündeyken içeride, altındayken dışarıda.',
      step: (d, i) => d.c[i] > d.e200[i] },
    { id: 'macd', name: 'MACD kesişimi', desc: 'MACD pozitifken içeride, negatife dönünce dışarıda.',
      step: (d, i) => d.hist[i] > 0 },
    { id: 'rsi', name: 'RSI dipten dönüş', desc: 'RSI 30\'un altından yukarı dönünce girer, 65\'i geçince çıkar.',
      step: (d, i, inPos) => (inPos ? d.rsi[i] < 65 : d.rsi[i - 1] < 30 && d.rsi[i] >= 30) },
    { id: 'brk', name: '20 mumluk kırılım', desc: 'Son 20 mumun zirvesi aşılınca girer, son 10 mumun dibi kırılınca çıkar.',
      step: (d, i, inPos) => (inPos ? d.c[i] >= d.lo10[i] : d.c[i] > d.hi20[i]) },
  ];
  let btInterval = load('fp.bti', '4h');
  if (!BT_INTERVALS.some((x) => x.id === btInterval)) btInterval = '4h';
  let btSel = load('fp.bts', 'ema');
  const BT_STOPS = [{ v: 0, label: 'Zarar durdurma yok' }, { v: 0.05, label: '%5 zarar durdurma' }, { v: 0.1, label: '%10 zarar durdurma' }];
  let btSl = +load('fp.btsl', '0') || 0;
  if (!BT_STOPS.some((x) => x.v === btSl)) btSl = 0;
  let btToken = 0, btDirty = true, btVisible = false, btRes = null;

  async function btFetch(sym, quote, iv) {
    let rows = [];
    let end = '';
    for (let page = 0; page < 3; page++) {
      const part = await klinesFor(sym, quote, iv, '&limit=1000' + end);
      if (!part.length) break;
      rows = part.concat(rows);
      if (part.length < 990) break;
      end = '&endTime=' + (part[0][0] - 1);
    }
    return rows.slice(0, -1); // son mum henüz kapanmadı
  }

  function btPrepare(rows) {
    const o = rows.map((r) => +r[1]), h = rows.map((r) => +r[2]), l = rows.map((r) => +r[3]), c = rows.map((r) => +r[4]);
    const n = c.length;
    const raw = macdHist(c);
    const hist = new Array(n).fill(null);
    for (let i = 0; i < raw.length; i++) hist[n - raw.length + i] = raw[i];
    const hi20 = new Array(n).fill(null), lo10 = new Array(n).fill(null);
    for (let i = 20; i < n; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 20; j < i; j++) hi = Math.max(hi, h[j]);
      for (let j = i - 10; j < i; j++) lo = Math.min(lo, l[j]);
      hi20[i] = hi; lo10[i] = lo;
    }
    return { t: rows.map((r) => r[0]), o, l, c, n, e20: emaArr(c, 20), e50: emaArr(c, 50), e200: emaArr(c, 200), rsi: rsiArr(c, 14), hist, hi20, lo10 };
  }

  function maxDrawdown(curve) {
    let peak = curve[0], dd = 0;
    curve.forEach((v) => { if (v > peak) peak = v; dd = Math.min(dd, v / peak - 1); });
    return dd * 100;
  }

  // sl: zarar durdurma oranı (0 = yok). Durdurulunca kural "dışarıda" demeden yeniden girilmez.
  function btRun(d, strat, sl) {
    let cash = 1, units = 0, entry = 0, raw = 0, inPos = false, bars = 0, stopped = false;
    const trades = [], curve = [];
    for (let i = BT_WARM; i < d.n; i++) {
      const want = strat.step(d, i - 1, inPos);
      if (!want) stopped = false;
      if (want && !inPos && !stopped) {
        raw = d.o[i];
        entry = d.o[i] * (1 + BT_COST);
        units = cash / entry;
        inPos = true;
      } else if (!want && inPos) {
        const exit = d.o[i] * (1 - BT_COST);
        cash = units * exit;
        trades.push(exit / entry - 1);
        inPos = false;
      }
      if (inPos && sl && d.l[i] <= raw * (1 - sl)) {
        const exit = Math.min(d.o[i], raw * (1 - sl)) * (1 - BT_COST);
        cash = units * exit;
        trades.push(exit / entry - 1);
        inPos = false;
        stopped = true;
      }
      if (inPos) bars++;
      curve.push(inPos ? units * d.c[i] : cash);
    }
    const wins = trades.filter((x) => x > 0).length;
    return {
      curve, trades: trades.length, wins, open: inPos,
      ret: (curve[curve.length - 1] - 1) * 100,
      dd: maxDrawdown(curve),
      inMarket: bars / curve.length * 100,
    };
  }

  function btHold(d) {
    const entry = d.o[BT_WARM] * (1 + BT_COST);
    const curve = [];
    for (let i = BT_WARM; i < d.n; i++) curve.push(d.c[i] / entry);
    return { curve, ret: (curve[curve.length - 1] - 1) * 100, dd: maxDrawdown(curve) };
  }

  function btPath(curve, lo, hi, w, hgt) {
    const step = Math.max(1, Math.floor(curve.length / 300));
    let dstr = '';
    for (let i = 0; i < curve.length; i += step) {
      const x = i / (curve.length - 1) * w;
      const y = hgt - (curve[i] - lo) / (hi - lo || 1) * hgt;
      dstr += (dstr ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return dstr;
  }

  function btDrawCurve() {
    const svg = $('bt-curve');
    svg.textContent = '';
    if (!btRes) return;
    const r = btRes.rows.find((x) => x.s.id === btSel) || btRes.rows[0];
    const all = r.res.curve.concat(btRes.hold.curve);
    const lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    const NS = 'http://www.w3.org/2000/svg';
    const add = (dstr, cls) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', dstr);
      p.setAttribute('class', cls);
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(p);
    };
    const base = 100 - (1 - lo) / (hi - lo || 1) * 100;
    if (base >= 0 && base <= 100) add('M0 ' + base.toFixed(1) + 'L300 ' + base.toFixed(1), 'bt-base');
    add(btPath(btRes.hold.curve, lo, hi, 300, 100), 'bt-hold');
    add(btPath(r.res.curve, lo, hi, 300, 100), 'bt-strat');
    $('bt-curve-name').textContent = r.s.name;
    // Tek dönem yanıltabilir: aynı sonucu üç eşit döneme bölerek göster
    const parts = $('bt-parts');
    parts.textContent = '';
    const n = r.res.curve.length;
    const chg = (c, a, b) => (c[b] / (a ? c[a - 1] : 1) - 1) * 100;
    for (let k = 0; k < 3; k++) {
      const a = Math.floor(n * k / 3), b = Math.floor(n * (k + 1) / 3) - 1;
      const sv = chg(r.res.curve, a, b), hv = chg(btRes.hold.curve, a, b);
      const cell = el('div', 'bt-part');
      cell.appendChild(el('span', 'label', (k + 1) + '. dönem'));
      cell.appendChild(el('strong', signClass(sv), fmtPct(sv)));
      cell.appendChild(el('span', 'bt-desc', 'tut ' + fmtPct(hv)));
      parts.appendChild(cell);
    }
  }

  function btRender() {
    const list = $('bt-list');
    list.textContent = '';
    if (!btRes) return;
    const hold = btRes.hold;
    const days = Math.round((btRes.to - btRes.from) / 86400000);
    $('bt-period').textContent = new Date(btRes.from).toLocaleDateString('tr-TR') + ' – ' + new Date(btRes.to).toLocaleDateString('tr-TR')
      + ' · ' + days + ' gün · ' + btRes.bars + ' mum';
    $('bt-hold').textContent = fmtPct(hold.ret);
    $('bt-hold').className = 'value ' + signClass(hold.ret);
    $('bt-hold-v').textContent = 'en büyük düşüş ' + fmtPct(hold.dd);
    btRes.rows.forEach((r) => {
      const res = r.res;
      const b = el('button', 'bt-row');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(r.s.id === btSel));
      const left = el('span', 'bt-main');
      left.appendChild(el('strong', '', r.s.name));
      left.appendChild(el('span', 'bt-desc', r.s.desc));
      const few = res.trades < 10;
      left.appendChild(el('span', 'bt-stats', res.trades + ' işlem' + (res.trades ? ' · %' + NF[0].format(res.wins / res.trades * 100) + ' kazançlı' : '')
        + ' · en büyük düşüş ' + fmtPct(res.dd) + ' · içeride geçen süre %' + NF[0].format(res.inMarket) + (res.open ? ' · şu an içeride' : '')));
      if (few) left.appendChild(el('span', 'bt-warn', 'İşlem sayısı az; bu sonuç şansa bağlı olabilir.'));
      const right = el('span', 'bt-side');
      right.appendChild(el('span', 'bt-ret ' + signClass(res.ret), fmtPct(res.ret)));
      const diff = res.ret - hold.ret;
      right.appendChild(el('span', 'bt-vs ' + (diff >= 0 ? 'pos' : 'neg'), diff >= 0 ? (res.ret < 0 ? 'tutmaktan az zarar' : 'tutmaktan iyi') : 'tutmaktan kötü'));
      b.appendChild(left);
      b.appendChild(right);
      b.addEventListener('click', () => { btSel = r.s.id; save('fp.bts', btSel); btRender(); });
      list.appendChild(b);
    });
    btDrawCurve();
  }

  async function btLoad() {
    if (!btVisible || !btDirty) return;
    btDirty = false;
    const token = ++btToken;
    const sym = selected, iv = btInterval, quote = q();
    $('bt-sym').textContent = sym + (quote === 'BTC' ? '/BTC' : '') + ' · ' + BT_INTERVALS.find((x) => x.id === iv).label;
    $('bt-msg').hidden = false;
    $('bt-msg').textContent = 'Geçmiş veri yükleniyor…';
    try {
      const rows = await btFetch(sym, quote, iv);
      if (token !== btToken) return;
      if (rows.length < BT_WARM + 100) {
        btRes = null;
        btRender();
        $('bt-body').hidden = true;
        $('bt-msg').textContent = 'Bu varlık için bu zaman diliminde yeterli geçmiş yok. Daha kısa bir zaman dilimi seç.';
        return;
      }
      const d = btPrepare(rows);
      btRes = {
        from: d.t[BT_WARM], to: d.t[d.n - 1], bars: d.n - BT_WARM, hold: btHold(d),
        rows: BT_STRATS.map((s) => ({ s, res: btRun(d, s, btSl) })).sort((a, b) => b.res.ret - a.res.ret),
      };
      $('bt-msg').hidden = true;
      $('bt-body').hidden = false;
      btRender();
    } catch (err) {
      if (token !== btToken) return;
      btDirty = true;
      $('bt-msg').textContent = 'Geçmiş veri alınamadı. Birazdan yeniden denenecek.';
      setTimeout(btLoad, 15000);
    }
  }
  function btMark() { btDirty = true; btLoad(); }

  function initBt() {
    const box = $('bt-intervals');
    BT_INTERVALS.forEach((i) => {
      const b = el('button', '', i.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i.id === btInterval));
      b.addEventListener('click', () => {
        if (i.id === btInterval) return;
        btInterval = i.id;
        save('fp.bti', i.id);
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        btMark();
      });
      box.appendChild(b);
    });
    const stops = $('bt-stops');
    BT_STOPS.forEach((x) => {
      const b = el('button', '', x.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(x.v === btSl));
      b.addEventListener('click', () => {
        if (x.v === btSl) return;
        btSl = x.v;
        save('fp.btsl', String(x.v));
        stops.querySelectorAll('button').forEach((y) => y.setAttribute('aria-selected', String(y === b)));
        btMark();
      });
      stops.appendChild(b);
    });
    // Panel ekrana gelene kadar veri çekilmez (telefon verisini boşa harcamamak için)
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        btVisible = entries.some((e) => e.isIntersecting);
        btLoad();
      }, { rootMargin: '200px' }).observe($('bt-panel'));
    } else { btVisible = true; btLoad(); }
  }

  // ---------- BtcTurk: RENDER/TL (canlı, yalnızca okuma) ----------
  // Herkese açık piyasa verisi akışı; hesap, anahtar ya da emir yoktur.
  const BTK_WS = 'wss://ws-feed-pro.btcturk.com/';
  const BTK_PAIR = 'RENDERTRY';
  let usdtTry = null, btk = null, btkTick = null, btkBook = null, btkSide = 'buy', btkTimer = 0, btkLast = 0;
  const tl = (v, d) => '₺' + NF[d == null ? 2 : d].format(v);
  const bookSide = (rows, dir) => (Array.isArray(rows) ? rows : []).map((r) => ({ p: +r.P, a: +r.A }))
    .filter((r) => r.p > 0 && r.a > 0).sort((x, y) => dir * (x.p - y.p));

  // ---------- BtcTurk derinlik grafiği ve son işlemler ----------
  const DP_RANGES = [2, 5, 10];
  const TR_FILTERS = [[0, 'Tümü'], [10000, '≥ ₺10 B'], [50000, '≥ ₺50 B'], [250000, '≥ ₺250 B']];
  let dpRange = +load('fp.dpr', '5'), trMin = +load('fp.trm', '10000'), btkTrades = [];
  if (!DP_RANGES.includes(dpRange)) dpRange = 5;
  if (!TR_FILTERS.some((f) => f[0] === trMin)) trMin = 10000;

  function btkAddTrades(items) {
    (Array.isArray(items) ? items : [items]).forEach((x) => {
      const p = +x.P, a = +x.A, t = +x.D;
      if (!(p > 0) || !(a > 0) || !(t > 0) || btkTrades.some((y) => y.i === String(x.I))) return;
      btkTrades.push({ i: String(x.I), t, p, a, buy: +x.S === 0 });
    });
    btkTrades.sort((x, y) => y.t - x.t);
    if (btkTrades.length > 300) btkTrades.length = 300;
  }

  function btkDepth() {
    const svg = $('dp-svg');
    if (!btkBook || !btkBook.bids.length || !btkBook.asks.length) return;
    const mid = (btkBook.bids[0].p + btkBook.asks[0].p) / 2;
    const lo = mid * (1 - dpRange / 100), hi = mid * (1 + dpRange / 100);
    const bids = btkBook.bids.filter((r) => r.p >= lo), asks = btkBook.asks.filter((r) => r.p <= hi);
    const sum = (rows) => rows.reduce((s, r) => s + r.a, 0);
    const sumTl = (rows) => rows.reduce((s, r) => s + r.a * r.p, 0);
    const max = Math.max(sum(bids), sum(asks), 1e-9);
    const x = (p) => ((p - lo) / (hi - lo) * 300).toFixed(1);
    const y = (v) => (116 - v / max * 108).toFixed(1);
    const area = (rows, edge) => {
      if (!rows.length) return '';
      let cum = 0, d = 'M' + x(rows[0].p) + ' 116';
      rows.forEach((r) => { d += 'L' + x(r.p) + ' ' + y(cum); cum += r.a; d += 'L' + x(r.p) + ' ' + y(cum); });
      return d + 'L' + x(edge) + ' ' + y(cum) + 'L' + x(edge) + ' 116Z';
    };
    svg.innerHTML = '<path d="' + area(bids, lo) + '" class="dp-bid"/><path d="' + area(asks, hi) + '" class="dp-ask"/>'
      + '<line x1="150" x2="150" y1="0" y2="116" class="dp-midline" vector-effect="non-scaling-stroke"/>'; // yalnızca sayılardan üretilir
    $('dp-lo').textContent = tl(lo);
    $('dp-hi').textContent = tl(hi);
    $('dp-mid').textContent = 'orta ' + tl(mid) + ' · ±%' + dpRange;
    $('dp-bid').textContent = NF[0].format(sum(bids)) + ' RENDER';
    $('dp-ask').textContent = NF[0].format(sum(asks)) + ' RENDER';
    $('dp-bid-tl').textContent = '≈ ' + tl(sumTl(bids), 0) + ' · ' + bids.length + ' kademe';
    $('dp-ask-tl').textContent = '≈ ' + tl(sumTl(asks), 0) + ' · ' + asks.length + ' kademe';
    [['dp-wall-bid', bids], ['dp-wall-ask', asks]].forEach((w) => {
      const box = $(w[0]);
      box.textContent = '';
      w[1].slice().sort((a, b) => b.a - a.a).slice(0, 3).forEach((r) => {
        const li = el('li');
        li.appendChild(el('strong', '', tl(r.p)));
        li.appendChild(el('span', '', NF[0].format(r.a) + ' RENDER · ' + tl(r.a * r.p, 0) + ' · %' + NF[1].format(Math.abs(r.p / mid - 1) * 100) + ' uzakta'));
        box.appendChild(li);
      });
    });
  }

  function btkTradesRender() {
    const list = $('tr-list');
    list.textContent = '';
    const rows = btkTrades.filter((r) => r.p * r.a >= trMin).slice(0, 25);
    if (!rows.length) { list.appendChild(el('li', 'empty', btkTrades.length ? 'Bu büyüklükte işlem yok; süzgeci küçült.' : 'İşlemler bekleniyor…')); return; }
    rows.forEach((r) => {
      const li = el('li', r.buy ? 'short' : 'long');
      li.appendChild(el('time', '', new Date(r.t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
      li.appendChild(el('strong', '', tl(r.p)));
      li.appendChild(el('span', 'lq-side', (r.buy ? 'alış' : 'satış') + ' · ' + NF[r.a >= 100 ? 0 : 2].format(r.a)));
      li.appendChild(el('span', 'lq-usd', tl(r.p * r.a, 0)));
      list.appendChild(li);
    });
  }

  function initDepth() {
    const rb = $('dp-range');
    DP_RANGES.forEach((d) => {
      const b = el('button', '', '±%' + d);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(d === dpRange));
      b.addEventListener('click', () => {
        dpRange = d;
        save('fp.dpr', String(d));
        rb.querySelectorAll('button').forEach((z) => z.setAttribute('aria-selected', String(z === b)));
        btkDepth();
      });
      rb.appendChild(b);
    });
    const fb = $('tr-filters');
    TR_FILTERS.forEach((f) => {
      const b = el('button', '', f[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(f[0] === trMin));
      b.addEventListener('click', () => {
        trMin = f[0];
        save('fp.trm', String(f[0]));
        fb.querySelectorAll('button').forEach((z) => z.setAttribute('aria-selected', String(z === b)));
        btkTradesRender();
      });
      fb.appendChild(b);
    });
  }

  function btkConnect() {
    if (btk || document.hidden) return;
    let sock;
    try { sock = new WebSocket(BTK_WS); } catch (err) { return; }
    btk = sock;
    sock.onopen = () => {
      ['ticker', 'orderbook', 'trade'].forEach((ch) => sock.send(JSON.stringify([151, { type: 151, channel: ch, event: BTK_PAIR, join: true }])));
    };
    sock.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (err) { return; }
      if (!Array.isArray(d) || !d[1]) return;
      if (d[0] === 421 && d[1].symbol === BTK_PAIR) btkAddTrades(d[1].items);
      else if (d[1].PS !== BTK_PAIR) return;
      else if (d[0] === 422) btkAddTrades(d[1]);
      else if (d[0] === 402) btkTick = d[1];
      else if (d[0] === 431) btkBook = { asks: bookSide(d[1].AO, 1), bids: bookSide(d[1].BO, -1) };
      else return;
      btkLast = Date.now();
      if (!btkTimer) btkTimer = setTimeout(() => { btkTimer = 0; btkRender(); }, 500);
    };
    sock.onclose = () => { if (btk === sock) { btk = null; setTimeout(btkConnect, 5000); } btkRender(); };
    sock.onerror = () => { try { sock.close(); } catch (err) { /* zaten kapalı */ } };
  }

  function btkRender() {
    const live = btk && btk.readyState === 1 && Date.now() - btkLast < 20000;
    $('btk-state').textContent = live ? 'canlı · yalnızca okuma' : 'bağlanıyor…';
    const t = btkTick;
    if (t) {
      const last = +t.LA, bid = +t.B, ask = +t.A, dp = (last / +t.O - 1) * 100;
      $('btk-last').textContent = tl(last);
      setVerdict('btk-last-v', '24 sa ' + fmtPct(dp), dp >= 0 ? 'pos' : 'neg');
      $('btk-ba').textContent = tl(bid) + ' / ' + tl(ask);
      setVerdict('btk-ba-v', 'fark %' + NF[2].format((ask / bid - 1) * 100) + ' · en iyi fiyatta ' + NF[0].format(+t.BA) + ' / ' + NF[0].format(+t.AA) + ' RENDER');
      const g = state.RENDER.price * usdtTry;
      if (isFinite(g) && g > 0) {
        const prem = ((bid + ask) / 2 / g - 1) * 100;
        $('btk-prem').textContent = fmtPct(prem);
        setVerdict('btk-prem-v', 'global ' + tl(g) + ' · ' + (Math.abs(prem) < 0.3 ? 'uyumlu' : prem > 0 ? 'BtcTurk pahalı' : 'BtcTurk ucuz'),
          Math.abs(prem) >= 0.5 ? 'warn' : '');
      }
      $('btk-vol').textContent = NF[0].format(+t.V) + ' RENDER';
      setVerdict('btk-vol-v', '≈ ' + tl(+t.V * +t.AV, 0));
    }
    btkCalc();
    renderOzet();
    if (page === 'sinyal') { btkDepth(); btkTradesRender(); }
  }

  // Yazılan tutar canlı emir defterinde yürütülseydi ortalama hangi fiyattan dolardı
  function btkCalc() {
    const out = $('btk-calc');
    const amt = parseFloat($('btk-amt').value);
    out.className = 'calc-out';
    if (!btkBook) { out.textContent = 'Emir defteri bekleniyor…'; return; }
    if (!(amt > 0)) { out.textContent = 'Bir tutar yaz.'; return; }
    const rows = btkSide === 'buy' ? btkBook.asks : btkBook.bids;
    if (!rows.length) { out.textContent = 'Defterin bu tarafı boş.'; return; }
    let left = amt, qty = 0, spent = 0, steps = 0;
    for (const r of rows) {
      const take = Math.min(left, r.p * r.a);
      qty += take / r.p;
      spent += take;
      left -= take;
      steps++;
      if (left <= 0.01) break;
    }
    const best = rows[0].p, avg = spent / qty;
    const slip = Math.abs(avg / best - 1) * 100;
    let text = 'Ortalama fiyat ' + tl(avg, 3) + ' (en iyi ' + tl(best) + ') · kayma %' + NF[2].format(slip)
      + ' ≈ ' + tl(spent * slip / 100, 0) + ' · ' + NF[0].format(qty) + ' RENDER · ' + steps + ' kademe';
    if (left > 0.01) {
      text = 'Görünen defter yetmiyor: en fazla ' + tl(spent, 0) + ' doluyor (' + steps + ' kademe, ortalama ' + tl(avg, 3) + ', kayma %'
        + NF[2].format(slip) + '). Kalan ' + tl(left, 0) + ' için fiyat daha da kayar.';
      out.className = 'calc-out warn';
    } else if (slip >= 0.5) out.className = 'calc-out warn';
    out.textContent = text;
  }

  function initBtk() {
    $('btk-side').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        btkSide = b.dataset.id;
        $('btk-side').querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        btkCalc();
      });
    });
    $('btk-amt').addEventListener('input', btkCalc);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) btkConnect();
      else if (btk) { const s = btk; btk = null; s.close(); }
    });
    btkConnect();
  }

  // ---------- AI gündemi (Teknoloji sekmesi) ----------
  const AI_TOPICS = { model: 'Model', urun: 'Ürün', hizmet: 'Hizmet ve API', benchmark: 'Benchmark', arastirma: 'Araştırma',
    acik: 'Açık kaynak', sektor: 'Şirket ve sektör', genel: 'Genel' };
  const AI_FILTERS = [
    { id: 'all', label: 'Tümü', test: () => true },
    { id: 'saved', label: '★ Kaydedilenler', test: () => true },
    { id: 'model', label: 'Modeller', test: (n) => n.topic === 'model' },
    { id: 'urun', label: 'Ürünler', test: (n) => n.topic === 'urun' },
    { id: 'hizmet', label: 'Hizmet ve API', test: (n) => n.topic === 'hizmet' },
    { id: 'benchmark', label: 'Benchmark', test: (n) => n.topic === 'benchmark' },
    { id: 'arastirma', label: 'Araştırma', test: (n) => n.topic === 'arastirma' },
    { id: 'acik', label: 'Açık kaynak', test: (n) => n.topic === 'acik' },
    { id: 'blog', label: 'Uzman blogları', test: (n) => n.kind === 'blog' },
    { id: 'official', label: 'Resmi duyurular', test: (n) => n.official },
    { id: 'top', label: 'Çok konuşulan', test: (n) => n.n >= 2 },
    { id: 'sektor', label: 'Şirket ve sektör', test: (n) => n.topic === 'sektor' },
    { id: 'genel', label: 'Genel', test: (n) => n.topic === 'genel' },
  ];
  let aiFilter = load('fp.aif', 'all');
  // Kaydedilenler süzgeci açılışta hatırlanmaz: liste boşsa gündem boş görünürdü
  if (!AI_FILTERS.some((f) => f.id === aiFilter) || aiFilter === 'saved') aiFilter = 'all';
  let aiShown = 25;
  const aiSeen = +load('fp.aiSeen', '0') || 0;
  let aiSub = load('fp.aisub', 'gundem');
  if (!['gundem', 'modeller', 'kesfet', 'siteler'].includes(aiSub)) aiSub = 'gundem';
  let aiLab = '';
  const AI_LABS = [['OpenAI', /openai|chatgpt|\bgpt-?\d|\bsora\b|codex/i], ['Anthropic', /anthropic|claude/i],
    ['Google', /google|gemini|deepmind|\bveo\b|gemma/i], ['Meta', /\bmeta\b|\bllama\b/i], ['Microsoft', /microsoft|copilot/i],
    ['xAI', /\bxai\b|\bgrok\b/i], ['Nvidia', /nvidia/i], ['Apple', /\bapple\b/i], ['Amazon', /amazon|\baws\b|alexa/i],
    ['Mistral', /mistral/i], ['DeepSeek', /deepseek/i], ['Alibaba', /alibaba|qwen/i]];
  // "Sonra oku": yalnızca bu tarayıcıda saklanır
  let saved = [];
  try { saved = JSON.parse(load('fp.saved', '[]')); } catch (err) { saved = []; }
  if (!Array.isArray(saved)) saved = [];
  const isSaved = (id) => saved.some((x) => x.id === id);
  function toggleSaved(n) {
    if (isSaved(n.id)) saved = saved.filter((x) => x.id !== n.id);
    else saved.unshift({ id: n.id, title: String(n.title).slice(0, 240), url: n.url, source: n.source, ts: n.ts, topic: n.topic, kind: n.kind, official: !!n.official, n: n.n || 1, desc: String(n.desc || '').slice(0, 200) });
    saved = saved.slice(0, 100);
    save('fp.saved', JSON.stringify(saved));
  }

  function initAi() {
    const box = $('ai-filters');
    AI_FILTERS.forEach((f) => {
      const b = el('button', '', f.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.id = f.id;
      b.addEventListener('click', () => { aiFilter = f.id; aiShown = 25; save('fp.aif', f.id); renderAi(); });
      box.appendChild(b);
    });
    $('ai-more').addEventListener('click', () => { aiShown += 25; renderAi(); });
  }

  // ---------- AI nabzı: sayılar, günlük sütunlar, konu çubukları, çok konuşulanlar ----------
  const AI_ORDER = ['model', 'urun', 'hizmet', 'benchmark', 'arastirma', 'acik', 'sektor', 'genel'];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let aiKey = '', aiPulseKey = '';

  function countUp(node, to) {
    const from = +node.dataset.v || 0;
    node.dataset.v = to;
    if (calm || from === to) { node.textContent = NF[0].format(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      node.textContent = NF[0].format(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderAiPulse(all) {
    document.querySelectorAll('#aip-topics button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === aiFilter)));
    document.querySelectorAll('#aip-labs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lab === aiLab)));
    if (aiPulseKey === String(news.updated)) return;
    aiPulseKey = String(news.updated);
    const now = Date.now() / 1000;
    countUp($('aip-day'), all.filter((n) => now - n.ts < 86400).length);
    countUp($('aip-off'), all.filter((n) => n.official).length);

    // Günlük sütunlar: her sütun konulara göre bölünür
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const days = [];
    for (let k = 6; k >= 0; k--) {
      const t = start.getTime() / 1000 - k * 86400;
      days.push({ t, total: 0, by: {} });
    }
    const byTopic = {};
    all.forEach((n) => {
      byTopic[n.topic] = (byTopic[n.topic] || 0) + 1;
      const d = days.find((x) => n.ts >= x.t && n.ts < x.t + 86400);
      if (d) { d.total++; d.by[n.topic] = (d.by[n.topic] || 0) + 1; }
    });
    const maxDay = Math.max(1, ...days.map((d) => d.total));
    const box = $('aip-days');
    box.textContent = '';
    const tip = $('aip-tip');
    days.forEach((d, i) => {
      const date = new Date(d.t * 1000);
      const b = el('button', 'ai-day');
      b.type = 'button';
      b.style.setProperty('--i', i);
      b.appendChild(el('span', 'ai-n', d.total));
      const wrap = el('span', 'ai-colwrap');
      const stack = el('span', 'ai-stack');
      stack.style.height = (d.total / maxDay * 100).toFixed(1) + '%';
      AI_ORDER.forEach((tp) => {
        if (!d.by[tp]) return;
        const seg = el('i', 't-' + tp);
        seg.style.flexGrow = d.by[tp];
        stack.appendChild(seg);
      });
      wrap.appendChild(stack);
      b.appendChild(wrap);
      b.appendChild(el('span', 'ai-d', i === 6 ? 'bugün' : date.toLocaleDateString('tr-TR', { weekday: 'short' })));
      const text = date.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) + ': ' + d.total + ' haber'
        + AI_ORDER.filter((tp) => d.by[tp]).map((tp) => ' · ' + AI_TOPICS[tp] + ' ' + d.by[tp]).join('');
      b.setAttribute('aria-label', text);
      b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        tip.textContent = text;
      });
      box.appendChild(b);
    });

    // Konu çubukları: aynı renkler sütunların da açıklamasıdır
    const tb = $('aip-topics');
    tb.textContent = '';
    const maxTopic = Math.max(1, ...AI_ORDER.map((tp) => byTopic[tp] || 0));
    AI_ORDER.forEach((tp, i) => {
      const c = byTopic[tp] || 0;
      if (!c) return;
      const b = el('button', 'ai-topic t-' + tp);
      b.type = 'button';
      b.dataset.id = tp;
      b.style.setProperty('--i', i);
      b.setAttribute('aria-pressed', String(aiFilter === tp));
      b.appendChild(el('span', 'ai-tname', AI_TOPICS[tp]));
      const bar = el('span', 'ai-tbar');
      const fill = el('i');
      fill.style.width = Math.max(2, c / maxTopic * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      b.appendChild(bar);
      b.appendChild(el('span', 'ai-tcount', c));
      b.addEventListener('click', () => {
        aiFilter = aiFilter === tp ? 'all' : tp;
        aiShown = 25;
        save('fp.aif', aiFilter);
        renderAi();
        if (aiFilter !== 'all') $('ai-news-panel').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      });
      tb.appendChild(b);
    });

    // Laboratuvar çubukları: başlıkta adı ya da ürünü geçen haber sayısı
    const lb = $('aip-labs');
    lb.textContent = '';
    const labs = AI_LABS.map((l) => [l[0], all.filter((n) => l[1].test(n.title) || n.source === l[0]).length]).filter((l) => l[1])
      .sort((a, b) => b[1] - a[1]).slice(0, 8);
    labs.forEach((l, i) => {
      const b = barButton(l[0], l[1], labs[0][1], aiLab === l[0], i, () => {
        aiLab = aiLab === l[0] ? '' : l[0];
        aiShown = 25;
        renderAi();
        if (aiLab) $('ai-news-panel').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      });
      b.dataset.lab = l[0];
      lb.appendChild(b);
    });

    // Çok konuşulanlar: kaynak sayısına göre
    const hot = $('aip-hot');
    hot.textContent = '';
    const top = all.filter((n) => n.n >= 2 && now - n.ts < 172800).sort((a, b) => (b.n - a.n) || (b.ts - a.ts)).slice(0, 6);
    if (!top.length) hot.appendChild(el('p', 'empty', 'Son 48 saatte birden çok yayının yazdığı bir AI haberi yok.'));
    top.forEach((n, i) => {
      const a = el('a', 'ai-card t-' + n.topic);
      if (/^https?:\/\//.test(n.url)) a.href = n.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.setProperty('--i', i);
      const head = el('span', 'ai-card-head');
      head.appendChild(el('strong', '', n.n));
      head.appendChild(el('span', '', 'kaynak'));
      head.appendChild(el('span', 'ai-card-topic', AI_TOPICS[n.topic] || 'AI'));
      a.appendChild(head);
      a.appendChild(el('span', 'ai-card-title', n.title));
      a.appendChild(el('span', 'n-meta', n.source + ' · ' + ago(n.ts)));
      hot.appendChild(a);
    });
  }

  function renderAi() {
    if (!news) return;
    const all = Array.isArray(news.ai) ? news.ai : [];
    if (page === 'ai' && all.length) setTimeout(() => save('fp.aiSeen', String(all[0].ts)), 8000);
    renderAiPulse(all);
    renderOzAi();
    // Veri ve süzgeç değişmediyse listeyi yeniden kurma: canlandırma her iki dakikada bir baştan oynamasın
    const key = news.updated + '|' + aiFilter + '|' + aiShown + '|' + aiLab + '|' + saved.length + '|' + aiQuery;
    if (key === aiKey) return;
    aiKey = key;
    document.querySelectorAll('#ai-filters button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === aiFilter)));
    const lab = AI_LABS.find((l) => l[0] === aiLab);
    const items = (aiFilter === 'saved' ? saved : all).filter(AI_FILTERS.find((f) => f.id === aiFilter).test)
      .filter((n) => !lab || lab[1].test(n.title) || n.source === lab[0])
      .filter(matcher(aiQuery) || (() => true));
    const list = $('ai-list');
    list.textContent = '';
    if (!items.length) list.appendChild(el('li', 'empty', aiQuery ? 'Aramana uyan haber yok.' : aiFilter === 'saved' ? 'Henüz kaydettiğin haber yok. Bir haberin yanındaki yıldıza dokun.' : all.length ? 'Son 7 günde bu filtreye uyan haber yok.' : 'AI gündemi henüz yüklenmedi.'));
    items.slice(0, aiShown).forEach((n, i) => {
      const li = el('li');
      li.style.setProperty('--i', Math.min(i, 14));
      const a = el('a');
      if (/^https?:\/\//.test(n.url)) a.href = n.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', 'n-dot ai-' + n.topic));
      const body = el('span');
      const meta = el('span', 'n-meta', ago(n.ts) + ' · ' + n.source + (n.official ? ' · resmi duyuru' : n.kind === 'blog' ? ' · kişisel blog' : ''));
      if (n.n >= 2) meta.appendChild(el('span', 'badge-conf', n.n + ' kaynak'));
      if (aiSeen && n.ts > aiSeen) meta.appendChild(el('span', 'badge-new', 'YENİ'));
      body.appendChild(meta);
      body.appendChild(el('span', 'n-title', n.title));
      if (n.desc) body.appendChild(el('span', 'n-desc', String(n.desc).slice(0, 200)));
      const tags = el('span', 'n-tags');
      tags.appendChild(el('span', n.topic === 'model' || n.topic === 'benchmark' ? 'hot' : '', AI_TOPICS[n.topic] || 'AI'));
      (n.also || []).slice(0, 3).forEach((s) => tags.appendChild(el('span', '', 'ayrıca ' + s)));
      body.appendChild(tags);
      a.appendChild(body);
      li.appendChild(a);
      const star = el('button', 'n-save', isSaved(n.id) ? '★' : '☆');
      star.type = 'button';
      star.setAttribute('aria-label', 'Sonra oku listesine ekle ya da çıkar');
      star.setAttribute('aria-pressed', String(isSaved(n.id)));
      star.addEventListener('click', () => {
        toggleSaved(n);
        star.textContent = isSaved(n.id) ? '★' : '☆';
        star.setAttribute('aria-pressed', String(isSaved(n.id)));
        aiKey = news.updated + '|' + aiFilter + '|' + aiShown + '|' + aiLab + '|' + saved.length + '|' + aiQuery;
        if (aiFilter === 'saved') { aiKey = ''; renderAi(); }
      });
      li.appendChild(star);
      list.appendChild(li);
    });
    $('ai-more').hidden = items.length <= aiShown;
    $('ai-updated').textContent = all.length + ' haber · son 7 gün · güncellendi: ' + ago(news.updated);
  }

  // ---------- AI sekmesi: modeller, demolar, makaleler, projeler ----------
  let aiData = null, aiBusy = false, aiLoaded = 0;
  const compact = (v) => (v >= 1e6 ? NF[1].format(v / 1e6) + ' Mn' : v >= 1e3 ? NF[1].format(v / 1e3) + ' B' : String(v));
  const safeUrl = (u, host) => (typeof u === 'string' && u.indexOf('https://' + host + '/') === 0 ? u : '');
  const priceText = (r) => (!r.in && !r.out ? 'ücretsiz' : '$' + NF[2].format(r.in) + ' / $' + NF[2].format(r.out) + ' (1M token giriş/çıkış)');

  function aiRows(id, rows, host, title, meta, val, extra) {
    const list = $(id);
    list.textContent = '';
    if (!Array.isArray(rows) || !rows.length) { list.appendChild(el('li', 'empty', 'Veri henüz yok.')); return; }
    // Çubuk: satırın değeri listedeki en büyük değere oranlanır
    const max = Math.max(1, ...rows.map((r) => +val(r) || 0));
    let rank = 0;
    rows.forEach((r) => {
      const url = safeUrl(r.url, host);
      if (!url) return;
      const li = el('li');
      li.style.setProperty('--i', Math.min(rank, 14));
      const a = el('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'ranked';
      a.appendChild(el('span', 'ai-rank', ++rank));
      const body = el('span');
      body.appendChild(el('span', 'n-title', title(r)));
      body.appendChild(el('span', 'n-meta', meta(r)));
      const bar = el('span', 'ai-bar');
      const fill = el('i');
      fill.style.width = Math.max(2, (+val(r) || 0) / max * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      if (extra) extra(r, body);
      body.appendChild(bar);
      a.appendChild(body);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  // ---------- Model sıralamaları (LMArena açık verisi) ----------
  const ARENA_LABELS = { text: 'Metin', webdev: 'Web kodlama', vision: 'Görsel anlama', search: 'Arama',
    text_to_image: 'Görsel üretme', text_to_video: 'Video üretme' };
  let arenaTab = load('fp.arena', 'text');

  function renderArena() {
    const all = aiData && Array.isArray(aiData.arena) ? aiData.arena.filter((a) => ARENA_LABELS[a.id] && Array.isArray(a.rows) && a.rows.length) : [];
    const tabs = $('ar-tabs'), box = $('ar-list');
    tabs.textContent = '';
    box.textContent = '';
    if (!all.length) { box.appendChild(el('p', 'empty', 'Sıralama verisi henüz yok.')); return; }
    const cur = all.find((a) => a.id === arenaTab) || all[0];
    all.forEach((a) => {
      const b = el('button', '', ARENA_LABELS[a.id]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(a === cur));
      b.addEventListener('click', () => { arenaTab = a.id; save('fp.arena', a.id); renderArena(); });
      tabs.appendChild(b);
    });
    $('ar-date').textContent = 'LMArena' + (cur.date ? ' · ' + new Date(cur.date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : '');
    // Eksen sıfırdan başlamaz: puanlar birbirine yakın, o yüzden çubuk yerine nokta ve aralık çizilir
    const lo = Math.min(...cur.rows.map((r) => r.lo)), hi = Math.max(...cur.rows.map((r) => r.hi));
    const pad = Math.max(1, (hi - lo) * 0.06), span = hi - lo + 2 * pad;
    const pos = (v) => ((v - lo + pad) / span * 100).toFixed(1) + '%';
    cur.rows.forEach((r, i) => {
      const row = el('div', 'ar-row');
      row.style.setProperty('--i', i);
      row.appendChild(el('span', 'ai-rank', r.rank));
      const name = el('span', 'ar-name');
      name.appendChild(el('strong', '', r.name));
      name.appendChild(el('small', '', (r.org ? r.org + ' · ' : '') + '±' + Math.round((r.hi - r.lo) / 2) + ' · ' + compact(r.votes) + ' oy'));
      row.appendChild(name);
      row.appendChild(el('span', 'ar-val', NF[0].format(r.rating)));
      const track = el('span', 'ar-track');
      const ci = el('i', 'ar-ci');
      ci.style.left = pos(r.lo);
      ci.style.width = ((r.hi - r.lo) / span * 100).toFixed(1) + '%';
      const dot = el('i', 'ar-dot');
      dot.style.left = pos(r.rating);
      track.appendChild(ci);
      track.appendChild(dot);
      row.appendChild(track);
      box.appendChild(row);
    });
  }

  // ---------- Model zaman çizelgesi, karşılaştırma, proje sürümleri ----------
  const orgOf = (r) => (r.name.indexOf(':') > 0 ? r.name.split(':')[0] : r.id.split('/')[0]).trim();
  const shortName = (r) => (r.name.indexOf(':') > 0 ? r.name.slice(r.name.indexOf(':') + 1).trim() : r.name);
  const catalog = () => (aiData && Array.isArray(aiData.catalog) ? aiData.catalog.filter((r) => r && r.name && safeUrl(r.url, 'openrouter.ai')) : []);
  let tlOrg = '', tlShown = 15, topShown = 10;
  const TOP_FILTERS = [['', 'Tümü'], ['ai-agents', 'Ajanlar'], ['mcp', 'MCP'], ['llm', 'LLM'], ['rag', 'RAG'], ['local-llm', 'Yerel modeller'], ['machine-learning', 'Makine öğrenmesi']];
  let topFilter = load('fp.topf', '');
  if (!TOP_FILTERS.some((f) => f[0] === topFilter)) topFilter = '';

  function barButton(label, count, max, pressed, i, onClick) {
    const b = el('button', 'ai-topic lab');
    b.type = 'button';
    b.style.setProperty('--i', i);
    b.setAttribute('aria-pressed', String(pressed));
    b.appendChild(el('span', 'ai-tname', label));
    const bar = el('span', 'ai-tbar');
    const fill = el('i');
    fill.style.width = Math.max(2, count / max * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    b.appendChild(bar);
    b.appendChild(el('span', 'ai-tcount', count));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderTimeline() {
    const now = Date.now() / 1000;
    const rows = catalog().filter((r) => r.ts && now - r.ts < 60 * 86400);
    const orgs = {};
    rows.forEach((r) => { orgs[orgOf(r)] = (orgs[orgOf(r)] || 0) + 1; });
    const top = Object.entries(orgs).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const ob = $('tl-orgs');
    ob.textContent = '';
    top.forEach((o, i) => ob.appendChild(barButton(o[0], o[1], top[0][1], tlOrg === o[0], i, () => {
      tlOrg = tlOrg === o[0] ? '' : o[0];
      tlShown = 15;
      renderTimeline();
    })));
    const list = $('tl-list');
    list.textContent = '';
    const shown = rows.filter((r) => !tlOrg || orgOf(r) === tlOrg);
    if (!shown.length) list.appendChild(el('li', 'empty', 'Son 60 günde kayıtlı model yok.'));
    let lastDay = '';
    shown.slice(0, tlShown).forEach((r, i) => {
      const day = new Date(r.ts * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
      const li = el('li');
      li.style.setProperty('--i', Math.min(i, 14));
      li.appendChild(el('time', '', day === lastDay ? '' : day));
      lastDay = day;
      li.appendChild(el('i', 'tl-dot'));
      const a = el('a');
      a.href = safeUrl(r.url, 'openrouter.ai');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('strong', '', shortName(r)));
      a.appendChild(el('span', 'n-meta', orgOf(r) + (r.ctx ? ' · ' + compact(r.ctx) + ' bağlam' : '') + ' · '
        + (!r.in && !r.out ? 'ücretsiz' : '$' + NF[2].format(r.in) + ' / $' + NF[2].format(r.out))));
      li.appendChild(a);
      list.appendChild(li);
    });
    $('tl-more').hidden = shown.length <= tlShown;
  }

  let cmpA = load('fp.cmpa', ''), cmpB = load('fp.cmpb', '');
  function renderCompare() {
    const cat = catalog();
    const out = $('cmp-out');
    out.textContent = '';
    if (cat.length < 2) { out.appendChild(el('p', 'empty', 'Model listesi henüz yok.')); return; }
    if (!cat.some((r) => r.id === cmpA)) cmpA = cat[0].id;
    if (!cat.some((r) => r.id === cmpB) || cmpB === cmpA) cmpB = (cat.find((r) => r.id !== cmpA) || cat[1]).id;
    const sorted = cat.slice().sort((x, y) => x.name.localeCompare(y.name, 'tr'));
    [['cmp-a', cmpA], ['cmp-b', cmpB]].forEach((pair) => {
      const sel = $(pair[0]);
      sel.textContent = '';
      sorted.forEach((r) => {
        const o = el('option', '', r.name);
        o.value = r.id;
        o.selected = r.id === pair[1];
        sel.appendChild(o);
      });
    });
    const a = cat.find((r) => r.id === cmpA), b = cat.find((r) => r.id === cmpB);
    const date = (r) => (r.ts ? new Date(r.ts * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
    const usdM = (v) => (v ? '$' + NF[2].format(v) : 'ücretsiz');
    [['Bağlam boyutu (token)', (r) => r.ctx, (v) => (v ? compact(v) : '—')],
      ['Giriş fiyatı (1M token)', (r) => r.in, usdM],
      ['Çıkış fiyatı (1M token)', (r) => r.out, usdM]].forEach((m, i) => {
      const box = el('div', 'cmp-row');
      box.appendChild(el('div', 'label', m[0]));
      const max = Math.max(m[1](a) || 0, m[1](b) || 0, 1e-9);
      [[a, 'cmp-a'], [b, 'cmp-b']].forEach((x) => {
        const line = el('div', 'cmp-line');
        const bar = el('span', 'cmp-bar');
        const fill = el('i', x[1]);
        fill.style.width = Math.max(1, (m[1](x[0]) || 0) / max * 100).toFixed(1) + '%';
        fill.style.setProperty('--i', i);
        bar.appendChild(fill);
        line.appendChild(bar);
        line.appendChild(el('strong', '', m[2](m[1](x[0]))));
        box.appendChild(line);
      });
      out.appendChild(box);
    });
    const meta = el('div', 'cmp-row');
    meta.appendChild(el('div', 'label', 'OpenRouter\'a eklenme'));
    [[a, 'cmp-a'], [b, 'cmp-b']].forEach((x) => {
      const line = el('div', 'cmp-date');
      line.appendChild(el('i', x[1]));
      line.appendChild(el('span', '', shortName(x[0]) + ' · ' + date(x[0])));
      meta.appendChild(line);
    });
    out.appendChild(meta);
  }

  function renderReleases() {
    const list = $('ai-releases');
    list.textContent = '';
    const rows = aiData && Array.isArray(aiData.releases) ? aiData.releases : [];
    if (!rows.length) { list.appendChild(el('li', 'empty', 'Sürüm verisi henüz yok.')); return; }
    rows.forEach((r, i) => {
      const url = safeUrl(r.url, 'github.com');
      if (!url) return;
      const li = el('li');
      li.style.setProperty('--i', Math.min(i, 14));
      const a = el('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', 'n-dot'));
      const body = el('span');
      body.appendChild(el('span', 'n-title', String(r.id).split('/')[1] + ' ' + r.tag));
      body.appendChild(el('span', 'n-meta', (r.ts ? ago(r.ts) + ' · ' : '') + r.id));
      a.appendChild(body);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function initModels() {
    $('tl-more').addEventListener('click', () => { tlShown += 15; renderTimeline(); });
    $('ai-toprepos-more').addEventListener('click', () => { topShown += 15; renderAiData(); });
    const tf = $('top-filters');
    TOP_FILTERS.forEach((f) => {
      const b = el('button', '', f[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(f[0] === topFilter));
      b.addEventListener('click', () => {
        topFilter = f[0];
        topShown = 10;
        save('fp.topf', f[0]);
        tf.querySelectorAll('button').forEach((z) => z.setAttribute('aria-selected', String(z === b)));
        renderAiData();
      });
      tf.appendChild(b);
    });
    $('cmp-a').addEventListener('change', (e) => { cmpA = e.target.value; save('fp.cmpa', cmpA); renderCompare(); });
    $('cmp-b').addEventListener('change', (e) => { cmpB = e.target.value; save('fp.cmpb', cmpB); renderCompare(); });
    document.querySelectorAll('#ai-subs button').forEach((b) => {
      b.addEventListener('click', () => { aiSub = b.dataset.id; save('fp.aisub', aiSub); applyPage(); window.scrollTo(0, 0); });
    });
  }

  // ---------- AI coin sepeti: dönem başına göre getiri ----------
  const BASKET = [['RENDER', '--c1'], ['TAO', '--c2'], ['FET', '--c3'], ['NEAR', '--c4'], ['WLD', '--c5'], ['BTC', '--c6']];
  const BK_RANGES = [7, 30, 90];
  let bkDays = +load('fp.bk', '30'), bkRaw = null, bkLoaded = 0, bkSeries = null;
  if (!BK_RANGES.includes(bkDays)) bkDays = 30;

  function bkLegend(at) {
    if (!bkSeries) return;
    const n = bkSeries[0].length;
    const i = at == null ? n - 1 : Math.max(0, Math.min(n - 1, at));
    const box = $('bk-legend');
    box.textContent = '';
    BASKET.map((b, k) => ({ name: b[0], color: b[1], v: bkSeries[k][i][1] })).sort((x, y) => y.v - x.v).forEach((x) => {
      const li = el('li', x.name === 'RENDER' ? 'main' : '');
      const sw = el('i');
      sw.style.background = 'var(' + x.color + ')';
      li.appendChild(sw);
      li.appendChild(el('span', '', x.name));
      li.appendChild(el('strong', '', fmtPct(x.v)));
      box.appendChild(li);
    });
    const d = new Date(bkSeries[0][i][0]).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    $('bk-tip').textContent = at == null ? 'Son ' + bkDays + ' gün · grafiğe dokun, günü seç' : d + ' itibarıyla';
    const cur = document.getElementById('bk-cur');
    if (cur) {
      const x = (i / (n - 1) * 300).toFixed(1);
      cur.setAttribute('x1', x);
      cur.setAttribute('x2', x);
      cur.style.display = at == null ? 'none' : '';
    }
  }

  function drawBasket() {
    if (!bkRaw) return;
    const n = Math.min(bkDays + 1, ...bkRaw.map((r) => r.length));
    if (n < 3) return;
    bkSeries = bkRaw.map((rows) => {
      const cut = rows.slice(-n);
      return cut.map((r) => [r[0], (r[1] / cut[0][1] - 1) * 100]);
    });
    const all = bkSeries.reduce((acc, sr) => acc.concat(sr.map((p) => p[1])), []);
    const lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1;
    const y = (v) => (6 + (hi - v) / span * 138).toFixed(1);
    let svg = '<line x1="0" x2="300" y1="' + y(0) + '" y2="' + y(0) + '" class="bk-zero" vector-effect="non-scaling-stroke"/>';
    // RENDER en üstte çizilsin diye sondan başa
    BASKET.map((b, k) => k).reverse().forEach((k) => {
      const d = bkSeries[k].map((p, i) => (i ? 'L' : 'M') + (i / (n - 1) * 300).toFixed(1) + ' ' + y(p[1])).join('');
      svg += '<path d="' + d + '" class="bk-line' + (k === 0 ? ' main' : '') + (BASKET[k][0] === 'BTC' ? ' ref' : '')
        + '" style="stroke: var(' + BASKET[k][1] + ')" vector-effect="non-scaling-stroke"/>';
    });
    svg += '<line id="bk-cur" y1="0" y2="150" class="bk-cur" vector-effect="non-scaling-stroke" style="display:none"/>';
    $('bk-svg').innerHTML = svg; // yalnızca bu dosyada üretilen sayılar ve sabit sınıf adları
    const node = $('bk-svg');
    node.classList.remove('draw');
    void node.getBoundingClientRect();
    node.classList.add('draw');
    bkLegend(null);
  }

  async function loadBasket() {
    if (Date.now() - bkLoaded < 1800000) return;
    bkLoaded = Date.now();
    try {
      const res = await Promise.all(BASKET.map((b) => binance('/api/v3/klines?symbol=' + b[0] + 'USDT&interval=1d&limit=91')));
      bkRaw = res.map((rows) => rows.map((r) => [r[0], +r[4]]));
      drawBasket();
    } catch (err) {
      bkLoaded = 0;
      $('bk-tip').textContent = 'Veri alınamadı, yeniden denenecek.';
    }
  }

  function initBasket() {
    const box = $('bk-range');
    BK_RANGES.forEach((d) => {
      const b = el('button', '', d + 'G');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(d === bkDays));
      b.addEventListener('click', () => {
        bkDays = d;
        save('fp.bk', String(d));
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        drawBasket();
      });
      box.appendChild(b);
    });
    const svg = $('bk-svg');
    const pick = (e) => {
      if (!bkSeries) return;
      const r = svg.getBoundingClientRect();
      bkLegend(Math.round((e.clientX - r.left) / r.width * (bkSeries[0].length - 1)));
    };
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerleave', () => bkLegend(null));
  }

  // ---------- Canlı fiyat şeridi (her sayfada üstte) ----------
  const TAPE = [['RENDER', 'c'], ['BTC', 'c'], ['ETH', 'c'], ['SOL', 'c'], ['NDX', 'm', 'Nasdaq'], ['DXY', 'm', 'Dolar endeksi'], ['TRY', 't', 'USD/TRY']];
  const tapeEls = {};
  function initTape() {
    const box = $('tape');
    TAPE.forEach((t) => {
      const item = el('span', 'tape-item');
      item.appendChild(el('span', 'tape-name', t[2] || t[0]));
      const v = el('strong', '', '—');
      const p = el('span', 'tape-pct', '');
      item.appendChild(v);
      item.appendChild(p);
      box.appendChild(item);
      tapeEls[t[0]] = { v, p };
    });
  }
  function renderTape() {
    TAPE.forEach((t) => {
      const e = tapeEls[t[0]];
      let price = null, pct = null;
      if (t[1] === 'c') { price = state[t[0]].price; pct = state[t[0]].pct; if (price != null) e.v.textContent = fmtPrice(price); }
      else if (t[1] === 'm') {
        const m = markets && markets.symbols[t[0]];
        if (m) { price = m.price; pct = m.pct; e.v.textContent = NF[t[0] === 'NDX' ? 0 : 2].format(price); }
      } else if (usdtTry) { price = usdtTry; e.v.textContent = '₺' + NF[2].format(usdtTry); }
      if (price != null && pct != null && isFinite(pct)) { e.p.textContent = fmtPct(+pct); e.p.className = 'tape-pct ' + signClass(+pct); }
    });
  }

  // ---------- Özet: gün aralığı ve dönem getirileri ----------
  function renderOzRange() {
    const r = state.RENDER;
    if (r.price == null || !isFinite(r.high) || !isFinite(r.low) || r.high <= r.low) return;
    $('oz-lo').textContent = fmtPrice(r.low);
    $('oz-hi').textContent = fmtPrice(r.high);
    $('oz-range-dot').style.left = Math.max(0, Math.min(100, (r.price - r.low) / (r.high - r.low) * 100)).toFixed(1) + '%';
  }
  async function loadOzPerf() {
    try {
      const [h, d] = await Promise.all([
        binance('/api/v3/klines?symbol=RENDERUSDT&interval=1h&limit=25'),
        binance('/api/v3/klines?symbol=RENDERUSDT&interval=1d&limit=91'),
      ]);
      drawSpark($('oz-spark'), h.map((r) => +r[4]));
      const last = +h[h.length - 1][4];
      const back = (rows, n) => (rows.length > n ? (last / +rows[rows.length - 1 - n][4] - 1) * 100 : NaN);
      const box = $('oz-perf');
      box.textContent = '';
      [['1 sa', back(h, 1)], ['24 sa', back(h, 24)], ['7 g', back(d, 7)], ['30 g', back(d, 30)], ['90 g', back(d, 90)]].forEach((x) => {
        if (!isFinite(x[1])) return;
        const cell = el('span', 'oz-perf-cell');
        cell.appendChild(el('span', '', x[0]));
        cell.appendChild(el('strong', signClass(x[1]), fmtPct(x[1])));
        box.appendChild(cell);
      });
    } catch (err) { /* bir sonraki turda yeniden denenir */ }
  }

  // ---------- Likidasyon akışı (Binance vadeli, herkese açık akış) ----------
  const LQ_FILTERS = [['all', 'Tümü'], ['RENDER', 'RENDER'], ['BTC', 'BTC'], ['big', '≥ 100 B $']];
  const lq = { sock: null, rows: [], long: 0, short: 0, nLong: 0, nShort: 0, rLong: 0, rShort: 0, since: Date.now(), last: 0, beat: 0, opened: 0, filter: 'all', dirty: false };
  function lqConnect() {
    let sock;
    // Likidasyonlar seyrek gelir; akışın gerçekten çalıştığını anlamak için yanına sürekli akan bir nabız kanalı eklenir
    try { sock = new WebSocket('wss://fstream.binance.com/market/stream?streams=!forceOrder@arr/btcusdt@markPrice'); } catch (err) { setTimeout(lqConnect, 15000); return; }
    lq.sock = sock;
    sock.onopen = () => { lq.opened = Date.now(); lq.dirty = true; };
    sock.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (err) { return; }
      if (d && d.data) d = d.data;
      lq.beat = Date.now();
      if (d && d.e === 'markPriceUpdate') return;
      lq.last = Date.now();
      (Array.isArray(d) ? d : [d]).forEach((m) => {
        const o = m && m.o;
        if (!o || typeof o.s !== 'string' || !/^[A-Z0-9]{2,20}USDT$/.test(o.s)) return;
        const price = +(o.ap > 0 ? o.ap : o.p), qty = +(o.z > 0 ? o.z : o.q);
        const usd = price * qty;
        if (!(usd > 0)) return;
        const long = o.S === 'SELL'; // satış emri = long pozisyon kapatıldı
        const sym = o.s.slice(0, -4);
        if (long) { lq.long += usd; lq.nLong++; } else { lq.short += usd; lq.nShort++; }
        if (sym === 'RENDER') { if (long) lq.rLong += usd; else lq.rShort += usd; }
        if (usd >= 1000 || sym === 'RENDER') {
          lq.rows.unshift({ t: +o.T || Date.now(), sym, long, price, usd });
          if (lq.rows.length > 300) lq.rows.length = 300;
        }
        lq.dirty = true;
      });
    };
    sock.onclose = () => { if (lq.sock === sock) { lq.sock = null; lq.dirty = true; setTimeout(lqConnect, 8000); } };
    sock.onerror = () => { try { sock.close(); } catch (err) { /* zaten kapalı */ } };
  }
  function lqRender() {
    const open = lq.sock && lq.sock.readyState === 1;
    const live = open && Date.now() - lq.beat < 20000;
    // Bağlı görünüp veri göndermeyen bağlantıyı kapat, yeniden bağlansın
    if (open && !live && Date.now() - lq.opened > 30000) { try { lq.sock.close(); } catch (err) { /* zaten kapalı */ } }
    const stateText = live ? 'canlı · Binance vadeli' : open ? 'bağlı, veri bekleniyor…' : 'bağlanıyor…';
    if (!lq.dirty && $('lq-state').textContent === stateText) return;
    lq.dirty = false;
    $('lq-state').textContent = stateText;
    $('lq-long').textContent = fmtBig(lq.long);
    $('lq-short').textContent = fmtBig(lq.short);
    $('lq-long-n').textContent = lq.nLong + ' işlem';
    $('lq-short-n').textContent = lq.nShort + ' işlem';
    const total = lq.long + lq.short;
    $('lq-bar').style.width = (total ? lq.long / total * 100 : 50).toFixed(1) + '%';
    const mins = Math.max(1, Math.round((Date.now() - lq.since) / 60000));
    $('lq-since').textContent = 'Son ' + (mins >= 120 ? Math.round(mins / 60) + ' saat' : mins + ' dakika') + ' (panel açıldığından beri) · tüm vadeli piyasa';
    $('lq-render').textContent = lq.rLong || lq.rShort
      ? 'RENDER: long ' + fmtBig(lq.rLong) + ' · short ' + fmtBig(lq.rShort) : 'RENDER: henüz likidasyon görülmedi';
    const list = $('lq-list');
    list.textContent = '';
    const rows = lq.rows.filter((r) => (lq.filter === 'all' ? true : lq.filter === 'big' ? r.usd >= 100000 : r.sym === lq.filter)).slice(0, 30);
    if (!rows.length) { list.appendChild(el('li', 'empty', live ? 'Bu süzgeçte henüz likidasyon yok.' : 'Likidasyon bekleniyor…')); return; }
    rows.forEach((r) => {
      const li = el('li', r.long ? 'long' : 'short');
      li.appendChild(el('time', '', new Date(r.t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
      li.appendChild(el('strong', '', r.sym));
      li.appendChild(el('span', 'lq-side', r.long ? 'long kapatıldı' : 'short kapatıldı'));
      li.appendChild(el('span', 'lq-usd', fmtBig(r.usd)));
      list.appendChild(li);
    });
  }
  function initLq() {
    const box = $('lq-filters');
    LQ_FILTERS.forEach((f) => {
      const b = el('button', '', f[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(f[0] === lq.filter));
      b.addEventListener('click', () => {
        lq.filter = f[0];
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        lq.dirty = true;
        lqRender();
      });
      box.appendChild(b);
    });
    lqConnect();
    setInterval(() => { if (page === 'grafik' && !document.hidden) lqRender(); }, 1500);
  }

  // ---------- Takip tablosu (sıralanabilir) ----------
  const WT_COLS = [['s', 'Varlık'], ['price', 'Fiyat'], ['pct', '24 sa'], ['qvol', 'Hacim']];
  let wtSort = load('fp.wts', 'pct'), wtDir = load('fp.wtd', '-1') === '1' ? 1 : -1;
  if (!WT_COLS.some((c) => c[0] === wtSort)) wtSort = 'pct';
  function renderWatchTable() {
    const box = $('wt');
    box.textContent = '';
    const head = el('div', 'wt-row wt-head');
    head.setAttribute('role', 'row');
    WT_COLS.forEach((c) => {
      const b = el('button', '', c[1] + (wtSort === c[0] ? (wtDir > 0 ? ' ▲' : ' ▼') : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(wtSort === c[0]));
      b.addEventListener('click', () => {
        if (wtSort === c[0]) wtDir = -wtDir; else { wtSort = c[0]; wtDir = c[0] === 's' ? 1 : -1; }
        save('fp.wts', wtSort);
        save('fp.wtd', String(wtDir));
        renderWatchTable();
      });
      head.appendChild(b);
    });
    box.appendChild(head);
    const rows = COINS.map((c) => ({ s: c.s, ai: c.ai, price: +state[c.s].price, pct: +state[c.s].pct, qvol: +state[c.s].qvol }));
    rows.sort((a, b) => (wtSort === 's' ? a.s.localeCompare(b.s) * wtDir
      : ((isFinite(a[wtSort]) ? a[wtSort] : -Infinity) - (isFinite(b[wtSort]) ? b[wtSort] : -Infinity)) * wtDir));
    rows.forEach((r) => {
      const row = el('button', 'wt-row' + (r.s === selected ? ' sel' : ''));
      row.type = 'button';
      row.setAttribute('role', 'row');
      const name = el('span', 'wt-name', r.s);
      if (r.ai) name.appendChild(el('span', 'tag', 'AI'));
      row.appendChild(name);
      row.appendChild(el('span', '', isFinite(r.price) && r.price ? fmtPrice(r.price) : '—'));
      row.appendChild(el('strong', signClass(r.pct), isFinite(r.pct) ? fmtPct(r.pct) : '—'));
      row.appendChild(el('span', 'wt-vol', isFinite(r.qvol) && r.qvol ? fmtBig(r.qvol) : '—'));
      row.addEventListener('click', () => {
        selectSymbol(r.s);
        renderWatchTable();
        document.querySelector('.chart-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      box.appendChild(row);
    });
  }

  // ---------- Arama: yazılan her kelime başlık, açıklama ya da kaynakta geçmeli ----------
  let aiQuery = '', newsQuery = '';
  const fold = (t) => String(t || '').toLocaleLowerCase('tr');
  function matcher(q) {
    const words = fold(q).split(' ').filter(Boolean).slice(0, 6);
    if (!words.length) return null;
    return (n) => {
      const hay = fold(n.title) + ' ' + fold(n.desc) + ' ' + fold(n.source);
      return words.every((w) => hay.indexOf(w) >= 0);
    };
  }
  function initSearch() {
    let t1 = 0, t2 = 0;
    $('ai-search').addEventListener('input', (e) => {
      clearTimeout(t1);
      t1 = setTimeout(() => { aiQuery = e.target.value.trim().slice(0, 60); aiShown = 25; renderAi(); }, 200);
    });
    $('news-search').addEventListener('input', (e) => {
      clearTimeout(t2);
      t2 = setTimeout(() => { newsQuery = e.target.value.trim().slice(0, 60); newsShown = NEWS_STEP; renderNews(); }, 200);
    });
  }

  // ---------- Özet: "AI'da bugün" ----------
  function renderOzAi() {
    const box = $('oz-ai');
    box.textContent = '';
    const row = (label, text, sub, url) => {
      const li = el('li');
      const node = url ? el('a') : el('div');
      if (url) { node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
      node.appendChild(el('span', 'label', label));
      node.appendChild(el('span', 'oz-title', text));
      if (sub) node.appendChild(el('span', 'n-meta', sub));
      li.appendChild(node);
      box.appendChild(li);
    };
    const all = news && Array.isArray(news.ai) ? news.ai : [];
    const now = Date.now() / 1000;
    const fresh = all.filter((n) => now - n.ts < 172800);
    const hot = fresh.filter((n) => n.n >= 2).sort((a, b) => (b.n - a.n) || (b.ts - a.ts))[0];
    const pick = hot || fresh.find((n) => n.topic === 'model') || fresh.find((n) => n.official) || all[0];
    if (pick) {
      row(hot ? 'Çok konuşulan' : pick.topic === 'model' ? 'Model haberi' : 'Son haber', pick.title,
        pick.source + (pick.n >= 2 ? ' · ' + pick.n + ' kaynak' : '') + ' · ' + ago(pick.ts), /^https?:\/\//.test(pick.url) ? pick.url : '');
    }
    const d = aiData;
    const m = d && Array.isArray(d.models) ? d.models.find((r) => r && r.name && safeUrl(r.url, 'openrouter.ai')) : null;
    if (m) row('Son çıkan model', m.name, (m.ts ? ago(m.ts) + ' · ' : '') + (m.ctx ? compact(m.ctx) + ' bağlam' : 'OpenRouter'), safeUrl(m.url, 'openrouter.ai'));
    const ar = d && Array.isArray(d.arena) ? d.arena.find((a) => a.id === 'text' && Array.isArray(a.rows) && a.rows.length) : null;
    if (ar) row('LMArena metin lideri', ar.rows[0].name, NF[0].format(ar.rows[0].rating) + ' puan' + (ar.rows[1] ? ' · ikinci: ' + ar.rows[1].name : ''), '');
    if (!box.children.length) box.appendChild(el('li', 'empty', 'AI verisi henüz yüklenmedi.'));
  }

  function renderAiData() {
    const d = aiData;
    if (!d) return;
    const when = (r) => (r.ts ? ago(r.ts) + ' · ' : '');
    aiRows('ai-models', d.models, 'openrouter.ai', (r) => r.name || r.id,
      (r) => when(r) + (r.ctx ? compact(r.ctx) + ' token bağlam · ' : '') + priceText(r), (r) => r.ctx);
    countUp($('aip-models'), (d.models || []).filter((r) => r.ts && Date.now() / 1000 - r.ts < 604800).length);
    aiRows('ai-hfmodels', d.hf_models, 'huggingface.co', (r) => r.id,
      (r) => (r.task ? r.task + ' · ' : '') + '♥ ' + compact(r.likes) + ' · ' + compact(r.downloads) + ' indirme', (r) => r.likes);
    aiRows('ai-spaces', d.spaces, 'huggingface.co', (r) => r.id, (r) => when(r) + '♥ ' + compact(r.likes) + (r.task ? ' · ' + r.task : ''), (r) => r.likes);
    aiRows('ai-showhn', d.showhn, 'news.ycombinator.com', (r) => r.title.replace(/^Show HN:\s*/i, ''),
      (r) => when(r) + r.points + ' puan · ' + r.comments + ' yorum', (r) => r.points);
    aiRows('ai-papers', d.papers, 'huggingface.co', (r) => r.title, (r) => when(r) + '▲ ' + r.votes + ' oy · arXiv ' + r.id, (r) => r.votes);
    aiRows('ai-repos', d.repos, 'github.com', (r) => r.id + (r.desc ? ' — ' + r.desc : ''),
      (r) => '★ ' + compact(r.stars) + (r.lang ? ' · ' + r.lang : '') + (r.ts ? ' · ' + ago(r.ts) + ' açıldı' : ''), (r) => r.stars);
    const trAll = Array.isArray(d.top_repos) ? d.top_repos : [];
    // Eski veri (groups/top alanı yok) gelirse hepsi "Tümü" sayılır
    const tr = topFilter ? trAll.filter((r) => Array.isArray(r.groups) && r.groups.includes(topFilter))
      : trAll.filter((r) => r.top !== false);
    aiRows('ai-toprepos', tr.slice(0, topShown), 'github.com', (r) => r.id,
      (r) => '★ ' + compact(r.stars) + (r.lang ? ' · ' + r.lang : '') + (r.ts ? ' · son güncelleme ' + ago(r.ts) : ''), (r) => r.stars,
      (r, body) => {
        if (r.desc) body.appendChild(el('span', 'n-desc', r.desc));
        if (Array.isArray(r.topics) && r.topics.length) {
          const tags = el('span', 'n-tags');
          r.topics.slice(0, 4).forEach((t) => tags.appendChild(el('span', '', t)));
          body.appendChild(tags);
        }
      });
    $('ai-toprepos-more').hidden = tr.length <= topShown;
    renderOzAi();
    renderQuote();
    renderArena();
    renderTimeline();
    renderCompare();
    renderReleases();
    $('ai-data-updated').textContent = d.updated ? 'güncellendi: ' + ago(d.updated) : '';
  }

  async function loadAiData() {
    if (aiBusy || Date.now() - aiLoaded < 600000) return;
    aiBusy = true;
    try {
      const r = await fetch('data/ai.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      aiData = await r.json();
      aiLoaded = Date.now();
      renderAiData();
    } catch (err) { /* bir sonraki açılışta yeniden denenir */ }
    aiBusy = false;
  }

  // ---------- RENDER sinyal pilotu ----------
  let sig = null;
  const dt = (ts) => new Date(ts * 1000).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function renderSignals() {
    if (!sig || !Array.isArray(sig.rules)) return;
    const pilot = sig.rules.find((r) => r.id === sig.pilot_rule) || sig.rules[0];
    const st = $('sig-state');
    st.textContent = pilot.in ? 'İÇERİDE' : 'DIŞARIDA';
    st.className = 'sig-big ' + (pilot.in ? 'pos' : '');
    let line = pilot.name + ' · 4 saatlik mum';
    if (pilot.in && pilot.open) line += ' · giriş ' + fmtPrice(pilot.open.in_p) + ' (' + dt(pilot.open.in_t) + ') · şu an ' + fmtPct(pilot.open.ret);
    $('sig-line').textContent = line;
    const s = pilot.signal;
    $('sig-now').hidden = !s;
    if (s) $('sig-now').textContent = 'Yeni sinyal: ' + s.side + ' · ' + dt(s.t) + ' kapanışında ' + fmtPrice(s.price);
    $('sig-pilot').textContent = 'Pilot (' + new Date(sig.pilot_start * 1000).toLocaleDateString('tr-TR') + ' tarihinden beri): '
      + pilot.pilot.trades + ' kapanmış işlem' + (pilot.pilot.trades ? ', toplam ' + fmtPct(pilot.pilot.ret) : '')
      + (pilot.pilot_open ? ' · 1 açık işlem' : '');
    $('sig-hold').textContent = 'Son ' + Math.round(sig.bars * 4 / 24) + ' günde hiç satmadan tutmak: ' + fmtPct(sig.hold.ret)
      + ' (en büyük düşüş ' + fmtPct(sig.hold.dd) + ')';

    const list = $('sig-rules');
    list.textContent = '';
    sig.rules.forEach((r) => {
      const row = el('div', 'bt-row sig-row');
      const left = el('span', 'bt-main');
      const head = el('strong', '', r.name);
      if (r.id === sig.pilot_rule) head.appendChild(el('span', 'tag', 'PİLOT'));
      left.appendChild(head);
      left.appendChild(el('span', 'bt-desc', r.desc));
      left.appendChild(el('span', 'bt-stats', r.hist.trades + ' işlem · ' + r.hist.wins + ' kazançlı · en büyük düşüş ' + fmtPct(r.hist.dd)
        + ' · geçmiş toplam ' + fmtPct(r.hist.ret)));
      const right = el('span', 'bt-side');
      right.appendChild(el('span', 'sig-chip ' + (r.in ? 'in' : 'out'), r.in ? 'içeride' : 'dışarıda'));
      if (r.in && r.open) right.appendChild(el('span', 'bt-vs ' + signClass(r.open.ret), fmtPct(r.open.ret)));
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

    const tr = $('sig-trades');
    tr.textContent = '';
    const recent = (pilot.recent || []).slice().reverse();
    if (!recent.length) tr.appendChild(el('li', 'empty', 'Henüz kapanmış işlem yok.'));
    recent.forEach((t) => {
      const li = el('li');
      li.appendChild(el('span', '', dt(t.in_t) + ' al ' + fmtPrice(t.in_p) + ' → ' + dt(t.out_t) + ' sat ' + fmtPrice(t.out_p)));
      li.appendChild(el('strong', signClass(t.ret), fmtPct(t.ret)));
      tr.appendChild(li);
    });
    $('sig-updated').textContent = 'son mum: ' + dt(sig.candle);
    $('oz-sig').textContent = pilot.in ? 'İçeride' : 'Dışarıda';
    $('oz-sig').className = 'value ' + (pilot.in ? 'pos' : '');
    $('oz-sig-sub').textContent = s ? 'yeni sinyal: ' + s.side : pilot.in && pilot.open ? 'açık işlem ' + fmtPct(pilot.open.ret) : pilot.name;
  }

  async function loadSignals() {
    try {
      const r = await fetch('data/signals.json?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      sig = await r.json();
      renderSignals();
    } catch (err) { /* bir sonraki turda yeniden denenir */ }
  }

  // ---------- Sayfalar (alt çubuk) ----------
  const PAGES = ['ozet', 'grafik', 'sinyal', 'haber', 'ai'];
  let page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'ozet';

  function applyPage() {
    document.querySelectorAll('[data-page]').forEach((n) => {
      n.hidden = n.dataset.page !== page || (!!n.dataset.tab && n.dataset.tab !== tab) || (!!n.dataset.sub && n.dataset.sub !== aiSub);
    });
    document.querySelectorAll('#ai-subs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === aiSub)));
    document.querySelectorAll('#nav button').forEach((b) => {
      if (b.dataset.go === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function setPage(p) {
    if (!PAGES.includes(p)) return;
    page = p;
    try { history.replaceState(null, '', p === 'ozet' ? location.pathname : '#' + p); } catch (err) { /* adres çubuğu güncellenemezse sorun değil */ }
    applyPage();
    window.scrollTo(0, 0);
    if (p === 'ai') { renderAi(); loadAiData(); }
    if (p === 'grafik') { loadBasket(); renderWatchTable(); lq.dirty = true; lqRender(); }
    if (p === 'sinyal') { btkDepth(); btkTradesRender(); }
  }
  function initNav() {
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => {
        const sym = b.dataset.sym;
        if (sym && bySym[sym]) {
          if (tab !== 'kripto') { tab = 'kripto'; save('fp.tab', tab); applyTab(); }
          if (sym !== selected) selectSymbol(sym);
        }
        setPage(b.dataset.go);
      });
    });
  }

  // ---------- Özet sayfası ----------
  function renderOzet() {
    const r = state.RENDER, b = state.BTC;
    if (r.price != null) {
      $('oz-price').textContent = fmtPrice(r.price);
      $('oz-pct').textContent = fmtPct(r.pct);
      setSigned($('oz-pct'), 'chip', r.pct);
      if (btkTick) $('oz-tl').textContent = 'BtcTurk ' + tl(+btkTick.LA);
      else if (usdtTry) $('oz-tl').textContent = '≈ ' + tl(r.price * usdtTry);
    }
    if (b.price != null) {
      $('oz-btc').textContent = fmtPrice(b.price);
      $('oz-btc-sub').textContent = '24 sa ' + fmtPct(b.pct);
      setSigned($('oz-btc-sub'), 'sub', b.pct);
    }
    if (isFinite(r.pct) && isFinite(b.pct)) {
      const rel = ((1 + r.pct / 100) / (1 + b.pct / 100) - 1) * 100;
      const vs = $('oz-vs');
      vs.textContent = "BTC'ye göre " + fmtPct(rel) + ' (24 sa)';
      vs.className = signClass(rel);
    }
  }

  // RENDER'ın 4 saatlik mumlarından işaret sayımı; "Teknik görünüm" kartındaki sayımla aynı kurallar
  async function loadOzTa() {
    try {
      const rows = await binance('/api/v3/klines?symbol=RENDERUSDT&interval=4h&limit=400');
      const t = computeTA(rows.map((r) => toCandle(r[0], r[1], r[2], r[3], r[4])));
      const sg = [];
      if (t.e50 != null) sg.push(['Trend', t.price > t.e20 && t.e20 > t.e50 ? 1 : t.price < t.e20 && t.e20 < t.e50 ? -1 : 0]);
      if (t.rsi != null) sg.push(['RSI ' + NF[0].format(t.rsi), t.rsi >= 55 ? 1 : t.rsi <= 45 ? -1 : 0]);
      if (t.hist != null) sg.push(['MACD', t.hist > 0 ? 1 : t.hist < 0 ? -1 : 0]);
      if (t.e200 != null) sg.push(['EMA 200', t.price > t.e200 ? 1 : -1]);
      const up = sg.filter((x) => x[1] > 0).length, dn = sg.filter((x) => x[1] < 0).length;
      const v = $('oz-ta');
      v.textContent = up - dn >= 2 ? 'Yukarı' : dn - up >= 2 ? 'Aşağı' : 'Karışık';
      v.className = 'value ' + (up - dn >= 2 ? 'pos' : dn - up >= 2 ? 'neg' : '');
      $('oz-ta-sub').textContent = up + ' yukarı · ' + dn + ' aşağı';
      const pips = $('oz-pips');
      pips.textContent = '';
      sg.forEach((x) => pips.appendChild(el('span', 'ta-pip ' + (x[1] > 0 ? 'up' : x[1] < 0 ? 'dn' : 'flat'), (x[1] > 0 ? '▲ ' : x[1] < 0 ? '▼ ' : '• ') + x[0])));
    } catch (err) { /* bir sonraki turda yeniden denenir */ }
  }

  function renderOzEvents() {
    const box = $('oz-events');
    box.textContent = '';
    const now = Date.now() / 1000;
    const isR = (e) => (e.assets || []).includes('RENDER') || (e.tags || []).includes('RENDER');
    const list = (news.events || []).filter((e) => now - e.ts < 86400)
      .sort((a, b) => (isR(b) - isR(a)) || (b.score - a.score)).slice(0, 3);
    if (!list.length) { box.appendChild(el('li', 'empty', 'Son 24 saatte büyük bir olay yok.')); return; }
    list.forEach((e) => {
      const li = el('li');
      const a = el('a');
      if (/^https?:\/\//.test(e.url)) a.href = e.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', 'oz-score ' + levelOf(e.score)[1], e.score));
      const body = el('span');
      body.appendChild(el('span', 'oz-title', e.title));
      body.appendChild(el('span', 'n-meta', (isR(e) ? 'RENDER · ' : '') + e.type_label + ' · ' + e.n + ' kaynak · ' + ago(e.ts)));
      a.appendChild(body);
      li.appendChild(a);
      box.appendChild(li);
    });
  }

  // ---------- Açıklamalar: "?" düğmesinin arkasında ----------
  function initHelp() {
    document.querySelectorAll('.panel').forEach((panel) => {
      const head = panel.querySelector(':scope > .panel-head');
      if (!head || !panel.querySelector('.events-note, .ind > p')) return;
      const b = el('button', 'help-btn', '?');
      b.type = 'button';
      b.title = 'Açıklamayı göster ya da gizle';
      b.setAttribute('aria-label', 'Açıklama');
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => b.setAttribute('aria-pressed', String(panel.classList.toggle('help'))));
      head.appendChild(b);
    });
  }

  // ---------- Katlanır bölümler ----------
  function initFold() {
    document.querySelectorAll('.panel > .panel-head > h2').forEach((h) => {
      const panel = h.closest('.panel');
      const key = 'fp.fold.' + (panel.getAttribute('aria-label') || h.textContent);
      const set = (folded) => {
        panel.classList.toggle('folded', folded);
        h.setAttribute('aria-expanded', String(!folded));
      };
      h.setAttribute('role', 'button');
      h.tabIndex = 0;
      set(load(key, '0') === '1');
      const toggle = () => { const f = !panel.classList.contains('folded'); set(f); save(key, f ? '1' : '0'); };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }

  // ---------- Hisseler, endeksler ve piyasa nabzı ----------
  const usd = (v) => '$' + NF[2].format(v);
  const plain = (v) => NF[2].format(v);
  function vixMood(v) {
    return v < 15 ? 'sakin' : v < 20 ? 'normal' : v < 30 ? 'gergin' : 'korku';
  }
  // neutral: yön iyi/kötü anlamı taşımaz, renk verilmez
  const INDEX_CELLS = [
    { id: 'pulse-VIX', k: 'VIX', label: 'VIX · hisse korkusu', fmt: plain, neutral: true, note: (m) => vixMood(m.price) },
    { id: 'pulse-DXY', k: 'DXY', label: 'Dolar endeksi (DXY)', fmt: plain, neutral: true },
    { id: 'pulse-US10Y', k: 'US10Y', label: 'ABD 10 yıllık faiz', fmt: (v) => '%' + NF[2].format(v), neutral: true, bp: true },
    { id: 'pulse-NDX', k: 'NDX', label: 'Nasdaq 100', fmt: (v) => NF[0].format(v) },
    { id: 'tek-SOX', k: 'SOX', label: 'Yarı iletken endeksi (SOX)', fmt: (v) => NF[0].format(v) },
    { id: 'tek-SPX', k: 'SPX', label: 'S&P 500', fmt: (v) => NF[0].format(v) },
  ];

  function buildIndexCells() {
    INDEX_CELLS.forEach((c) => {
      const box = $(c.id);
      box.innerHTML = '<div class="label"></div><div class="value">—</div><div class="sub">&nbsp;</div>' +
        '<svg class="spark wide" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"></svg>';
      box.querySelector('.label').textContent = c.label;
    });
  }

  function renderIndexCells() {
    INDEX_CELLS.forEach((c) => {
      const m = markets.symbols[c.k];
      if (!m) return;
      const box = $(c.id);
      box.querySelector('.value').textContent = c.fmt(m.price);
      const sub = box.querySelector('.sub');
      let text;
      if (c.bp) {
        const bp = (m.price - m.prev) * 100;
        text = (bp > 0 ? '▲ ' : bp < 0 ? '▼ ' : '') + NF[1].format(Math.abs(bp)) + ' baz puan';
      } else if (c.neutral) {
        text = (m.pct > 0 ? '▲ ' : m.pct < 0 ? '▼ ' : '') + NF[2].format(Math.abs(m.pct)) + '%';
      } else {
        text = fmtPct(m.pct);
      }
      if (c.note) text += ' · ' + c.note(m);
      sub.textContent = text;
      sub.className = 'sub' + (c.neutral ? '' : ' ' + signClass(m.pct));
      drawSpark(box.querySelector('.spark'), m.bars.slice(-70).map((r) => r[4]), c.neutral ? true : m.pct >= 0 ? 1 : -1);
    });
  }

  function renderStocks() {
    if (!markets) return;
    STOCKS.forEach((c) => {
      const m = markets.symbols[c.s];
      const e = sEls[c.s];
      if (!m) return;
      if (e.card) {
        e.cardPrice.textContent = usd(m.price);
        e.cardPct.textContent = fmtPct(m.pct);
        setSigned(e.cardPct, 'chip', m.pct);
        drawSpark(e.spark, m.bars.slice(-70).map((r) => r[4]), m.pct >= 0 ? 1 : -1);
      }
      e.tilePct.textContent = fmtPct(m.pct);
      e.tilePrice.textContent = usd(m.price);
      const mix = Math.min(70, 12 + (Math.abs(m.pct) / 5) * 58);
      e.tile.style.setProperty('--heat', m.pct >= 0 ? 'var(--up)' : 'var(--down)');
      e.tile.style.setProperty('--mix', mix.toFixed(0) + '%');
    });

    const any = markets.symbols.NVDA || markets.symbols.NDX;
    if (any) {
      $('t-state').textContent = any.open ? 'Açık' : 'Kapalı';
      $('t-time').textContent = 'son işlem: ' + new Date(any.time * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    if (tab !== 'tek') return;
    const m = markets.symbols[stock];
    if (!m) return;
    $('chart-price').textContent = usd(m.price);
    $('chart-pct').textContent = fmtPct(m.pct);
    setSigned($('chart-pct'), 'chip', m.pct);
    const lastDay = Math.floor(m.bars[m.bars.length - 1][0] / 86400);
    const session = m.bars.filter((r) => Math.floor(r[0] / 86400) === lastDay);
    $('chart-high').textContent = usd(Math.max.apply(null, session.map((r) => r[2])));
    $('chart-low').textContent = usd(Math.min.apply(null, session.map((r) => r[3])));
    const vol = session.reduce((s, r) => s + r[5], 0);
    $('chart-vol').textContent = vol >= 1e6 ? NF[1].format(vol / 1e6) + ' Mn' : NF[0].format(vol);
  }

  // 1 yıllık günlük hisse mumları: yalnızca günlük grafik açılınca bir kez yüklenir
  let daily = null, dailyBusy = false;
  async function loadDaily() {
    if (dailyBusy) return;
    dailyBusy = true;
    try {
      const r = await fetch('data/daily.json?t=' + Math.floor(Date.now() / 3600000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      daily = await r.json();
      if (tab === 'tek' && stockInterval === '1d') loadChart();
    } catch (err) { setTimeout(() => { dailyBusy = false; }, 60000); }
  }

  async function loadMarkets() {
    try {
      const r = await fetch('data/markets.json?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      markets = await r.json();
      renderIndexCells();
      renderStocks();
      if (markets.updated !== marketsStamp) {
        marketsStamp = markets.updated;
        if (tab === 'tek') loadChart();
      }
    } catch (err) { /* bir sonraki turda yeniden denenir */ }
  }

  function renderNextEvent() {
    if (!news) return;
    const now = Date.now() / 1000;
    const upcoming = (news.calendar || []).filter((e) => e.ts > now && e.impact !== 'Holiday');
    const ev = upcoming.find((e) => e.impact === 'High') || upcoming[0];
    $('oz-ev').textContent = ev ? (ev.title_tr || ev.title) + ' · ' + untilText(ev.ts) : 'bu hafta kalan önemli veri yok';
    if (!ev) { $('ev-val').textContent = 'Yok'; $('ev-sub').textContent = 'bu hafta kalan önemli veri yok'; return; }
    $('ev-val').textContent = untilText(ev.ts).replace(' sonra', '');
    $('ev-sub').textContent = (ev.title_tr || ev.title) + ' · ' +
      new Date(ev.ts * 1000).toLocaleString('tr-TR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Piyasa özeti ----------
  async function loadGlobal() {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/global');
      if (!r.ok) return;
      const d = (await r.json()).data;
      $('g-mcap').textContent = fmtBig(d.total_market_cap.usd);
      const chg = d.market_cap_change_percentage_24h_usd;
      const chgEl = $('g-mcap-chg');
      chgEl.textContent = '24s ' + fmtPct(chg);
      setSigned(chgEl, 'sub', chg);
      $('g-dom').textContent = '%' + NF[1].format(d.market_cap_percentage.btc);
      $('g-vol').textContent = '24s hacim ' + fmtBig(d.total_volume.usd);
      drawDonut(d.market_cap_percentage);
    } catch (err) { /* bir sonraki turda yeniden denenir */ }
  }

  function drawDonut(pcts) {
    const top = Object.entries(pcts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const rest = Math.max(0, 100 - top.reduce((s, x) => s + x[1], 0));
    const parts = top.map((x) => ({ label: COIN_NAMES[x[0]] || x[0].toUpperCase(), v: x[1] }));
    parts.push({ label: 'Diğer', v: rest });
    let acc = 0;
    let svg = '';
    const legend = $('legend');
    legend.textContent = '';
    parts.forEach((p, i) => {
      const color = 'var(--c' + (i + 1) + ')';
      const len = Math.max(0, p.v - 0.6); // dilimler arasında ince boşluk
      svg += '<circle cx="21" cy="21" r="15.915" fill="none" stroke="' + color + '" stroke-width="5.5" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (100 - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"/>';
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = color;
      const pct = document.createElement('em');
      pct.textContent = '%' + NF[1].format(p.v);
      li.appendChild(dot);
      li.appendChild(document.createTextNode(String(p.label).slice(0, 24)));
      li.appendChild(pct);
      legend.appendChild(li);
      acc += p.v;
    });
    $('donut').innerHTML = svg;
    $('donut-main').textContent = '%' + NF[1].format(pcts.btc);
  }

  const FNG_TR = { 'Extreme Fear': 'Aşırı korku', 'Fear': 'Korku', 'Neutral': 'Nötr', 'Greed': 'Açgözlülük', 'Extreme Greed': 'Aşırı açgözlülük' };
  async function loadFng() {
    try {
      const r = await fetch('https://api.alternative.me/fng/?limit=30');
      if (!r.ok) return;
      const rows = (await r.json()).data;
      const v = +rows[0].value;
      const diff = rows[1] ? v - +rows[1].value : 0;
      $('fng-val').textContent = v;
      $('oz-fng').textContent = v;
      $('oz-fng-sub').textContent = FNG_TR[rows[0].value_classification] || rows[0].value_classification;
      $('fng-label').textContent = (FNG_TR[rows[0].value_classification] || rows[0].value_classification) +
        (diff ? ' · dün ' + (diff > 0 ? '+' : '') + diff : '');
      $('fng-needle').style.transform = 'rotate(' + (-90 + v * 1.8) + 'deg)';
      drawSpark($('fng-spark'), rows.map((x) => +x.value).reverse(), true);
    } catch (err) { /* isteğe bağlı gösterge */ }
  }

  // ---------- Gündem ve takvim ----------
  const FILTERS = [
    { id: 'all', label: 'Tümü', test: () => true },
    { id: 'conf', label: 'Teyitli', test: (n) => n.conf >= 2 },
    { id: 'hot', label: 'Önemli', test: (n) => n.hot },
    { id: 'BTC', label: 'BTC', test: (n) => n.tags.includes('BTC') },
    { id: 'RENDER', label: 'RENDER', test: (n) => n.tags.includes('RENDER') },
    { id: 'AI', label: 'AI', test: (n) => n.tags.includes('AI') },
    { id: 'Teknoloji', label: 'Şirketler', test: (n) => n.tags.includes('Teknoloji') },
    { id: 'Makro', label: 'Makro', test: (n) => n.tags.includes('Makro') },
    { id: 'Regülasyon', label: 'Regülasyon', test: (n) => n.tags.includes('Regülasyon') },
    { id: 'tr', label: 'Türkçe', test: (n) => n.lang === 'tr' },
  ];
  const NEWS_STEP = 20;
  let news = null, newsFilter = 'all', newsShown = NEWS_STEP;
  const seenBefore = +load('fp.newsSeen', '0');

  function ago(ts) {
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return 'az önce';
    if (s < 3600) return Math.round(s / 60) + ' dk önce';
    if (s < 86400) return Math.round(s / 3600) + ' sa önce';
    return Math.round(s / 86400) + ' gün önce';
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildFilters() {
    const box = $('news-filters');
    box.textContent = '';
    newsFilter = 'all';
    newsShown = NEWS_STEP;
    FILTERS.forEach((f) => {
      const b = el('button', '', f.label);
      b.type = 'button';
      b.role = 'tab';
      b.dataset.id = f.id;
      b.setAttribute('aria-selected', String(f.id === newsFilter));
      b.addEventListener('click', () => {
        newsFilter = f.id;
        newsShown = NEWS_STEP;
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        renderNews();
      });
      box.appendChild(b);
    });
  }
  $('news-more').addEventListener('click', () => { newsShown += NEWS_STEP; renderNews(); });

  function renderNews() {
    if (!news) return;
    renderEvents();
    const list = $('news');
    const filter = FILTERS.find((f) => f.id === newsFilter);
    const items = news.items.filter(filter.test).filter(matcher(newsQuery) || (() => true));
    list.textContent = '';
    if (!items.length) list.appendChild(el('li', 'empty', newsQuery ? 'Aramana uyan haber yok.' : 'Son 3 günde bu filtreye uyan haber yok.'));
    items.slice(0, newsShown).forEach((n) => {
      const li = el('li');
      const a = el('a');
      if (/^https?:\/\//.test(n.url)) a.href = n.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', 'n-dot' + (n.sent > 0 ? ' pos' : n.sent < 0 ? ' neg' : '')));
      const body = el('span');
      const meta = el('span', 'n-meta', ago(n.ts) + ' · ' + n.source + (n.tier === 'B' ? ' · sektör yayını' : ''));
      if (n.conf >= 2) meta.appendChild(el('span', 'badge-conf', n.conf + ' kaynak'));
      if (n.score >= 40) meta.appendChild(el('span', 'badge-score', 'etki ' + n.score));
      if (seenBefore && n.ts > seenBefore) meta.appendChild(el('span', 'badge-new', 'YENİ'));
      body.appendChild(meta);
      body.appendChild(el('span', 'n-title', n.title));
      if (n.desc) body.appendChild(el('span', 'n-desc', String(n.desc).slice(0, 200)));
      if (n.hot || n.tags.length) {
        const tags = el('span', 'n-tags');
        if (n.hot) tags.appendChild(el('span', 'hot', 'Önemli'));
        n.tags.forEach((t) => tags.appendChild(el('span', '', t)));
        body.appendChild(tags);
      }
      a.appendChild(body);
      li.appendChild(a);
      list.appendChild(li);
    });
    $('news-more').hidden = items.length <= newsShown;
    $('news-updated').textContent = 'güncellendi: ' + ago(news.updated);

    const dayAgo = Date.now() / 1000 - 86400;
    const recent = news.items.filter((n) => n.ts >= dayAgo);
    const pos = recent.filter((n) => n.sent > 0).length;
    const neg = recent.filter((n) => n.sent < 0).length;
    const neu = recent.length - pos - neg;
    $('mood').hidden = !recent.length;
    $('mood-pos').style.flexGrow = pos;
    $('mood-neu').style.flexGrow = neu;
    $('mood-neg').style.flexGrow = neg;
    $('mood-text').textContent = 'Son 24 saatte ' + recent.length + ' haber: ' + pos + ' olumlu, ' + neg + ' olumsuz, ' + neu + ' nötr';
  }

  function levelOf(score) {
    return score >= 75 ? ['Çok yüksek etki', 'l4'] : score >= 55 ? ['Yüksek etki', 'l3'] : ['Orta etki', 'l2'];
  }

  // Büyük olay kartları: puan, tipik etki ve ölçülen ilk tepki
  function renderEvents() {
    if (!news) return;
    const box = $('events');
    box.textContent = '';
    renderOzEvents();
    const list = (news.events || []).slice(0, 5);
    if (!list.length) {
      box.appendChild(el('p', 'empty', 'Son 48 saatte yüksek etkili bir olay yok.'));
      return;
    }
    list.forEach((e) => {
      const lv = levelOf(e.score);
      const card = el('article', 'event ' + lv[1]);
      const head = el('div', 'event-head');
      head.appendChild(el('span', 'event-score', e.score));
      const headText = el('div');
      headText.appendChild(el('strong', '', lv[0]));
      headText.appendChild(el('span', 'hint', e.type_label + ' · ' + e.n + ' kaynak · ' + ago(e.ts)));
      head.appendChild(headText);
      card.appendChild(head);

      const a = el('a', 'event-title', e.title);
      if (/^https?:\/\//.test(e.url)) a.href = e.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      card.appendChild(a);

      const fx = el('div', 'event-fx');
      fx.appendChild(el('span', 'fx-label', 'Tipik etki'));
      if (e.up.length || e.down.length) {
        const chips = el('div', 'fx-chips');
        e.up.forEach((x) => chips.appendChild(el('span', 'fx up', '▲ ' + x)));
        e.down.forEach((x) => chips.appendChild(el('span', 'fx down', '▼ ' + x)));
        fx.appendChild(chips);
      }
      fx.appendChild(el('p', 'fx-why', e.why));
      card.appendChild(fx);

      if (e.react && e.react.length) {
        const re = el('div', 'event-react');
        re.appendChild(el('span', 'fx-label', e.react.every((r) => r.full) ? 'İlk 3 saatte' : 'Şu ana kadar'));
        e.react.forEach((r) => {
          const s = el('span', 'react ' + signClass(r.pct), r.k + ' ' + fmtPct(r.pct));
          re.appendChild(s);
        });
        card.appendChild(re);
      }
      box.appendChild(card);
    });
  }

  function untilText(ts) {
    const m = Math.round((ts - Date.now() / 1000) / 60);
    if (m < 60) return m + ' dk sonra';
    if (m < 1440) return Math.floor(m / 60) + ' sa ' + (m % 60) + ' dk sonra';
    return Math.round(m / 1440) + ' gün sonra';
  }

  function renderCalendar() {
    if (!news) return;
    const box = $('cal');
    box.textContent = '';
    const events = news.calendar || [];
    if (!events.length) { box.appendChild(el('li', 'empty', 'Bu hafta için kayıtlı önemli veri yok.')); return; }
    const now = Date.now() / 1000;
    const nextTs = (events.find((e) => e.ts > now) || {}).ts;
    let lastDay = '';
    events.forEach((e) => {
      const d = new Date(e.ts * 1000);
      const day = d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (day !== lastDay) { box.appendChild(el('li', 'day', day)); lastDay = day; }
      const li = el('li', 'ev' + (e.ts < now ? ' past' : '') + (e.ts === nextTs ? ' next' : ''));
      const holiday = e.impact === 'Holiday';
      li.appendChild(el('time', '', holiday ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })));
      const imp = el('span', 'imp ' + e.impact);
      imp.title = e.impact === 'High' ? 'Yüksek etki' : e.impact === 'Medium' ? 'Orta etki' : 'Tatil';
      li.appendChild(imp);
      const body = el('span');
      body.appendChild(el('span', 'ev-title', e.title_tr || e.title));
      const sub = [];
      if (e.title_tr) sub.push(e.title);
      if (e.forecast) sub.push('beklenti ' + e.forecast);
      if (e.previous) sub.push('önceki ' + e.previous);
      if (sub.length) body.appendChild(el('span', 'ev-sub', sub.join(' · ')));
      if (e.ts === nextTs) body.appendChild(el('span', 'ev-sub soon', untilText(e.ts)));
      li.appendChild(body);
      box.appendChild(li);
    });
  }

  async function loadNews() {
    try {
      const r = await fetch('data/news.json?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      news = await r.json();
      renderNews();
      renderAi();
      renderCalendar();
      renderNextEvent();
      if (news.items.length) setTimeout(() => save('fp.newsSeen', String(news.items[0].ts)), 8000);
    } catch (err) {
      if (!news) {
        $('news-updated').textContent = 'Haberler alınamadı, yeniden denenecek';
        $('cal').textContent = '';
        $('cal').appendChild(el('li', 'empty', 'Takvim alınamadı.'));
      }
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadNews(); loadMarkets(); } });

  // ---------- Günün sözü: sabit, kaynağı belli liste; her gün sıradaki ----------
  const QUOTES = [
    ["Öğrenip de düşünmeyen boşa çalışır; düşünüp de öğrenmeyen tehlikededir.", "Konfüçyüs · Analektler 2.15 · Çin"],
    ["Bin millik yolculuk tek bir adımla başlar.", "Laozi · Tao Te Ching 64 · Çin"],
    ["Her şey başkasınındır; yalnızca zaman bizimdir.", "Seneca · Lucilius'a Mektuplar 1 · Roma"],
    ["İşe engel olan, işi ilerletir; yolda duran, yol olur.", "Marcus Aurelius · Kendime Düşünceler 5.20 · Roma"],
    ["Bazı şeyler bizim elimizdedir, bazıları değildir.", "Epiktetos · Enkheiridion 1 · Yunan"],
    ["Aynı ırmağa iki kez girilmez.", "Herakleitos · Platon'un aktarımıyla · Yunan"],
    ["Sorgulanmamış bir hayat yaşanmaya değmez.", "Sokrates · Platon, Sokrates'in Savunması 38a · Yunan"],
    ["Gelin tanış olalım, işi kolay kılalım; sevelim sevilelim, dünya kimseye kalmaz.", "Yunus Emre · Anadolu"],
    ["Düşmanını ve kendini tanırsan, yüz savaşta bile tehlikeye düşmezsin.", "Sun Tzu · Savaş Sanatı 3 · Çin"],
    ["Yedi kez düş, sekiz kez kalk.", "Japon atasözü"],
    ["Damlaya damlaya göl olur.", "Türk atasözü"],
    ["Bir kırlangıçla bahar gelmez.", "Aristoteles · Nikomakhos'a Etik I.7 · Yunan"],
    ["Günü yakala, yarına olabildiğince az güven.", "Horatius · Odlar I.11 · Roma"],
    ["Hayat kısa, sanat uzun.", "Hipokrat · Aforizmalar 1.1 · Yunan"],
    ["Bize kısa bir ömür verilmedi; biz onu kısaltıyoruz.", "Seneca · Hayatın Kısalığı Üzerine 1 · Roma"],
    ["Kendine yapılmasını istemediğini başkasına yapma.", "Konfüçyüs · Analektler 15.24 · Çin"],
    ["Başkalarını bilen bilgedir; kendini bilen aydınlanmıştır.", "Laozi · Tao Te Ching 33 · Çin"],
    ["Kalbin, aklın bilmediği sebepleri vardır.", "Blaise Pascal · Düşünceler · Fransa"],
    ["Bütün yüce şeyler, zor oldukları kadar nadirdir.", "Baruch Spinoza · Etika V · Hollanda"],
    ["Yalnızca eyleme hakkın var, meyvelerine asla.", "Bhagavad Gita 2.47 · Hindistan"],
    ["Âdemoğulları birbirinin uzuvlarıdır; çünkü yaratılışta aynı özdendirler.", "Sadi Şirazi · Gülistan · İran"],
    ["Sapere aude: kendi aklını kullanma cesaretini göster.", "Immanuel Kant · Aydınlanma Nedir? · Almanya"],
    ["Sakla samanı, gelir zamanı.", "Türk atasözü"],
    ["Maymun bile ağaçtan düşer.", "Japon atasözü"],
    ["Yavaş yavaş acele et.", "Augustus · Suetonius'un aktarımıyla · Roma"],
    ["Hayatta en hakiki mürşit ilimdir.", "Mustafa Kemal Atatürk · Samsun konuşması, 1924"],
    ["İnsanın karakteri, onun kaderidir.", "Herakleitos · Fragman B119 · Yunan"],
  ];
  function renderQuote() {
    const w = aiData && aiData.quote;
    if (w && typeof w.text === 'string' && w.text && typeof w.by === 'string') {
      $('oz-quote').textContent = '“' + w.text.slice(0, 420) + '”';
      const by = $('oz-quote-by');
      by.textContent = w.by.slice(0, 80) + ' · ';
      const a = el('a', '', 'Vikisöz');
      const u = safeUrl(w.url, 'tr.wikiquote.org');
      if (u) { a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; by.appendChild(a); } else by.appendChild(el('span', '', 'Vikisöz'));
      return;
    }
    // Veri gelmezse yedek liste
    const d = new Date();
    const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000);
    const q = QUOTES[((day % QUOTES.length) + QUOTES.length) % QUOTES.length];
    $('oz-quote').textContent = '“' + q[0] + '”';
    $('oz-quote-by').textContent = q[1];
  }

  // ---------- Başlat ----------
  // Her adım ayrı çalışır: bir bölüm hata verirse (ör. eksik öğe) geri kalan panel yine açılır
  const safe = (fn) => { try { fn(); } catch (err) { if (window.console) console.error('Başlatma hatası:', fn.name, err); } };
  safe(buildUI);
  safe(buildIndexCells);
  safe(initChart);
  safe(applyTab);
  safe(loadNews);
  safe(loadMarkets);
  setInterval(loadNews, 120000);
  safe(loadSignals);
  setInterval(loadSignals, 120000);
  setInterval(() => { if (page === 'ai' && !document.hidden) loadAiData(); }, 300000);
  safe(loadOzTa);
  safe(loadOzPerf);
  setInterval(() => { if (!document.hidden) loadOzPerf(); }, 300000);
  safe(initTape);
  safe(initSearch);
  safe(initDepth);
  safe(initLq);
  safe(renderTape);
  setInterval(renderTape, 2000);
  safe(renderWatchTable);
  setInterval(() => { if (page === 'grafik' && tab === 'kripto' && !document.hidden) renderWatchTable(); }, 4000);
  setInterval(() => { if (!document.hidden) loadOzTa(); }, 300000);
  setInterval(loadMarkets, 120000);
  setInterval(() => { renderNews(); renderCalendar(); renderNextEvent(); }, 60000);
  loadSnapshot().catch(() => {});
  safe(loadSparks);
  safe(loadFutures);
  safe(loadMA);
  safe(loadAltStrength);
  setInterval(() => { if (!document.hidden && tab === 'kripto') loadFutures(); }, 60000);
  setInterval(loadMA, 1800000);
  safe(loadVsBtc);
  setInterval(loadVsBtc, 600000);
  safe(initBt);
  safe(initBtk);
  safe(initAi);
  safe(initFold);
  safe(initHelp);
  safe(initNav);
  safe(renderQuote);
  safe(initModels);
  safe(initBasket);
  safe(loadAiData);
  setInterval(() => { if (page === 'ozet' && !document.hidden) loadAiData(); }, 900000);
  if (page === 'grafik') loadBasket();
  setInterval(() => { if (page === 'grafik' && !document.hidden) loadBasket(); }, 600000);
  setInterval(loadAltStrength, 3600000);
  safe(connect);
  safe(loadGlobal);
  safe(loadFng);
  setInterval(loadGlobal, 120000);
  setInterval(loadSparks, 300000);
  setInterval(loadFng, 1800000);
})();
