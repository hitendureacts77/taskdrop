
class Component extends DCLogic {
  state = {
    theme: 'system', mode: 'worker', tab: 'home', filter: 0, orderTab: 0, radiusOn: true, budgetOn: false, fit: 1, sysDark: false, openTask: null,
    loading: false, sheet: null, quote: 0, swipe: 0, dragging: false,
    startMap: { 'Assemble a wardrobe': true, 'Photograph a flat before I rent it': true },
    startedAt: { 'Assemble a wardrobe': Date.now() - 9678000, 'Photograph a flat before I rent it': Date.now() - 5400000 },
    tick: 0, burst: false, toast: null,
    otp: '', skills: [0, 1, 4], welcomeMode: 'poster', setupMode: 'worker', detailRow: null,
    pillar: 0, draftPrice: 1200, lockTarget: null, sheetBy: null, draftFlag: 0, draftMediaSel: 1, sortLow: true,
    bidPick: 'Tasker 4172', myQuotePick: 0, payPick: 0, promoB: 1, promoD: 1, audienceOn: false, promoteOn: false,
    stars: 5, praise: [0, 1, 3], chatN: 0, reviewed: false, posted: [], from: null,
    doneMap: { 'Photograph a flat before I rent it': 1 },
    balance: 8200, escrow: 4635, clearing: 3600, myBids: [], clock: '1:47'
  };

  fitNow() {
    const h = window.innerHeight || 844;
    this.setState({ fit: Math.max(0.4, Math.min(1, (h - 40) / 844)) });
  }

  componentDidMount() {

    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._onMq = e => this.setState({ sysDark: e.matches });
    this._mq.addEventListener('change', this._onMq);
    this._onRz = () => this.fitNow();
    window.addEventListener('resize', this._onRz);
    this.setState({ sysDark: this._mq.matches });
    this.fitNow();
  }
  componentWillUnmount() {
clearTimeout(this._pending); clearTimeout(this._b); clearTimeout(this._to); clearTimeout(this._ld);
    window.removeEventListener('resize', this._onRz);
    if (this._mq && this._onMq) this._mq.removeEventListener('change', this._onMq);
  }

  flash(msg) { clearTimeout(this._to); this.setState({ toast: msg }); this._to = setTimeout(() => this.setState({ toast: null }), 2200); }
  celebrate(msg) { clearTimeout(this._b); this.setState({ burst: true }); this._b = setTimeout(() => { this.setState({ burst: false }); if (msg) this.flash(msg); }, 900); }

  go(tab) {
    if (tab === this.state.tab) return;
    this.setState({ tab, loading: tab === 'home', sheet: null, from: null });
    if (tab === 'home') { clearTimeout(this._ld); this._ld = setTimeout(() => this.setState({ loading: false }), 620); }
  }

  setMode(mode) {
    if (mode === this.state.mode) return;
    this.setState({ mode, loading: true, filter: 0, sheet: null, openTask: null, orderTab: 0 });
    clearTimeout(this._ld);
    this._ld = setTimeout(() => this.setState({ loading: false }), 560);
  }

