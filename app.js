(() => {
  'use strict';

  // ---------- Ayarlar ----------
  const REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
  const WS_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

  const COINS = [
    { s: 'BTC', name: 'Bitcoin', main: true },
    { s: 'RENDER', name: 'Render', main: true, ai: true },
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

  let selected = load('fp.symbol', 'BTC');
  if (!bySym[selected]) selected = 'BTC';
  let interval = load('fp.interval', '1h');
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
  let tab = load('fp.tab', 'kripto') === 'tek' ? 'tek' : 'kripto';
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
    $('chart-pair').textContent = tek ? stock + ' · ABD borsası' : selected + '/USDT';
    $('chart-l1').textContent = tek ? 'Seans en yüksek' : '24s en yüksek';
    $('chart-l2').textContent = tek ? 'Seans en düşük' : '24s en düşük';
    $('chart-l3').textContent = tek ? 'Seans hacmi (adet)' : '24s hacim';
  }

  // Sekme değişince görünür bölümleri, grafiği ve haber filtrelerini eşitle
  function applyTab() {
    document.querySelectorAll('[data-tab]').forEach((n) => { n.hidden = n.dataset.tab !== tab; });
    document.querySelectorAll('#maintabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.id === tab));
    });
    buildIntervals();
    markSelection();
    if (tab === 'kripto') { state[selected].shown = null; markDirty(selected); } else renderStocks();
    buildFilters();
    renderNews();
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
  let chart, candles, volume, chartToken = 0, haveData = false;
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
      msg.hidden = false;
      msg.textContent = markets ? 'Bu hisse için veri alınamadı.' : 'Hisse verisi yükleniyor…';
      return;
    }
    const rows = stockInterval === '1d' ? dailyBars(m.bars) : m.bars;
    candles.applyOptions({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    candles.setData(rows.map((r) => toCandle(r[0] * 1000, r[1], r[2], r[3], r[4])));
    volume.setData(rows.map((r) => toVolume(r[0] * 1000, r[1], r[4], r[5])));
    const bars = $('chart').clientWidth < 520 ? 60 : 130;
    if (rows.length <= bars) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleLogicalRange({ from: rows.length - bars, to: rows.length + 2 });
    msg.hidden = true;
  }

  async function loadChart() {
    if (!chart) return;
    if (tab === 'tek') { loadStockChart(); return; }
    const token = ++chartToken;
    const sym = selected;
    const msg = $('chart-msg');
    haveData = false;
    try {
      const rows = await binance('/api/v3/klines?symbol=' + sym + 'USDT&interval=' + interval + '&limit=500');
      if (token !== chartToken) return;
      const last = +rows[rows.length - 1][4];
      const d = decimalsFor(last);
      candles.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / Math.pow(10, d) } });
      candles.setData(rows.map((r) => toCandle(r[0], r[1], r[2], r[3], r[4])));
      volume.setData(rows.map((r) => toVolume(r[0], r[1], r[4], r[5])));
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
    candles.update(toCandle(k.t, k.o, k.h, k.l, k.c));
    volume.update(toVolume(k.t, k.o, k.c, k.v));
  }

  // ---------- Canlı akış ----------
  let ws = null, wsHost = 0, retry = 0, lastMsg = 0, reqId = 1, everOpen = false, reconnectTimer = 0;
  const klineStream = () => selected.toLowerCase() + 'usdt@kline_' + interval;
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

  async function loadFutures() {
    const token = ++indToken;
    const sym = selected;
    const pair = sym + 'USDT';
    $('ind-sym').textContent = sym;
    const fresh = () => token === indToken;

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
  const TAB_FILTERS = {
    kripto: ['all', 'conf', 'hot', 'BTC', 'RENDER', 'Makro', 'Regülasyon', 'tr'],
    tek: ['all', 'conf', 'hot', 'AI', 'Teknoloji', 'Makro', 'Regülasyon', 'tr'],
  };
  const COIN_TAGS = ['BTC', 'ETH', 'SOL', 'RENDER', 'XRP', 'BNB', 'DOGE'];
  // Makro haberler iki sekmede de görünür; gerisi sekmenin konusuna göre ayrılır
  function inTab(n) {
    if (n.cat === 'makro') return true;
    if (tab === 'tek') return n.cat === 'teknoloji' || n.tags.includes('AI') || n.tags.includes('Teknoloji');
    return n.cat === 'kripto' || n.tags.some((t) => COIN_TAGS.includes(t));
  }
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
    FILTERS.filter((f) => TAB_FILTERS[tab].includes(f.id)).forEach((f) => {
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
    const base = news.items.filter(inTab);
    const items = base.filter(filter.test);
    list.textContent = '';
    if (!items.length) list.appendChild(el('li', 'empty', 'Son 3 günde bu filtreye uyan haber yok.'));
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
    const recent = base.filter((n) => n.ts >= dayAgo);
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
    const list = (news.events || []).filter(inTab).slice(0, 4);
    if (!list.length) {
      box.appendChild(el('p', 'empty', 'Son 48 saatte bu sekmede yüksek etkili bir olay yok.'));
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

  // ---------- Başlat ----------
  buildUI();
  buildIndexCells();
  initChart();
  applyTab();
  loadNews();
  loadMarkets();
  setInterval(loadNews, 120000);
  setInterval(loadMarkets, 120000);
  setInterval(() => { renderNews(); renderCalendar(); renderNextEvent(); }, 60000);
  loadSnapshot().catch(() => {});
  loadSparks();
  loadFutures();
  loadMA();
  loadAltStrength();
  setInterval(() => { if (!document.hidden && tab === 'kripto') loadFutures(); }, 60000);
  setInterval(loadMA, 1800000);
  setInterval(loadAltStrength, 3600000);
  connect();
  loadGlobal();
  loadFng();
  setInterval(loadGlobal, 120000);
  setInterval(loadSparks, 300000);
  setInterval(loadFng, 1800000);
})();
