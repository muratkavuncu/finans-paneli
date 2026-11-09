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

  // ---------- Biçimlendirme ----------
  const nf = (min, max) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const NF = { 0: nf(0, 0), 1: nf(1, 1), 2: nf(2, 2), 3: nf(3, 3), 4: nf(4, 4), 6: nf(6, 6) };

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

    const tabs = $('intervals');
    INTERVALS.forEach((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.textContent = i.label;
      b.dataset.id = i.id;
      b.addEventListener('click', () => selectInterval(i.id));
      tabs.appendChild(b);
    });
    markSelection();
  }

  function markSelection() {
    COINS.forEach((c) => {
      if (els[c.s].card) els[c.s].card.setAttribute('aria-pressed', String(c.s === selected));
    });
    document.querySelectorAll('#intervals button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.id === interval));
    });
    $('chart-name').textContent = bySym[selected].name;
    $('chart-pair').textContent = selected + '/USDT';
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
    if (sym === selected) {
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

  function drawSpark(svg, values) {
    if (values.length < 2) return;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 31 - ((v - min) / span) * 28]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    const up = values[values.length - 1] >= values[0];
    const color = up ? 'var(--up)' : 'var(--down)';
    const soft = up ? 'var(--up-soft)' : 'var(--down-soft)';
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

  async function loadChart() {
    if (!chart) return;
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
    if (!haveData || d.s !== selected + 'USDT' || k.i !== interval) return;
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

  function setStatus(s) {
    $('status').dataset.state = s;
    $('status-text').textContent = s === 'live' ? 'Canlı' : s === 'down' ? 'Bağlantı koptu, yeniden deneniyor' : 'Bağlanıyor…';
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
    if (lastMsg) $('status-time').textContent = 'son veri ' + new Date(lastMsg).toLocaleTimeString('tr-TR');
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
  }
  function selectInterval(id) {
    if (id === interval) return;
    interval = id;
    save('fp.interval', id);
    markSelection();
    swapKline();
    loadChart();
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
    let legend = '';
    parts.forEach((p, i) => {
      const color = 'var(--c' + (i + 1) + ')';
      const len = Math.max(0, p.v - 0.6); // dilimler arasında ince boşluk
      svg += '<circle cx="21" cy="21" r="15.915" fill="none" stroke="' + color + '" stroke-width="5.5" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (100 - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"/>';
      legend += '<li><i style="background:' + color + '"></i>' + p.label + '<em>%' + NF[1].format(p.v) + '</em></li>';
      acc += p.v;
    });
    $('donut').innerHTML = svg;
    $('legend').innerHTML = legend;
    $('donut-main').textContent = '%' + NF[1].format(pcts.btc);
  }

  const FNG_TR = { 'Extreme Fear': 'Aşırı korku', 'Fear': 'Korku', 'Neutral': 'Nötr', 'Greed': 'Açgözlülük', 'Extreme Greed': 'Aşırı açgözlülük' };
  async function loadFng() {
    try {
      const r = await fetch('https://api.alternative.me/fng/?limit=2');
      if (!r.ok) return;
      const rows = (await r.json()).data;
      const v = +rows[0].value;
      const diff = rows[1] ? v - +rows[1].value : 0;
      $('fng-val').textContent = v;
      $('fng-label').textContent = (FNG_TR[rows[0].value_classification] || rows[0].value_classification) +
        (diff ? ' · dün ' + (diff > 0 ? '+' : '') + diff : '');
      $('fng-needle').style.transform = 'rotate(' + (-90 + v * 1.8) + 'deg)';
    } catch (err) { /* isteğe bağlı gösterge */ }
  }

  // ---------- Başlat ----------
  buildUI();
  initChart();
  loadSnapshot().catch(() => {});
  loadChart();
  loadSparks();
  connect();
  loadGlobal();
  loadFng();
  setInterval(loadGlobal, 120000);
  setInterval(loadSparks, 300000);
  setInterval(loadFng, 1800000);
})();