  roll(key, to) {
    const from = this.state[key];
    if (from === to) return;
    const t0 = performance.now(), dur = 750;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      this.setState({ [key]: Math.round(from + (to - from) * e) });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  swipeAt(e) {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left - 31) / (r.width - 62)));
  }

  renderVals() {
    const S = this.state;
    const dark = S.theme === 'dark' || (S.theme === 'system' && S.sysDark);
    const T = dark
      ? { pg:'#0E0E0E', bar:'#121212', card:'#151515', fill:'#1A1A1A', thumb:'#1F1F1F', line:'#1C1C1C', line2:'#1F1F1F', line3:'#2C2C2C', ink:'#FFFFFF', sub:'#B4B4B4', mut:'#8A8A8A', dim:'#858585', chev:'#8A8A8A', g:'#0C9E6C', gtext:'#12B77E', onG:'#04150E', gwash:'#12261D', gline:'#1C3B2C', gink:'#9FD9BF', gshadow:'rgba(12,158,108,0.34)', awash:'#1F1509', aline:'#3A2A12', amber:'#E0A85A', blue:'#4A90D9', violet:'#7F77DD', coral:'#E0724A', band:'#062B1E', canvas:'#050505', toast:'#F1F1F1', toastInk:'#16171A' }
      : { pg:'#FFFFFF', bar:'#F7F7F7', card:'#FFFFFF', fill:'#F1F1F1', thumb:'#EDEDED', line:'#E8E8E8', line2:'#E4E4E4', line3:'#D6D6D6', ink:'#16171A', sub:'#4A4A4A', mut:'#5C5C5C', dim:'#6F6F6F', chev:'#9A9A9A', g:'#0C9E6C', gtext:'#0A7A54', onG:'#FFFFFF', gwash:'#EEF8F3', gline:'#C6E7D9', gink:'#0A6E4C', gshadow:'rgba(12,158,108,0.26)', awash:'#FDF4E3', aline:'#F0DEBB', amber:'#8A5A12', blue:'#2A6BAE', violet:'#5B52C4', coral:'#B4512C', band:'#0B3D2C', canvas:'#DEDEDE', toast:'#16171A', toastInk:'#FFFFFF' };

    const vars = {}; Object.keys(T).forEach(k => vars['--' + k] = T[k]);
    const worker = S.mode === 'worker';
    const dOf = t => (S.doneMap && S.doneMap[t]) || 0;
    const sOf = t => !!(S.startMap && S.startMap[t]);
    const curTitle = (S.openTask && S.openTask.title) || (worker ? 'Vintage 35mm film camera' : 'Assemble a wardrobe');
    const curDone = dOf(curTitle);
    const press = { transform: 'scale(0.96)', opacity: 0.9 };
    const cardPress = { transform: 'scale(0.985)' };

    const ICON = {
      home: 'M4 10.6 12 4l8 6.6V20h-5v-6H9v6H4v-9.4Z',
      clip: 'M9 3.6h6v2.8H9zM6.4 5h11.2v15.4H6.4zM9.6 11h5M9.6 15h5',
      wallet: 'M3.5 7.5h17v11h-17zM3.5 10.5h17M16 14h2',
      user: 'M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6ZM12 11.6a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6.3 18.8a6 6 0 0 1 11.4 0',
      search: 'M11 4.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6ZM16.2 16.2 20.5 20.5'
    };
    const nav = [
      { k: 'home', label: 'Home', d: ICON.home },
      { k: 'search', label: 'Search', d: ICON.search },
      { k: 'orders', label: worker ? 'Bids' : 'Requests', d: ICON.clip },
      { k: 'wallet', label: 'Wallet', d: ICON.wallet },
      { k: 'profile', label: 'Profile', d: ICON.user }
    ].map(n => ({
      ...n, c: S.tab === n.k ? T.ink : T.dim,
      scale: S.tab === n.k ? 'translateY(-2px) scale(1.06)' : 'none',
      pick: () => this.go(n.k)
    }));

    const chip = (label, on, pick) => ({ label, pick, ink: on ? T.ink : T.mut, bg: on ? T.gwash : 'transparent', line: on ? T.g : T.line3 });
    const filterLabels = ['Services', 'Goods & products', 'Local help'];
    const filters = filterLabels.map((l, i) => chip(l, S.filter === i, () => this.setState({ filter: i })));

    const workerFeed = [
      { sponsored: true, who: 'Poster 9014', rating: '4.8', whoMeta: '31 requests posted · 3.2 km away', tag: 'PRODUCTS', tagInk: T.violet, title: 'Vintage 35mm film camera', meta: 'Complete by 9 Sep, 6 PM · 12 quotes', price: '₹4,500', hasMedia: true, glyph: '▶', dur: '0:34', by: '9 Sep, 6 PM', amount: 4500, body: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.' },
      { sponsored: false, who: 'Poster 6620', rating: '4.8', whoMeta: '14 requests posted · 1.1 km away', tag: 'SERVICES', tagInk: T.gtext, title: 'Fix leaking kitchen tap', meta: 'Complete by today, 8 PM · 4 quotes', price: '₹600', hasMedia: true, glyph: '▤', dur: null, by: 'today, 8 PM', amount: 600, body: 'Mixer tap drips constantly. Washer probably gone. Tools and part needed.' },
      { sponsored: false, who: 'Poster 4471', rating: '4.6', whoMeta: '7 requests posted · 2.4 km away', tag: 'LOCAL HELP', tagInk: T.blue, title: 'Check the queue at RTO Indiranagar', meta: 'Complete by today, 4 PM · 7 quotes', price: '₹250', hasMedia: false, glyph: '', dur: null, by: 'today, 4 PM', amount: 250, body: 'Walk past and tell me how long the licence renewal line is. Photo helps.' }
    ];
    const posterFeed = [
      { sponsored: true, who: 'Tasker 3315', rating: '4.9', whoMeta: '61 jobs done · 4 km away', tag: 'SERVICES', tagInk: T.gtext, title: 'Bespoke carpentry and joinery', meta: 'Made-to-measure furniture, fittings and repairs', price: '₹1,200', hasMedia: true, glyph: '▤', dur: null, by: null, amount: 1200, body: 'Ten years of joinery. Wardrobes, shelving, alcove units, on-site fitting included.' },
      { sponsored: false, who: 'Tasker 2098', rating: '4.9', whoMeta: '42 jobs done · 2 km away', tag: 'LOCAL HELP', tagInk: T.blue, title: 'Same-day courier runs', meta: 'Documents and small parcels across the city', price: '₹250', hasMedia: false, glyph: '', dur: null, by: null, amount: 250, body: 'Two-wheeler, insulated bag, live location shared through the run.' },
      { sponsored: false, who: 'Tasker 4172', rating: '4.7', whoMeta: '18 jobs done · 5 km away', tag: 'SERVICES', tagInk: T.gtext, title: 'Tap and plumbing repairs', meta: 'Leaks, fittings, bathroom fixes', price: '₹400', hasMedia: true, glyph: '▶', dur: '0:22', by: null, amount: 400, body: 'Licensed plumber. Carry spares for common mixer and cistern faults.' }
    ];
    const raw = worker ? workerFeed : posterFeed;
    const feed = raw.map((c, i) => ({
      ...c, delay: (i * 70) + 'ms',
      line: c.sponsored ? T.g : T.line2,
      priceLabel: worker ? 'THEIR QUOTE' : 'THEIR RATE',
      open: () => this.setState(st => ({ tab: 'taskDetail', from: st.tab, detailRow: c, sheet: null, quote: c.amount })),
      quoteNow: e => { if (e && e.stopPropagation) e.stopPropagation(); this.setState({ sheet: c.title, quote: c.amount }); },
      accept: e => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (worker) { this.setState({ sheet: null }); return this.celebrate('Quote accepted at ' + c.price); }
        this.setState({ sheet: c.title, quote: c.amount, sheetBy: null });
      }
    }));

    const sheet = S.sheet == null ? null : (raw.filter(r => r.title === S.sheet)[0] || (S.detailRow && S.detailRow.title === S.sheet ? S.detailRow : raw[0]));
    const delta = sheet ? S.quote - sheet.amount : 0;

    const bidRows = [
      {
        bucket: 1,
        state: dOf('Vintage 35mm film camera') >= 1 ? 'WORK DONE · AWAITING POSTER' : (sOf('Vintage 35mm film camera') ? 'ACTIVE · TIMER RUNNING' : 'ACCEPTED · SWIPE TO START'),
        dot: sOf('Vintage 35mm film camera') ? T.amber : T.g,
        stateInk: sOf('Vintage 35mm film camera') ? T.amber : T.gtext,
        title: 'Vintage 35mm film camera', price: '₹4,200',
        meta: dOf('Vintage 35mm film camera') >= 1 ? 'Work marked done · poster confirms next' : (sOf('Vintage 35mm film camera') ? 'Task started · timer running' : 'Escrow funded · first to start wins'),
        act: 'start',
        escrow: '₹4,335', who: 'you are working',
        payMeta: '₹4,200 to you · complete by 9 Sep, 5:00 PM'
      },
      { bucket: 2, state: 'PENDING', dot: T.blue, stateInk: T.blue, title: 'Fix leaking kitchen tap', price: '₹550', meta: 'Sent 2 hrs ago · 4 quotes total', act: null },
      { bucket: 0, state: 'QUOTES ON MY SERVICE · 3 NEW', dot: T.violet, stateInk: T.violet, title: 'Bespoke carpentry and joinery', price: '₹1,200', meta: 'Posters sent quotes · lock one to take it', act: 'quotes' },
      { bucket: 3, state: 'NOT SELECTED', dot: T.chev, stateInk: T.mut, title: 'Airport pickup, 6 AM', price: '₹900', meta: 'Another worker started first', act: null }
    ];
    const requestRows = [
      { state: 'OPEN · 12 QUOTES', dot: T.blue, stateInk: T.blue, title: 'Vintage 35mm film camera', price: '₹4,500', meta: 'Complete by 9 Sep, 6:00 PM · tap to compare', act: 'compare', escrow: '₹4,335', who: 'not started', payMeta: '₹4,500 · complete by 9 Sep, 6:00 PM' },
      { state: 'ACTIVE · TIMER RUNNING', dot: T.amber, stateInk: T.amber, title: 'Assemble a wardrobe', price: '₹1,200', meta: 'Tasker 8830 started 2 hrs ago', act: 'active', escrow: '₹1,236', who: 'Tasker 8830 working', payMeta: '₹1,200 · complete by 12 Sep, 2:00 PM' },
      { bucket: 1, state: 'MARKED DONE · CONFIRM TO RELEASE', dot: T.amber, stateInk: T.amber, title: 'Photograph a flat before I rent it', price: '₹450', meta: 'Proof uploaded 1 hr ago · tap to review', act: 'confirm', escrow: '₹463', who: 'Tasker 8830 working', payMeta: '₹450 · complete by 11 Sep, 11:00 AM' },
      { state: 'DONE · RELEASED', dot: T.g, stateInk: T.gtext, title: 'Fix leaking kitchen tap', price: '₹600', meta: 'Confirmed 3 Sep · tap to review the worker', act: 'review' }
    ];
    const allRows = (worker ? bidRows : requestRows).concat(S.myBids.filter(r => r.role === S.mode));
    const tabNames = worker ? ['Listings', 'Accepted', 'Pending', 'Closed'] : ['Open', 'Active', 'Done'];
    const bucket = r => {
      if (typeof r.bucket === 'number') return r.bucket;
      const s = r.state;
      if (worker) {
        if (/LISTING|QUOTES ON MY SERVICE/.test(s)) return 0;
        if (/ACCEPTED|ACTIVE|WORK DONE/.test(s)) return 1;
        if (/PENDING/.test(s)) return 2;
        return 3;
      }
      if (/OPEN|PENDING/.test(s)) return 0;
      if (/ACTIVE/.test(s)) return 1;
      return 2;
    };
    const orderRows = allRows.filter(r => bucket(r) === S.orderTab).map((r, i) => ({
      ...r, delay: (i * 70) + 'ms',
      open: () => {
        if (r.act === 'compare') return this.setState({ tab: 'compare', from: 'orders', bidPick: 'Tasker 4172', openTask: { title: r.title, price: r.price, escrow: r.escrow, who: r.who, payMeta: r.payMeta } });
        if (r.act === 'quotes') return this.setState({ tab: 'myQuotes', from: 'orders', myQuotePick: 0 });
        if (r.act === 'confirm') return this.setState({ tab: 'confirm', from: 'orders', openTask: { title: r.title, price: r.price, escrow: r.escrow, who: r.who, payMeta: r.payMeta } });
        if (r.act === 'review') return this.setState({ tab: 'review', from: 'orders', stars: 5, openTask: { title: r.title, price: r.price, escrow: r.price, who: 'done', payMeta: r.price } });
        const task = { title: r.title, price: r.price, escrow: r.escrow, who: r.who, payMeta: r.payMeta };
        if (r.act === 'start') {
          if (sOf(r.title)) this.setState({ tab: 'active', openTask: task });
          else this.setState({ tab: 'swipe', swipe: 0, openTask: task });
        } else if (r.act === 'active') this.setState({ tab: 'active', openTask: task });
        else this.flash(r.title + ' · ' + r.price);
      }
    }));

    const orderTabs = tabNames.map((label, i) => ({
      label, weight: S.orderTab === i ? 700 : 600,
      ink: S.orderTab === i ? T.ink : T.mut,
      pick: () => this.setState({ orderTab: i })
    }));

    const startedStamp = (S.startedAt || {})[curTitle];
    const liveElapsed = startedStamp ? Math.max(0, Math.floor((Date.now() - startedStamp) / 1000)) : 0;
    const hh = Math.floor(liveElapsed / 3600), mm = Math.floor((liveElapsed % 3600) / 60), ss = liveElapsed % 60;
    const pad = n => String(n).padStart(2, '0');
    const frac = Math.min(1, liveElapsed / 14400);

    const stepDefs = [
      { label: 'Quote accepted', when: '5 Sep', at: 0 },
      { label: 'Escrow funded', when: '5 Sep', at: 0 },
      { label: 'Task started · contacts revealed', when: '11:07 AM', at: 1 },
      { label: 'Work marked done by worker', when: curDone >= 1 ? 'Just now' : 'Pending', at: 2 },
      { label: 'Poster confirms · escrow released', when: curDone >= 2 ? 'Just now' : 'Pending', at: 3 }
    ];
    const reached = curDone >= 2 ? 3 : (curDone >= 1 ? 2 : 1);
    const steps = stepDefs.map(s => ({
      ...s, dot: s.at <= reached ? T.g : T.line3,
      ink: s.at <= reached ? T.mut : T.dim
    }));

    const doneReady = worker ? curDone === 0 : curDone === 1;
    const doneDone = worker ? curDone >= 1 : curDone >= 2;

    const fmt = n => n.toLocaleString('en-IN');

    const fallbackTask = worker
      ? { title: 'Vintage 35mm film camera', price: '₹4,200', escrow: '₹4,326', who: 'you are working', payMeta: '₹4,200 to you · complete by 9 Sep, 5:00 PM' }
      : { title: 'Assemble a wardrobe', price: '₹1,200', escrow: '₹1,236', who: 'Tasker 8830 working', payMeta: '₹1,200 · complete by 12 Sep, 2:00 PM' };
    const task = S.openTask && S.openTask.title ? S.openTask : fallbackTask;
    const taskNum = parseInt(String(task.price).replace(/[^0-9]/g, ''), 10) || 0;
    // TaskDrop takes a flat 20% worker commission on every completed order.
    const releaseNum = Math.round(taskNum * 0.80);
    const escrowNum = parseInt(String(task.escrow).replace(/[^0-9]/g, ''), 10) || 0;

    const fallbackDetail = worker
      ? { who: 'Poster 9014', rating: '4.8', whoMeta: '31 requests posted · 3.2 km away', tag: 'PRODUCTS', tagInk: T.violet, title: 'Vintage 35mm film camera', body: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.', price: '₹4,500', by: '9 Sep, 6 PM', hasMedia: true, glyph: '▶', amount: 4500 }
      : { who: 'Tasker 3315', rating: '4.9', whoMeta: '61 jobs done · 4 km away', tag: 'SERVICES', tagInk: T.gtext, title: 'Bespoke carpentry and joinery', body: 'Ten years of joinery. Wardrobes, shelving, alcove units, on-site fitting included.', price: '₹1,200', by: null, hasMedia: true, glyph: '▤', amount: 1200 };
    const detail = S.detailRow && S.detailRow.title ? S.detailRow : fallbackDetail;

    const compareData = [
      { who: 'Tasker 4172', rating: '4.7', pro: false, meta: '18 jobs · 5 km away', price: '₹4,200', eta: 'by 9 Sep, 6 PM' },
      { who: 'Tasker 2098', rating: '4.9', pro: true, meta: '42 jobs · 2 km away', price: '₹4,500', eta: 'by 9 Sep, 6 PM' },
      { who: 'Tasker 8830', rating: '4.6', pro: false, meta: '9 jobs · 8 km away', price: '₹5,100', eta: 'by 8 Sep, 7 PM' },
      { who: 'Tasker 3315', rating: '4.9', pro: true, meta: '61 jobs · 4 km away', price: '₹5,400', eta: 'by 10 Sep, 12 PM' }
    ];
    const priceOf = r => parseInt(String(r.price).replace(/[^0-9]/g, ''), 10) || 0;
    const compareSorted = compareData.slice().sort((a, b) => S.sortLow ? priceOf(a) - priceOf(b) : parseFloat(b.rating) - parseFloat(a.rating));
    const pickRow = S.lockTarget || compareSorted.filter(r => r.who === S.bidPick)[0] || compareSorted[0];
    const pickNum = priceOf(pickRow);

    const myQuoteData = [
      { who: 'Poster 6620', rating: '4.8', meta: '14 requests posted · 1.1 km away', price: '₹1,400', task: 'Build a fitted alcove shelf, three tiers' },
      { who: 'Poster 9014', rating: '4.8', meta: '31 requests posted · 3.2 km away', price: '₹1,150', task: 'Repair two wardrobe doors and realign hinges' },
      { who: 'Poster 4471', rating: '4.6', meta: '7 requests posted · 2.4 km away', price: '₹980', task: 'Cut and fit a desk top to a bay window' }
    ];

    const draftCopy = (worker
      ? [
          { title: 'Bespoke carpentry and joinery', details: 'Made-to-measure furniture, fittings and repairs. Ten years on the tools, own transport.' },
          { title: 'Vintage camera sourcing', details: 'I track down film bodies and lenses, test every shutter before handover.' },
          { title: 'On-the-ground checks', details: 'Queue checks, price scouting, site visits anywhere in central Bengaluru.' }
        ]
      : [
          { title: 'Assemble a wardrobe', details: 'Flat-pack unit, two doors, all parts and screws present. Tools needed.' },
          { title: 'Vintage 35mm film camera', details: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.' },
          { title: 'Check the queue at RTO Indiranagar', details: 'Walk past and tell me how long the licence renewal line is. A photo helps.' }
        ]
    )[S.pillar];

    const promoBudgets = worker ? [50, 80, 150] : [80, 150, 300];
    const promoDurations = [{ label: '1 day', days: 1 }, { label: '3 days', days: 3 }, { label: '7 days', days: 7 }];
    const reachBase = worker ? [900, 1600] : [1800, 3400];
    const reachScale = S.audienceOn ? 0.55 : 1;
    const reach = reachBase.map(n => Math.round(n * reachScale * (promoBudgets[S.promoB] / promoBudgets[1])).toLocaleString('en-IN'));

    if (S.tab === 'active' && !this._pending) {
      this._pending = setTimeout(() => { this._pending = null; this.setState({ tick: Date.now() }); }, 1000);
    }

    const liveFit = Math.max(0.4, Math.min(1, ((typeof window !== 'undefined' ? window.innerHeight : 844) - 40) / 844));

    return {
      rootVars: vars, press, cardPress,
      clock: S.clock,
      isHome: S.tab === 'home',
      isSearch: S.tab === 'search',
      frameWrap: { width: Math.round(390 * liveFit) + 'px', height: Math.round(844 * liveFit) + 'px', position: 'relative' },
      frameScale: {
        transform: 'scale(' + liveFit + ')', transformOrigin: 'top left',
        position: 'absolute', top: 0, left: 0,
        width: '390px', height: '844px', borderRadius: '30px', overflow: 'hidden',
        background: T.pg, display: 'flex', flexDirection: 'column',
        boxShadow: '0 26px 70px rgba(0,0,0,0.22)', transition: 'background 0.3s ease'
      },
      radiusOn: S.radiusOn,
      budgetOn: S.budgetOn,
      toggleRadius: () => this.setState(s => ({ radiusOn: !s.radiusOn })),
      toggleBudget: () => this.setState(s => ({ budgetOn: !s.budgetOn })),
      radiusSwitch: {
        width: '42px', height: '24px', borderRadius: '999px', padding: '3px', flex: 'none',
        background: S.radiusOn ? T.g : T.line3, display: 'flex',
        justifyContent: S.radiusOn ? 'flex-end' : 'flex-start',
        transition: 'background 0.24s ease, justify-content 0.24s ease', cursor: 'pointer'
      },
      budgetSwitch: {
        width: '42px', height: '24px', borderRadius: '999px', padding: '3px', flex: 'none',
        background: S.budgetOn ? T.g : T.line3, display: 'flex',
        justifyContent: S.budgetOn ? 'flex-end' : 'flex-start',
        transition: 'background 0.24s ease, justify-content 0.24s ease', cursor: 'pointer'
      },
      knobStyle: { width: '18px', height: '18px', borderRadius: '999px', background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' },
      savedSearches: [
        { title: 'Camera gear under ₹6k', meta: 'Products · 12 km · 4 new' },
        { title: 'Weekend moving jobs', meta: 'Services · 8 km · 2 new' },
        { title: 'Local intel, Indiranagar', meta: 'Local Intel · 3 km · no new' }
      ].map((s, i) => ({ ...s, delay: (i * 70) + 'ms', run: () => { this.go('home'); this.flash('Running “' + s.title + '”'); } })),
      applyFilters: () => { this.go('home'); this.flash('34 tasks · Indiranagar' + (S.radiusOn ? ' · 12 km' : '')); },
      isOrders: S.tab === 'orders',
      isWallet: S.tab === 'wallet',
      isProfile: S.tab === 'profile',
      nav,

      modeLabel: worker ? 'Worker' : 'Poster',
      searchHint: worker ? 'Find a task or a service' : 'Find a worker or a service',
      feedTitle: worker ? 'Tasks near you' : 'Workers near you',
      filters,
      loading: S.loading,
      loaded: !S.loading,
      feed,
      skeletons: [0, 1, 2].map(i => {
        const shim = {
          background: 'linear-gradient(90deg,' + T.thumb + ' 0px,' + T.line + ' 60px,' + T.thumb + ' 120px)',
          backgroundSize: '260px 100%',
          animation: 'tdShim 1.15s linear infinite',
          animationDelay: (i * 120) + 'ms',
          borderRadius: '6px'
        };
        return { bar1: { ...shim, height: '13px', width: '52%' }, bar2: { ...shim, height: '17px', width: '84%', marginTop: '13px' }, bar3: { ...shim, height: '13px', width: '38%', marginTop: '13px' } };
      }),
      urgentTitle: worker ? 'Urgent requests' : 'Free right now',
      urgentFeed: (worker
        ? [{ who: 'Poster 2287', rating: '4.9', flag: 'CLOSES IN 3 HRS', title: 'Airport pickup, 6 AM', price: '₹900', amount: 900, whoMeta: '9 requests posted · 6.2 km away', tag: 'SERVICES', tagInk: T.gtext, body: 'Early pickup from Kempegowda, one large suitcase. Cash or UPI on arrival.', by: 'today, 6 AM', hasMedia: false }]
        : [{ who: 'Tasker 5510', rating: '4.8', flag: 'FREE TODAY', title: 'Two-person moving crew', price: '₹1,800', amount: 1800, whoMeta: '27 jobs done · 3.4 km away', tag: 'SERVICES', tagInk: T.gtext, body: 'Van, straps and blankets included. Available from 2 PM today.', by: null, hasMedia: false }]
      ).map((u, i) => ({
        ...u, delay: (i * 70) + 'ms',
        open: () => this.setState(st => ({ tab: 'taskDetail', from: st.tab, detailRow: u, sheet: null, quote: u.amount }))
      })),

      goProfile: () => this.go('profile'),
      goHome: () => this.go('home'),

      ordersTitle: worker ? 'My bids' : 'My requests',
      orderTabs, orderRows,
      ordersEmpty: orderRows.length === 0,
      emptyLine: worker ? 'Quotes you send show up here.' : 'Requests you post show up here.',
      underline: {
        position: 'absolute', bottom: 0, height: '2px', background: T.ink,
        width: 'calc((100% - 40px) / ' + tabNames.length + ')',
        left: 'calc(20px + (100% - 40px) / ' + tabNames.length + ' * ' + S.orderTab + ')',
        transition: 'left 0.3s cubic-bezier(0.2,0.8,0.25,1)'
      },

      walletLabel: worker ? 'Available to withdraw' : 'Wallet balance',
      balance: fmt(S.balance),
      escrow: fmt(S.escrow),
      clearingFmt: fmt(S.clearing),
      // Segmented bar is derived from the live balances, so it always sums to 100%.
      barAvail: { width: (S.balance / (S.balance + S.escrow + S.clearing) * 100).toFixed(1) + '%', background: T.g, transition: 'width 0.7s cubic-bezier(0.3,0.8,0.3,1)' },
      barEscrow: { width: (S.escrow / (S.balance + S.escrow + S.clearing) * 100).toFixed(1) + '%', background: T.amber, transition: 'width 0.7s cubic-bezier(0.3,0.8,0.3,1)' },
      barClearing: { width: (S.clearing / (S.balance + S.escrow + S.clearing) * 100).toFixed(1) + '%', background: T.blue, transition: 'width 0.7s cubic-bezier(0.3,0.8,0.3,1)' },
      ledger: [
        { title: 'Payout received', meta: 'Fix leaking kitchen tap · cleared', amt: '+₹3,600', dot: T.g, ink: T.gtext },
        { title: 'Held in escrow', meta: 'Vintage film camera · task started', amt: '₹4,635', dot: T.amber, ink: T.ink },
        { title: 'Clearing', meta: 'Assemble a wardrobe · 3 days left', amt: '₹3,600', dot: T.blue, ink: T.ink }
      ].map((l, i) => ({ ...l, delay: (i * 70) + 'ms' })),

      roleRating: worker ? '★ 4.9 worker · 18 jobs done' : '★ 4.8 poster · 31 requests',
      modes: [
        { label: 'Post a Request', ink: worker ? T.mut : T.ink, pick: () => this.setMode('poster') },
        { label: 'Find Work', ink: worker ? T.ink : T.mut, pick: () => this.setMode('worker') }
      ],
      modeSlider: {
        position: 'absolute', top: '4px', bottom: '4px', width: 'calc(50% - 4px)',
        left: worker ? 'calc(50%)' : '4px',
        background: T.pg, borderRadius: '9px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        transition: 'left 0.32s cubic-bezier(0.2,0.8,0.25,1)'
      },
      modeNote: worker ? 'You browse tasks and send quotes.' : 'You post requests and pick a worker.',
      themes: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(pair => {
        const on = S.theme === pair[0];
        return { label: pair[1], ink: on ? T.ink : T.mut, bg: on ? T.gwash : 'transparent', line: on ? T.g : T.line3,
          pick: () => this.setState({ theme: pair[0] }) };
      }),
      themeNote: S.theme === 'system' ? ('Following your device · currently ' + (dark ? 'dark' : 'light')) : 'Set by you',
      reviewsLabel: worker ? 'WORKER REVIEWS' : 'POSTER REVIEWS',
      reviews: (worker
        ? [{ who: 'Poster 9014', stars: '5.0', when: '3 Sep', text: 'Sourced exactly what I described and delivered a day early.' },
           { who: 'Poster 6620', stars: '4.8', when: '28 Aug', text: 'Clean work, tidy afterwards, fair on the price.' }]
        : [{ who: 'Tasker 3315', stars: '5.0', when: '4 Sep', text: 'Clear brief, paid into escrow straight away, confirmed fast.' },
           { who: 'Tasker 2098', stars: '4.7', when: '30 Aug', text: 'Reasonable on timings and easy to reach once started.' }]
      ).map((r, i) => ({ ...r, delay: (i * 80) + 'ms' })),

      sheetOpen: !!sheet,
      sheetWho: sheet && sheet.who,
      sheetRating: sheet && sheet.rating,
      sheetWhoMeta: sheet && sheet.whoMeta,
      sheetTitle: sheet && sheet.title,
      sheetBody: sheet && sheet.body,
      sheetPrice: sheet && sheet.price,
      sheetPriceLabel: worker ? 'THEIR QUOTE' : 'THEIR RATE',
      sheetBy: sheet && sheet.by,
      workerSheet: worker,
      sheetNeedsBy: !worker,
      sheetByText: S.sheetBy || 'Pick a date and time',
      sheetByInk: S.sheetBy ? T.ink : T.coral,
      byChips: ['Today, 8:00 PM', 'Tomorrow, 11:00 AM', '12 Sep, 2:00 PM'].map(label => ({
        label,
        ink: S.sheetBy === label ? T.ink : T.mut,
        bg: S.sheetBy === label ? T.gwash : 'transparent',
        line: S.sheetBy === label ? T.g : T.line3,
        pick: () => this.setState({ sheetBy: label })
      })),
      sheetBlocked: !worker && !S.sheetBy,
      sheetCtaStyle: {
        background: (!worker && !S.sheetBy) ? T.fill : T.g,
        color: (!worker && !S.sheetBy) ? T.mut : T.onG,
        textAlign: 'center', fontSize: '16px', fontWeight: 700, padding: '16px',
        borderRadius: '999px', cursor: 'pointer',
        boxShadow: (!worker && !S.sheetBy) ? 'none' : '0 8px 22px ' + T.gshadow,
        transition: 'background 0.25s ease, color 0.25s ease'
      },
      sheetCta: worker
        ? 'Send quote'
        : (!S.sheetBy
            ? 'Set a completion date and time'
            : ((sheet && S.quote === sheet.amount) ? 'Accept and fund escrow' : 'Send counter and fund escrow')),
      sheetNote: worker
        ? 'One quote per task. Contacts stay masked until the task starts.'
        : 'Your quote goes to this worker. They can lock it and start.',
      quoteAmount: fmt(S.quote),
      deltaText: delta === 0 ? 'same as asked' : (delta > 0 ? '+₹' + fmt(delta) + ' above' : '−₹' + fmt(-delta) + ' below'),
      deltaInk: delta === 0 ? T.dim : (delta > 0 ? T.amber : T.gtext),
      quoteUp: () => this.setState(s => ({ quote: s.quote + 50 })),
      quoteDown: () => this.setState(s => ({ quote: Math.max(50, s.quote - 50) })),
      closeSheet: () => this.setState({ sheet: null }),
      sendQuote: () => {
        if (!worker) {
          if (!S.sheetBy) return this.flash('Set a completion date and time first');
          const isAccept = S.quote === sheet.amount;
          return this.setState(st => ({
            sheet: null, tab: 'escrow', from: 'home',
            lockTarget: { who: sheet.who, price: '₹' + fmt(S.quote), title: sheet.title, rating: sheet.rating, by: S.sheetBy, kind: isAccept ? 'accept' : 'counter' }
          }));
        }
        const row = { role: S.mode, bucket: 2, state: 'PENDING', dot: T.blue, stateInk: T.blue, title: sheet.title, price: '₹' + fmt(S.quote), meta: 'Sent just now · awaiting reply', act: null };
        this.setState(s => ({ sheet: null, myBids: s.myBids.concat(row) }));
        this.celebrate('Quote sent · ₹' + fmt(S.quote));
      },

      swipeOpen: S.tab === 'swipe',
      swipeTitle: task.title,
      swipeMeta: task.payMeta,
      swipeHint: S.swipe > 0.9 ? 'Release to start' : 'Slide the handle all the way across.',
      swipeLabelOpacity: 1 - Math.min(1, S.swipe * 1.6),
      swipeGlyph: S.swipe > 0.9 ? '✓' : '→',
      swipeFill: {
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: (12 + S.swipe * 88) + '%', background: T.gwash,
        transition: S.dragging ? 'none' : 'width 0.34s cubic-bezier(0.2,0.8,0.25,1)'
      },
      swipeKnob: {
        width: '50px', height: '50px', borderRadius: '999px', background: T.g,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.onG, fontSize: '19px', fontWeight: 800, position: 'relative', zIndex: 1,
        transform: 'translateX(' + (S.swipe * 272) + 'px)',
        boxShadow: '0 6px 18px ' + T.gshadow,
        transition: S.dragging ? 'none' : 'transform 0.34s cubic-bezier(0.2,0.8,0.25,1)'
      },
      swipeDown: e => { e.currentTarget.setPointerCapture(e.pointerId); this.setState({ dragging: true, swipe: this.swipeAt(e) }); },
      swipeMove: e => { if (this.state.dragging) this.setState({ swipe: this.swipeAt(e) }); },
      swipeUp: e => {
        const done = this.state.swipe > 0.9;
        this.setState({ dragging: false, swipe: done ? 1 : 0 });
        if (done) {
          const t = (this.state.openTask && this.state.openTask.title) || 'Vintage 35mm film camera';
          this.setState(st => ({
            tab: 'active',
            startMap: Object.assign({}, st.startMap, { [t]: true }),
            startedAt: Object.assign({}, st.startedAt, { [t]: Date.now() }),
            doneMap: Object.assign({}, st.doneMap, { [t]: 0 })
          }));
          this.celebrate('Task started · contacts revealed');
        }
      },
      closeSwipe: () => this.setState({ tab: 'orders', swipe: 0 }),

      activeOpen: S.tab === 'active',
      elapsed: pad(hh) + ':' + pad(mm) + ':' + pad(ss),
      ringOffset: Math.round(553 * (1 - frac)),
      activeMeta: task.escrow + ' in escrow · ' + task.who,
      steps,
      revealedName: worker ? 'Arjun Nair' : 'Meera Rao',
      revealedPhone: '+91 98••• ••210 · revealed',
      doneLabel: doneDone
        ? (worker ? 'Waiting for the poster' : 'Escrow released')
        : (worker ? 'Mark work done' : (doneReady ? 'Confirm and release ₹' + fmt(releaseNum) : 'Waiting on the worker')),
      doneNote: worker
        ? 'The poster confirms next. Escrow releases on their confirmation.'
        : (curDone >= 2
            ? 'Funds are on their way to the worker.'
            : (curDone === 1
                ? 'The worker marked this done. Confirming releases escrow to them and cannot be undone.'
                : 'You can confirm once the worker marks the job done.')),
      doneBtn: {
        marginTop: '20px', borderRadius: '999px', padding: '16px', textAlign: 'center',
        fontSize: '16px', fontWeight: 700,
        background: (doneDone || (!worker && !doneReady)) ? T.fill : T.g,
        color: (doneDone || (!worker && !doneReady)) ? T.mut : T.onG,
        boxShadow: (doneDone || (!worker && !doneReady)) ? 'none' : '0 8px 22px ' + T.gshadow,
        cursor: 'pointer', transition: 'background 0.3s ease, color 0.3s ease'
      },
      markDone: () => {
        if (worker) {
          if (curDone >= 1) return this.flash('Already marked done');
          this.setState(st => ({ doneMap: Object.assign({}, st.doneMap, { [curTitle]: 1 }) }));
          this.celebrate('Work marked done');
        } else {
          if (curDone === 0) return this.flash('The worker has not marked it done yet');
          if (curDone >= 2) return;
          this.setState(st => ({ doneMap: Object.assign({}, st.doneMap, { [curTitle]: 2 }) }));
          this.roll('balance', S.balance + releaseNum);
          this.roll('escrow', Math.max(0, S.escrow - escrowNum));
          this.celebrate('Escrow released · ₹' + fmt(releaseNum));
        }
      },
      closeActive: () => this.setState({ tab: 'orders' }),

      // ── auth flow ──
      isSplash: S.tab === 'splash',
      isWelcome: S.tab === 'welcome',
      isSignup: S.tab === 'signup',
      isSetup: S.tab === 'setup',
      toWelcome: () => this.setState({ tab: 'welcome' }),
      toSignup: () => this.setState({ tab: 'signup', otp: '' }),
      toSetup: () => this.setState({ tab: 'setup' }),
      skipAuth: () => this.setState({ tab: 'signup', otp: '' }),
      welcomePick: S.welcomeMode === 'poster' ? 'Poster' : 'Worker',
      welcomeCards: [
        { key: 'poster', glyph: '✎', title: 'Post a Request', sub: 'I need something done or found' },
        { key: 'worker', glyph: '⌕', title: 'Find Work', sub: 'I want to quote on tasks near me' }
      ].map((w, i) => ({
        ...w, delay: (i * 80) + 'ms',
        line: S.welcomeMode === w.key ? T.g : T.line2,
        pick: () => this.setState({ welcomeMode: w.key, setupMode: w.key })
      })),
      otpBoxes: [0, 1, 2, 3, 4, 5].map(i => ({
        v: S.otp[i] || '',
        line: S.otp[i] ? T.ink : T.line3,
        tap: () => this.setState(s => ({ otp: (s.otp + String((i % 9) + 1)).slice(0, 6) }))
      })),
      fillOtp: () => this.setState({ otp: '482173' }),
      otpBtnLabel: S.otp.length === 6 ? 'Verify and continue' : 'Enter the 6-digit code',
      otpBtn: {
        marginTop: '24px', borderRadius: '12px', padding: '16px', textAlign: 'center',
        fontSize: '15px', fontWeight: 700, cursor: 'pointer',
        background: S.otp.length === 6 ? T.g : T.fill,
        color: S.otp.length === 6 ? T.onG : T.mut,
        boxShadow: S.otp.length === 6 ? '0 8px 22px ' + T.gshadow : 'none',
        transition: 'background 0.25s ease, color 0.25s ease'
      },
      verifyOtp: () => {
        if (S.otp.length < 6) return this.flash('Enter all six digits');
        this.setState({ tab: 'setup' });
        this.celebrate('Number verified');
      },
      setupWorker: S.setupMode === 'worker',
      skillChips: ['Sourcing', 'Local intel', 'Carpentry', 'Delivery', 'Repairs', 'Photography', 'Research', 'Errands'].map((label, i) => {
        const on = S.skills.indexOf(i) >= 0;
        return {
          label, ink: on ? T.ink : T.mut, bg: on ? T.gwash : 'transparent', line: on ? T.g : T.line3,
          pick: () => this.setState(s => ({ skills: on ? s.skills.filter(x => x !== i) : (s.skills.length >= 5 ? s.skills : s.skills.concat(i)) }))
        };
      }),
      setupModes: [
        { key: 'poster', label: 'Post a Request', sub: 'Ask for something' },
        { key: 'worker', label: 'Find Work', sub: 'Browse and quote' }
      ].map(m => {
        const on = S.setupMode === m.key;
        return { ...m, bg: on ? T.gwash : T.fill, line: on ? T.g : T.line3, ink: on ? T.ink : T.mut, pick: () => this.setState({ setupMode: m.key }) };
      }),
      finishSetup: () => {
        this.setState({ tab: 'home', mode: S.setupMode, loading: true, orderTab: 0 });
        clearTimeout(this._ld);
        this._ld = setTimeout(() => this.setState({ loading: false }), 620);
        this.celebrate('Welcome to TaskDrop');
      },

      // ── create ──
      isCreate: S.tab === 'create',
      isPostDetails: S.tab === 'postDetails',
      closeOverlay: () => this.setState(s => ({ tab: s.from || 'home', from: null, swipe: 0 })),
      createTitle: worker ? 'What do you offer?' : 'What do you need?',
      createSub: worker
        ? 'Pick a pillar. Posters find your listing through it.'
        : 'Pick a pillar. It decides who sees your request first.',
      pillarCards: [
        { glyph: '⚒', title: 'Services', sub: worker ? 'Hands-on work you can do for others' : 'Repairs, moving, errands, anything hands-on', stat: '412 open · avg ₹1,450' },
        { glyph: '◈', title: 'Products', sub: worker ? 'Goods you can source or hunt down' : 'Goods to source, hunt down or buy for you', stat: '86 open · avg ₹5,200' },
        { glyph: '◉', title: 'Local Intel', sub: worker ? 'On-the-ground checks near you' : 'Answers only a local would know', stat: '54 open · avg ₹600' }
      ].map((p, i) => ({
        ...p, delay: (i * 70) + 'ms',
        bg: S.pillar === i ? T.gwash : T.card,
        line: S.pillar === i ? T.g : T.line2,
        pick: () => this.setState({ pillar: i, tab: 'postDetails', from: 'create' })
      })),
      backToCreate: () => this.setState({ tab: 'create', from: 'home' }),
      pillarLabel: ['SERVICES', 'PRODUCTS', 'LOCAL INTEL'][S.pillar],
      draftTitle: draftCopy.title,
      draftDetails: draftCopy.details,
      draftAmountLabel: worker ? 'YOUR RATE' : 'BENCHMARK',
      showFlags: !worker,
      showDeadline: !worker,
      deadlineHint: 'Required · workers quote against this deadline.',
      draftMedia: [
        { key: 0, glyph: '—', label: 'None' },
        { key: 1, glyph: '▤', label: 'Photo' },
        { key: 2, glyph: '▶', label: 'Video' }
      ].map(m => {
        const on = S.draftMediaSel === m.key;
        return {
          ...m, bg: on ? T.gwash : T.thumb,
          border: '1px solid ' + (on ? T.g : 'transparent'),
          ink: on ? T.gtext : T.chev,
          tap: () => this.setState({ draftMediaSel: m.key })
        };
      }),
      draftPrice: fmt(S.draftPrice),
      draftUp: () => this.setState(s => ({ draftPrice: s.draftPrice + 100 })),
      draftDown: () => this.setState(s => ({ draftPrice: Math.max(100, s.draftPrice - 100) })),
      draftFlags: ['None', 'Urgent', 'Unique'].map((label, i) => {
        const on = S.draftFlag === i;
        const hue = i === 1 ? T.coral : (i === 2 ? T.violet : T.line3);
        return { label, ink: on ? (i === 0 ? T.ink : hue) : T.mut, line: on ? hue : T.line3, bg: on ? T.fill : 'transparent', pick: () => this.setState({ draftFlag: i }) };
      }),
      publishLabel: S.promoteOn ? 'Publish & promote' : (worker ? 'Publish listing' : 'Post request'),
      publishPost: () => {
        const row = {
          role: S.mode, bucket: 0,
          state: worker ? 'LIVE LISTING · 0 QUOTES' : 'OPEN · 0 QUOTES',
          dot: T.blue, stateInk: T.blue,
          title: draftCopy.title,
          price: '₹' + fmt(S.draftPrice),
          meta: 'Posted just now · Indiranagar', act: null
        };
        this.setState(s => ({ tab: S.promoteOn ? 'promote' : 'orders', from: S.promoteOn ? 'orders' : null, orderTab: 0, myBids: s.myBids.concat(row) }));
        this.celebrate(S.promoteOn ? 'Published · nudge your placement' : (worker ? 'Listing published' : 'Request posted'));
      },
      promoteOn: S.promoteOn,
      promoteLabel: worker ? 'Promote my service' : 'Promote my task',
      promoteNote: S.promoteOn ? 'Will boost right after you publish. Pause or stop any time.' : 'Reach more people. Pause or stop any time.',
      togglePromote: () => this.setState(s => ({ promoteOn: !s.promoteOn })),
      promoteTrack: {
        width: '42px', height: '24px', borderRadius: '999px', padding: '3px', flex: 'none',
        background: S.promoteOn ? T.g : T.line3, display: 'flex', alignItems: 'center',
        cursor: 'pointer', transition: 'background 0.24s ease'
      },
      promoteKnob: {
        width: '18px', height: '18px', borderRadius: '999px', background: '#FFFFFF',
        transform: S.promoteOn ? 'translateX(18px)' : 'none',
        transition: 'transform 0.24s cubic-bezier(0.2,0.8,0.25,1)'
      },

      // ── task detail ──
      isTaskDetail: S.tab === 'taskDetail',
      detailWho: detail.who,
      detailRating: detail.rating,
      detailWhoMeta: detail.whoMeta,
      detailTag: detail.tag,
      detailTagInk: detail.tagInk,
      detailTitle: detail.title,
      detailBody: detail.body,
      detailHasMedia: !!detail.hasMedia,
      detailGlyph: detail.glyph || '▤',
      detailPrice: detail.price,
      detailPriceLabel: worker ? 'THEIR QUOTE' : 'THEIR RATE',
      detailBy: detail.by || (worker ? 'set by the poster' : 'you set it on engage'),
      detailRows: (() => {
        const parts = String(detail.whoMeta || '').split(' · ');
        const record = parts[0] || '';
        const distance = parts[1] || 'nearby';
        return [
          { label: worker ? 'Requests posted' : 'Jobs completed', value: (record.match(/\d[\d,]*/) || ['—'])[0] + ' · ★ ' + detail.rating },
          { label: 'Distance', value: distance }
        ];
      })(),
      detailCta: worker ? 'Send a quote' : 'Send my quote',
      openQuoteSheet: () => this.setState({ sheet: detail.title, quote: detail.amount || S.quote }),
      sharePost: () => this.flash('Share link copied'),

      // ── compare quotes ──
      isCompare: S.tab === 'compare',
      compareState: 'OPEN · 12 QUOTES',
      compareTitle: task.title,
      compareBenchLabel: 'BENCHMARK',
      compareBench: task.price,
      compareBy: '9 Sep, 6 PM',
      compareListLabel: 'INCOMING QUOTES',
      sortLabel: S.sortLow ? 'lowest' : 'rating',
      toggleSort: () => this.setState(s => ({ sortLow: !s.sortLow })),
      compareRows: compareSorted.map((b, i) => ({
        ...b, delay: (i * 70) + 'ms',
        selected: b.who === pickRow.who,
        bg: b.who === pickRow.who ? T.gwash : T.card,
        line: b.who === pickRow.who ? T.g : T.line2,
        pick: () => this.setState({ bidPick: b.who })
      })),
      lockLabel: 'Lock quote · ' + pickRow.price,
      compareNote: 'Names and contacts unmask when the task starts.',
      toEscrow: () => this.setState({ tab: 'escrow' }),
      backToCompare: () => this.setState(st => ({ tab: st.lockTarget ? (st.from || 'home') : 'compare', lockTarget: null })),

      // ── escrow ──
      isEscrow: S.tab === 'escrow',
      escrowTotal: fmt(Math.round(pickNum * 1.03)),
      escrowRows: [
        { label: (S.lockTarget ? (S.lockTarget.kind === 'accept' ? 'Accepted rate · ' : 'Your counter · ') : 'Locked quote · ') + pickRow.who, value: '₹' + fmt(pickNum), ink: T.mut, weight: 600 },
        { label: 'Poster fee · 3%', value: '₹' + fmt(Math.round(pickNum * 0.03)), ink: T.mut, weight: 600 },
        { label: 'Complete by', value: (S.lockTarget && S.lockTarget.by) || '9 Sep, 6:00 PM', ink: T.mut, weight: 600 },
        { label: 'Total held', value: '₹' + fmt(Math.round(pickNum * 1.03)), ink: T.ink, weight: 800 }
      ],
      payMethods: [
        { label: 'UPI · 8721' }, { label: 'Card · 4412' }
      ].map((p, i) => {
        const on = S.payPick === i;
        return { ...p, line: on ? T.ink : T.line3, bg: on ? T.fill : 'transparent', ink: on ? T.ink : T.mut, weight: on ? 700 : 500, pick: () => this.setState({ payPick: i }) };
      }),
      payEscrow: () => {
        const held = Math.round(pickNum * 1.03);
        this.roll('escrow', S.escrow + held);
        if (S.lockTarget) {
          const row = {
            role: 'poster', bucket: 0, state: 'LOCKED · WORKER TO START',
            dot: T.g, stateInk: T.gtext, title: S.lockTarget.title, price: S.lockTarget.price,
            meta: 'Escrow funded · by ' + (S.lockTarget.by || '9 Sep, 6:00 PM') + ' · ' + S.lockTarget.who + ' starts next', act: null
          };
          this.setState(st => ({ tab: 'orders', from: null, orderTab: 0, lockTarget: null, myBids: st.myBids.concat(row) }));
        } else {
          this.setState({ tab: 'orders', from: null, orderTab: 1 });
        }
        this.celebrate('₹' + fmt(held) + ' held in escrow · locked');
      },

      // ── quotes on my service ──
      isMyQuotes: S.tab === 'myQuotes',
      myQuoteRows: myQuoteData.map((q, i) => ({
        ...q, delay: (i * 70) + 'ms',
        selected: S.myQuotePick === i,
        bg: S.myQuotePick === i ? T.gwash : T.card,
        line: S.myQuotePick === i ? T.g : T.line2,
        pick: () => this.setState({ myQuotePick: i })
      })),
      lockMyLabel: 'Lock quote · ' + (myQuoteData[S.myQuotePick] || myQuoteData[0]).price,
      lockMyQuote: () => {
        const q = myQuoteData[S.myQuotePick] || myQuoteData[0];
        this.setState({
          tab: 'swipe', swipe: 0,
          openTask: { title: q.task, price: q.price, escrow: q.price, who: 'you are working', payMeta: q.price + ' to you · complete by 14 Sep, 5:00 PM' },
          doneMap: Object.assign({}, S.doneMap, { [q.task]: 0 })
        });
        this.celebrate('Quote locked · escrow funded');
      },

      // ── confirm work ──
      isConfirm: S.tab === 'confirm',
      proofNote: 'Photographed every room, the balcony and the meter. Full set uploaded.',
      releaseRows: [
        { label: 'Held in escrow', value: task.escrow },
        { label: 'Releases to the worker', value: '₹' + fmt(releaseNum) },
        { label: 'Auto-confirms in', value: '2 days 4 hrs' }
      ],
      releaseAmount: fmt(releaseNum),
      confirmRelease: () => {
        this.roll('balance', S.balance + releaseNum);
        this.roll('escrow', Math.max(0, S.escrow - escrowNum));
        this.setState(st => ({ tab: 'review', from: 'orders', doneMap: Object.assign({}, st.doneMap, { [task.title]: 2 }) }));
        this.celebrate('Escrow released · ₹' + fmt(releaseNum));
      },
      requestChanges: () => this.flash('Change request sent to the worker'),
      openDispute: () => this.flash('A dispute case was opened'),

      // ── chat ──
      isChat: S.tab === 'chat',
      chatEscrow: task.escrow + ' · in escrow',
      chatDraft: S.chatN > 0 ? 'Message' : 'Type a message',
      openActiveFromChat: () => this.setState({ tab: 'active', from: 'orders' }),
      chatMsgs: [
        { who: 'them', text: 'I have the K1000 tested and ready. Want a photo of the shutter curtain?' },
        { who: 'me', text: 'Yes please, and the lens front element.' },
        { who: 'them', kind: 'image' },
        { who: 'them', kind: 'voice' }
      ].concat(Array.from({ length: S.chatN }, () => ({ who: 'me', text: 'On my way, about ten minutes out.' }))).map(m => ({
        text: m.text,
        isImage: m.kind === 'image',
        isVoice: m.kind === 'voice',
        isText: !m.kind,
        bubble: m.kind === 'image'
          ? { alignSelf: 'flex-start', width: '158px', height: '108px', borderRadius: '16px', background: T.thumb, color: T.chev, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', animation: 'tdIn 0.28s ease-out both' }
          : m.kind === 'voice'
          ? { alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '11px', background: T.fill, borderRadius: '999px', padding: '11px 16px', animation: 'tdIn 0.28s ease-out both' }
          : m.who === 'me'
          ? { alignSelf: 'flex-end', maxWidth: '76%', background: T.g, color: T.onG, borderRadius: '16px 16px 5px 16px', padding: '11px 14px', fontSize: '14px', fontWeight: 500, lineHeight: 1.45, animation: 'tdIn 0.28s ease-out both' }
          : { alignSelf: 'flex-start', maxWidth: '76%', background: T.fill, color: T.ink, borderRadius: '16px 16px 16px 5px', padding: '11px 14px', fontSize: '14px', lineHeight: 1.45, animation: 'tdIn 0.28s ease-out both' }
      })),
      sendChat: () => this.setState(s => ({ chatN: s.chatN + 1 })),

      // ── review ──
      isReview: S.tab === 'review',
      reviewWho: worker ? 'the poster' : 'the worker',
      reviewTask: task.title + ' · ' + task.price,
      starRow: [1, 2, 3, 4, 5].map(n => ({
        c: n <= S.stars ? T.g : T.line3,
        scale: n <= S.stars ? 'scale(1.06)' : 'scale(1)',
        pick: () => this.setState({ stars: n })
      })),
      reviewWord: ['Poor', 'Fair', 'Good', 'Great', 'Excellent'][S.stars - 1] || 'Excellent',
      praiseChips: ['On time', 'Great communication', 'Fair price', 'Went the extra mile', 'Careful work'].map((label, i) => {
        const on = S.praise.indexOf(i) >= 0;
        return {
          label, ink: on ? T.ink : T.mut, bg: on ? T.gwash : 'transparent', line: on ? T.g : T.line3,
          pick: () => this.setState(s => ({ praise: on ? s.praise.filter(x => x !== i) : s.praise.concat(i) }))
        };
      }),
      submitReview: () => {
        this.setState({ tab: 'orders', orderTab: 2, reviewed: true });
        this.celebrate('Review posted');
      },

      // ── promote ──
      isPromote: S.tab === 'promote',
      promoTitle: worker ? 'Promote this service' : 'Promote this task',
      promoSubject: worker ? 'Bespoke carpentry and joinery' : 'Vintage 35mm film camera',
      promoSubjectMeta: worker ? '₹1,200 rate · 61 jobs done' : '₹4,500 · open · 12 quotes',
      promoBudget: fmt(promoBudgets[S.promoB]),
      promoDays: promoDurations[S.promoD].label,
      promoTotal: fmt(promoBudgets[S.promoB] * promoDurations[S.promoD].days),
      budgetChips: promoBudgets.map((v, i) => ({
        label: '₹' + fmt(v),
        ink: S.promoB === i ? T.ink : T.mut,
        bg: S.promoB === i ? T.gwash : 'transparent',
        line: S.promoB === i ? T.g : T.line3,
        pick: () => this.setState({ promoB: i })
      })),
      durationChips: promoDurations.map((d, i) => ({
        label: d.label,
        ink: S.promoD === i ? T.ink : T.mut,
        bg: S.promoD === i ? T.gwash : 'transparent',
        line: S.promoD === i ? T.g : T.line3,
        pick: () => this.setState({ promoD: i })
      })),
      audienceOn: S.audienceOn,
      audienceNote: S.audienceOn ? 'Narrowing who sees it' : 'Off · everyone in your city',
      audienceWho: worker ? 'Posters within 15 km' : 'Workers within 12 km',
      audienceNiche: worker ? 'Services' : 'Services · Products',
      toggleAudience: () => this.setState(s => ({ audienceOn: !s.audienceOn })),
      audienceTrack: {
        width: '42px', height: '24px', borderRadius: '999px', padding: '3px',
        background: S.audienceOn ? T.g : T.line3, display: 'flex', alignItems: 'center',
        cursor: 'pointer', transition: 'background 0.24s ease'
      },
      audienceKnob: {
        width: '18px', height: '18px', borderRadius: '999px', background: '#FFFFFF',
        transform: S.audienceOn ? 'translateX(18px)' : 'none',
        transition: 'transform 0.24s cubic-bezier(0.2,0.8,0.25,1)'
      },
      reachText: reach[0] + ' – ' + reach[1],
      reachWho: (worker ? 'posters' : 'workers') + ' per day' + (S.audienceOn ? ' in your radius' : ' across your city'),
      startCampaign: () => {
        this.setState({ tab: worker ? 'home' : 'orders' });
        this.celebrate('Campaign live · sponsored placement');
      },

      // ── verified pro ──
      isPro: S.tab === 'pro',
      proPerks: [
        { title: 'Verified badge on every quote', sub: 'Posters see you passed ID and skill checks' },
        { title: 'Your quotes stand out', sub: 'Pro quotes are marked in the compare list' },
        { title: 'Priority in search', sub: 'Ranked above unverified taskers on matching tasks' },
        { title: 'Faster clearing', sub: 'Payouts clear in 2 days instead of 7' }
      ],
      proSteps: [
        { num: '✓', label: 'Government ID', state: 'Verified', bg: T.g, line: T.g, numInk: T.onG, ink: T.mut, stateInk: T.gtext },
        { num: '2', label: 'Selfie match', state: 'In review', bg: 'transparent', line: T.amber, numInk: T.amber, ink: T.ink, stateInk: T.amber },
        { num: '3', label: 'Skill proof · 3 completed jobs', state: '1 of 3', bg: 'transparent', line: T.line3, numInk: T.dim, ink: T.ink, stateInk: T.dim }
      ],
      continuePro: () => this.flash('Selfie match is still in review'),

      // ── withdraw ──
      isWithdraw: S.tab === 'withdraw',
      withdrawRows: [
        { label: 'Available', value: '₹' + fmt(S.balance), ink: T.mut, weight: 600 },
        { label: 'Transfer fee', value: 'Free', ink: T.mut, weight: 600 },
        { label: 'You receive', value: '₹' + fmt(S.balance), ink: T.ink, weight: 800 }
      ],
      doWithdraw: () => {
        const amt = S.balance;
        this.roll('balance', 0);
        this.setState({ tab: 'wallet' });
        this.celebrate('₹' + fmt(amt) + ' on its way');
      },

      profileRows: (worker
        ? [
            { glyph: '◈', label: 'Quotes on my service', go: 'myQuotes' },
            { glyph: '✦', label: 'Promote my service', go: 'promote' },
            { glyph: '✓', label: 'Get Verified Pro', go: 'pro' },
            { glyph: '▦', label: 'Earnings and payouts', go: 'withdraw' },
            { glyph: '↪', label: 'Sign out', go: 'splash' }
          ]
        : [
            { glyph: '▤', label: 'My requests', go: 'orders' },
            { glyph: '✦', label: 'Promote a request', go: 'promote' },
            { glyph: '✓', label: 'Get Verified Pro', go: 'pro' },
            { glyph: '▦', label: 'Wallet and payments', go: 'wallet' },
            { glyph: '↪', label: 'Sign out', go: 'splash' }
          ]
      ).map(p => ({
        ...p,
        ink: p.go === 'splash' ? T.coral : T.ink,
        tap: () => this.setState({ tab: p.go, from: 'profile', orderTab: 0 })
      })),

      showProof: worker,
      proofHint: curDone >= 1 ? 'Proof sent to the poster with your completion.' : 'Add proof before you mark the work done.',
      proofTiles: [
        { key: 0, glyph: '▤', label: '', bg: T.thumb, border: 'none', ink: T.chev, cursor: 'default', tap: () => {} },
        { key: 1, glyph: '▤', label: '', bg: T.thumb, border: 'none', ink: T.chev, cursor: 'default', tap: () => {} },
        { key: 2, glyph: '+', label: 'Add', bg: 'transparent', border: '1px dashed ' + T.line3, ink: T.dim, cursor: 'pointer', tap: () => this.flash('Proof photo added') }
      ],

      // ── entry points ──
      goCreate: () => this.setState(st => ({ tab: 'create', from: st.tab })),
      goPromote: () => this.setState(st => ({ tab: 'promote', from: st.tab })),
      goPro: () => this.setState(st => ({ tab: 'pro', from: st.tab })),
      goWithdraw: () => this.setState(st => ({ tab: 'withdraw', from: st.tab })),
      goChat: () => this.setState(st => ({ tab: 'chat', from: st.tab })),
      goReview: () => this.setState(st => ({ tab: 'review', from: st.tab })),
      signOut: () => this.setState({ tab: 'splash', otp: '' }),
      createLabel: worker ? 'List a service' : 'Post a request',

      burst: S.burst,
      toast: S.toast
    };
  }
}
