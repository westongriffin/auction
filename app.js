// Brinkley Auctions — frontend

const state = {
  settings: {},
  auctions: [],
  bidders: [],
  consignors: [],
  registrations: [],
  lots: [],
  bids: [],
  invoices: [],
  settlements: [],
  view: 'dashboard',
  lotFilterAuction: '',
  lotFilterStatus: '',
  lotSearch: '',
  bidderSearch: '',
  checkinAuction: '',
  clerkAuction: '',
  clerkPos: 0,
  clerkRecent: [],
  cashierAuction: '',
  reportAuction: '',
  reportFrom: '',
  reportTo: '',
  report: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => (s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString() : '—');

// ---------- api + auth ----------

let authToken = localStorage.getItem('brinkley-token') || '';

// Demo mode: on static hosting (e.g. GitHub Pages) there is no server, so the
// whole system runs in the browser via core.js against localStorage.
let demoCore = null;

function initDemo() {
  const persist = {
    load() {
      try { return JSON.parse(localStorage.getItem('brinkley-demo-db')); } catch { return null; }
    },
    save(d) {
      try { localStorage.setItem('brinkley-demo-db', JSON.stringify(d)); } catch { /* storage full/blocked — keep going in memory */ }
    },
  };
  if (!persist.load() && window.BRINKLEY_DEMO_DB) persist.save(window.BRINKLEY_DEMO_DB);
  demoCore = createBrinkleyCore(persist);
  $('#demo-banner').classList.remove('hidden');
}

$('#demo-reset').addEventListener('click', () => {
  if (!confirm('Reset the demo to its original sample data?')) return;
  localStorage.removeItem('brinkley-demo-db');
  location.reload();
});

function demoApi(method, path, body) {
  const url = new URL(path, location.origin);
  const result = demoCore.dispatch(method, url.pathname, body || {}, Object.fromEntries(url.searchParams));
  if (!result) throw new Error('No such endpoint');
  if (result.status >= 400) throw new Error(result.body.error || 'Request failed');
  return JSON.parse(JSON.stringify(result.body));
}

async function api(method, path, body) {
  if (demoCore) return demoApi(method, path, body);
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { 'X-Auth': authToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Login required');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showLogin() {
  $('#login-overlay').classList.remove('hidden');
  $('#login-form').elements.pin.focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = e.target.elements.pin.value;
  try {
    const { token } = await (await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })).json().then((d) => {
      if (d.error) throw new Error(d.error);
      return d;
    });
    authToken = token;
    localStorage.setItem('brinkley-token', token);
    $('#login-overlay').classList.add('hidden');
    e.target.reset();
    $('#login-error').textContent = '';
    refresh();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

async function loadAll() {
  [state.settings, state.auctions, state.bidders, state.consignors, state.registrations,
    state.lots, state.bids, state.invoices, state.settlements] = await Promise.all([
    api('GET', '/api/settings'),
    api('GET', '/api/auctions'),
    api('GET', '/api/bidders'),
    api('GET', '/api/consignors'),
    api('GET', '/api/registrations'),
    api('GET', '/api/lots'),
    api('GET', '/api/bids'),
    api('GET', '/api/invoices'),
    api('GET', '/api/settlements'),
  ]);
}

// ---------- toast ----------

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

async function run(fn, successMsg) {
  try {
    await fn();
    await refresh();
    if (successMsg) toast(successMsg);
  } catch (err) {
    if (err.message !== 'Login required') toast(err.message, true);
  }
}

// ---------- modal ----------

function openModal({ title, fields, submitLabel = 'Save', onSubmit }) {
  $('#modal-title').textContent = title;
  $('#modal-submit').textContent = submitLabel;
  const wrap = $('#modal-fields');
  wrap.innerHTML = '';
  for (const f of fields) {
    const label = document.createElement('label');
    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      for (const opt of f.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        input.appendChild(o);
      }
    } else if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      label.className = 'check';
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      if (f.step) input.step = f.step;
      if (f.min !== undefined) input.min = f.min;
      if (f.placeholder) input.placeholder = f.placeholder;
    }
    input.name = f.name;
    if (f.required) input.required = true;
    if (f.type === 'checkbox') {
      input.checked = !!f.value;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + f.label));
    } else {
      label.textContent = f.label;
      if (f.value !== undefined && f.value !== null) input.value = f.value;
      label.appendChild(input);
    }
    wrap.appendChild(label);
  }
  const modal = $('#modal');
  const form = $('#modal-form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    }
    modal.close();
    onSubmit(values);
  };
  modal.showModal();
}
$('#modal-cancel').addEventListener('click', () => $('#modal').close());

// ---------- lookups ----------

const auctionById = (id) => state.auctions.find((a) => a.id === id);
const bidderById = (id) => state.bidders.find((b) => b.id === id);
const consignorById = (id) => state.consignors.find((c) => c.id === id);
const regById = (id) => state.registrations.find((r) => r.id === id);
const lotById = (id) => state.lots.find((l) => l.id === id);
const regsFor = (auctionId) => state.registrations.filter((r) => r.auctionId === auctionId);
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const lotAmount = (l) => Math.round((l.hammerPrice || 0) * (l.quantity || 1) * 100) / 100;

function winnerLabel(lot) {
  const reg = regById(lot.winningRegId);
  const b = reg ? bidderById(reg.bidderId) : null;
  return reg ? `#${reg.paddle} ${b ? b.name : ''}` : '—';
}

function effPremium(a) { return a && a.premiumPct !== null && a.premiumPct !== undefined ? a.premiumPct : state.settings.buyersPremiumPct; }
function effTax(a) { return a && a.taxPct !== null && a.taxPct !== undefined ? a.taxPct : state.settings.taxPct; }

function auctionOptions(sel, { placeholder = null, preferLive = false } = {}) {
  const opts = state.auctions.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
  sel.innerHTML = (placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : '') + opts;
  return (current) => {
    if (current && state.auctions.some((a) => a.id === current)) { sel.value = current; return current; }
    if (placeholder !== null) { sel.value = ''; return ''; }
    const live = preferLive ? state.auctions.find((a) => a.status === 'live') : null;
    const pick = live ? live.id : (state.auctions[0] ? state.auctions[0].id : '');
    sel.value = pick;
    return pick;
  };
}

// ---------- global search ----------

let searchActions = [];

function globalResults(qRaw) {
  const q = qRaw.trim().toLowerCase();
  if (q.length < 2) return [];
  const match = (s) => String(s || '').toLowerCase().includes(q);
  const hits = [];

  const padNum = Number(q.replace('#', ''));
  if (Number.isInteger(padNum) && padNum > 0) {
    for (const r of state.registrations.filter((x) => x.paddle === padNum)) {
      const b = bidderById(r.bidderId), a = auctionById(r.auctionId);
      hits.push({ group: 'Paddles', label: `#${r.paddle} — ${b ? b.name : '?'}`,
        sub: a ? a.title : '', act: () => openBidderDetail(r.bidderId) });
    }
  }
  for (const b of state.bidders) {
    if (match(b.name) || match(b.phone) || match(b.email)) {
      hits.push({ group: 'Bidders', label: b.name,
        sub: [b.phone, b.email].filter(Boolean).join(' · '), act: () => openBidderDetail(b.id) });
    }
  }
  for (const c of state.consignors) {
    if (match(c.name) || match(c.code)) {
      hits.push({ group: 'Consignors', label: `${c.code} ${c.name}`,
        sub: [c.phone, c.email].filter(Boolean).join(' · '), act: () => openConsignorDetail(c.id) });
    }
  }
  for (const l of state.lots) {
    if (match(l.title) || match(l.category) || match(l.description) || String(l.lotNumber) === q) {
      const a = auctionById(l.auctionId);
      hits.push({ group: 'Lots', label: `Lot ${l.lotNumber} — ${l.title}`,
        sub: `${a ? a.title : ''} · ${l.status}${l.status === 'sold' ? ' ' + money(lotAmount(l)) : ''}`,
        act: () => {
          state.view = 'lots';
          state.lotFilterAuction = l.auctionId;
          state.lotFilterStatus = '';
          state.lotSearch = l.title;
          refresh();
        } });
    }
  }
  for (const i of state.invoices) {
    const b = bidderById(i.bidderId);
    if (match('inv-' + i.number) || String(i.number) === q) {
      hits.push({ group: 'Invoices', label: `INV-${i.number} — ${b ? b.name : '?'}`,
        sub: `${money(i.total)} · ${i.status}`, act: () => openBidderDetail(i.bidderId) });
    }
  }
  for (const s of state.settlements) {
    const c = consignorById(s.consignorId);
    if (match('st-' + s.number) || String(s.number) === q) {
      hits.push({ group: 'Settlements', label: `ST-${s.number} — ${c ? c.name : '?'}`,
        sub: `${money(s.netDue)} · ${s.status}`, act: () => openConsignorDetail(s.consignorId) });
    }
  }
  for (const a of state.auctions) {
    if (match(a.title) || match(a.location)) {
      hits.push({ group: 'Auctions', label: a.title,
        sub: `${fmtDate(a.date)} · ${a.status}`, act: () => { state.view = 'auctions'; refresh(); } });
    }
  }
  return hits.slice(0, 20);
}

function renderSearchResults(hits) {
  const box = $('#search-results');
  searchActions = hits.map((h) => h.act);
  if (!hits.length) {
    box.classList.add('hidden');
    return;
  }
  let html = '', lastGroup = '';
  hits.forEach((h, idx) => {
    if (h.group !== lastGroup) {
      html += `<div class="search-group">${h.group}</div>`;
      lastGroup = h.group;
    }
    html += `<button type="button" class="search-item" data-idx="${idx}">
      <span>${esc(h.label)}</span><span class="sub">${esc(h.sub)}</span></button>`;
  });
  box.innerHTML = html;
  box.classList.remove('hidden');
}

const gsInput = $('#global-search');
gsInput.addEventListener('input', () => renderSearchResults(globalResults(gsInput.value)));
gsInput.addEventListener('focus', () => renderSearchResults(globalResults(gsInput.value)));
gsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#search-results').classList.add('hidden');
  if (e.key === 'Enter' && searchActions.length) {
    e.preventDefault();
    $('#search-results').classList.add('hidden');
    gsInput.blur();
    searchActions[0]();
  }
});
$('#search-results').addEventListener('mousedown', (e) => {
  const item = e.target.closest('.search-item');
  if (!item) return;
  e.preventDefault();
  $('#search-results').classList.add('hidden');
  gsInput.blur();
  searchActions[Number(item.dataset.idx)]();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.global-search')) $('#search-results').classList.add('hidden');
});

// ---------- detail views ----------

const bidderLink = (id, text) => `<button type="button" class="link" data-act="view-bidder" data-id="${id}">${esc(text)}</button>`;
const consignorLink = (id, text) => `<button type="button" class="link" data-act="view-consignor" data-id="${id}">${esc(text)}</button>`;

function detailKv(pairs) {
  return `<div class="kv">${pairs.filter(([, v]) => v).map(([k, v]) =>
    `<div><span class="label">${k}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
}

function detailStats(pairs) {
  return `<div class="stat-grid detail-stats">${pairs.map(([l, v]) =>
    `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>`;
}

function openBidderDetail(id) {
  const b = bidderById(id);
  if (!b) return;
  const regs = state.registrations.filter((r) => r.bidderId === id)
    .sort((x, y) => (y.registeredAt || '').localeCompare(x.registeredAt || ''));
  const regIds = new Set(regs.map((r) => r.id));
  const wins = state.lots.filter((l) => l.status === 'sold' && regIds.has(l.winningRegId))
    .sort((x, y) => (auctionById(y.auctionId)?.date || '').localeCompare(auctionById(x.auctionId)?.date || '') || y.lotNumber - x.lotNumber);
  const invs = state.invoices.filter((i) => i.bidderId === id && i.status !== 'void');
  const bids = state.bids.filter((x) => x.bidderId === id);
  const hammerTotal = wins.reduce((s, l) => s + lotAmount(l), 0);
  const balance = invs.reduce((s, i) => s + (i.total - i.amountPaid), 0);

  $('#detail-body').innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${esc(b.name)} ${b.taxExempt ? '<span class="badge exempt">tax exempt</span>' : ''}</h3>
        <p class="sub">Customer since ${new Date(b.createdAt).toLocaleDateString()}</p>
      </div>
      <div class="head-controls">
        <button class="small" data-act="print-bidder" data-id="${b.id}">Print account statement</button>
        <button class="small" data-act="edit-bidder" data-id="${b.id}">Edit</button>
      </div>
    </div>
    ${detailKv([['Phone', b.phone], ['Email', b.email], ['Address', b.address], ['ID #', b.idNumber], ['Notes', b.notes]])}
    ${detailStats([
      ['Auctions attended', regs.length],
      ['Lots won', wins.length],
      ['Lifetime hammer', money(hammerTotal)],
      ['Open balance', money(balance)],
    ])}
    <h4>Purchases</h4>
    ${wins.length ? `<table><tr><th>Auction</th><th>Lot</th><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr>` +
      wins.map((l) => `<tr><td>${esc(auctionById(l.auctionId)?.title || '')}</td><td>${l.lotNumber}</td>
        <td>${esc(l.title)}</td><td class="num">${l.quantity}</td>
        <td class="num">${money(l.hammerPrice)}</td><td class="num">${money(lotAmount(l))}</td></tr>`).join('') + '</table>'
      : '<p class="sub">No purchases yet.</p>'}
    <h4>Invoices</h4>
    ${invs.length ? `<table><tr><th>Invoice</th><th>Auction</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr>` +
      invs.map((i) => `<tr><td>INV-${i.number}</td><td>${esc(auctionById(i.auctionId)?.title || '')}</td>
        <td class="num">${money(i.total)}</td><td class="num">${money(i.amountPaid)}</td>
        <td class="num">${money(i.total - i.amountPaid)}</td><td>${badge(i.status)}</td>
        <td class="actions"><button class="small" data-act="print-invoice" data-id="${i.id}">Print</button></td></tr>`).join('') + '</table>'
      : '<p class="sub">No invoices yet.</p>'}
    <h4>Registrations</h4>
    ${regs.length ? `<table><tr><th>Auction</th><th>Paddle</th><th>Date</th><th></th></tr>` +
      regs.map((r) => `<tr><td>${esc(auctionById(r.auctionId)?.title || '')}</td><td><strong>#${r.paddle}</strong></td>
        <td>${new Date(r.registeredAt).toLocaleDateString()}</td>
        <td>${r.taxExempt ? '<span class="badge exempt">tax exempt</span>' : ''}</td></tr>`).join('') + '</table>'
      : '<p class="sub">Never registered for an auction.</p>'}
    ${bids.length ? `<h4>Absentee bids</h4><table><tr><th>Lot</th><th>Auction</th><th class="num">Max bid</th><th>Lot status</th></tr>` +
      bids.map((x) => {
        const l = lotById(x.lotId);
        return l ? `<tr><td>Lot ${l.lotNumber} — ${esc(l.title)}</td><td>${esc(auctionById(l.auctionId)?.title || '')}</td>
          <td class="num">${money(x.amount)}</td><td>${badge(l.status)}</td></tr>` : '';
      }).join('') + '</table>' : ''}`;
  $('#detail').showModal();
}

function openConsignorDetail(id) {
  const c = consignorById(id);
  if (!c) return;
  const lots = state.lots.filter((l) => l.consignorId === id)
    .sort((x, y) => (auctionById(y.auctionId)?.date || '').localeCompare(auctionById(x.auctionId)?.date || '') || x.lotNumber - y.lotNumber);
  const sold = lots.filter((l) => l.status === 'sold');
  const sts = state.settlements.filter((s) => s.consignorId === id && s.status !== 'void');
  const gross = sold.reduce((s, l) => s + lotAmount(l), 0);
  const owed = sts.filter((s) => s.status === 'owed').reduce((s, x) => s + x.netDue, 0);

  $('#detail-body').innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${esc(c.code)} — ${esc(c.name)}</h3>
        <p class="sub">Consignor since ${new Date(c.createdAt).toLocaleDateString()}</p>
      </div>
      <button class="small" data-act="edit-consignor" data-id="${c.id}">Edit</button>
    </div>
    ${detailKv([['Phone', c.phone], ['Email', c.email], ['Address', c.address],
      ['Commission', (c.commissionPct ?? state.settings.defaultCommissionPct) + '%' + (c.commissionPct === null ? ' (default)' : '')],
      ['Notes', c.notes]])}
    ${detailStats([
      ['Lots consigned', lots.length],
      ['Sold', sold.length],
      ['Gross hammer', money(gross)],
      ['Owed now', money(owed)],
    ])}
    <h4>Settlements</h4>
    ${sts.length ? `<table><tr><th>Settlement</th><th>Auction</th><th class="num">Gross</th><th class="num">Commission</th><th class="num">Net</th><th>Status</th><th></th></tr>` +
      sts.map((s) => `<tr><td>ST-${s.number}</td><td>${esc(auctionById(s.auctionId)?.title || '')}</td>
        <td class="num">${money(s.grossHammer)}</td><td class="num">${money(s.commission)}</td>
        <td class="num">${money(s.netDue)}</td><td>${badge(s.status)}</td>
        <td class="actions"><button class="small" data-act="print-settlement" data-id="${s.id}">Print</button></td></tr>`).join('') + '</table>'
      : '<p class="sub">No settlements yet.</p>'}
    <h4>Lots</h4>
    ${lots.length ? `<table><tr><th>Auction</th><th>Lot</th><th>Item</th><th>Status</th><th class="num">Amount</th></tr>` +
      lots.map((l) => `<tr><td>${esc(auctionById(l.auctionId)?.title || '')}</td><td>${l.lotNumber}</td>
        <td>${esc(l.title)}${l.quantity > 1 ? ` × ${l.quantity}` : ''}</td><td>${badge(l.status)}</td>
        <td class="num">${l.status === 'sold' ? money(lotAmount(l)) : '—'}</td></tr>`).join('') + '</table>'
      : '<p class="sub">No lots consigned yet.</p>'}`;
  $('#detail').showModal();
}

$('#detail-close').addEventListener('click', () => $('#detail').close());

// ---------- print + csv ----------

function openPrint(type, params = {}) {
  const q = new URLSearchParams({ type, ...params });
  window.open('print.html?' + q.toString(), '_blank');
}

async function downloadCsv(kind, opts) {
  try {
    if (demoCore) {
      const result = demoCore.exportCsv(kind, opts);
      if (!result) throw new Error('Export failed');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([demoCore.rowsToCsv(result.rows)], { type: 'text/csv' }));
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`${result.filename} downloaded`);
      return;
    }
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(opts).filter(([, v]) => v))).toString();
    const res = await fetch(`/api/export/${kind}.csv${qs ? '?' + qs : ''}`, {
      headers: authToken ? { 'X-Auth': authToken } : {},
    });
    if (res.status === 401) return showLogin();
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const name = (cd.match(/filename="([^"]+)"/) || [])[1] || `${kind}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`${name} downloaded`);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- dashboard ----------

async function renderDashboard() {
  const d = await api('GET', '/api/dashboard');
  $('#stats').innerHTML = [
    ['Auctions', d.auctions, 'auctions'],
    ['Live now', d.liveAuctions, 'clerk'],
    ['Lots sold', `${d.soldLots} / ${d.lots}`, 'lots-sold'],
    ['Hammer total', money(d.hammerTotal), 'reports'],
    ['Invoiced', money(d.invoiceTotal), 'cashier'],
    ['Buyers owe', money(d.unpaidTotal), 'cashier'],
    ['Owed to sellers', money(d.settlementsOwedTotal), 'cashier'],
    ['Customers', d.bidders, 'bidders'],
  ].map(([label, value, drill]) =>
    `<div class="stat drill" data-drill="${drill}" role="button" tabindex="0" title="Open">
      <div class="label">${label}</div><div class="value">${value}</div></div>`
  ).join('');

  const active = state.auctions.filter((a) => a.status !== 'closed');
  $('#dash-auctions').innerHTML = active.length
    ? '<table><tr><th>Auction</th><th>Date</th><th>Status</th><th class="num">Lots</th><th class="num">Registered</th></tr>' +
      active.map((a) =>
        `<tr class="drill" data-drill="${a.status === 'live' ? 'auction-clerk' : 'auction-lots'}" data-id="${a.id}"
          title="${a.status === 'live' ? 'Open in Clerk' : 'View lots'}">
         <td>${esc(a.title)}</td><td>${fmtDate(a.date)}</td><td>${badge(a.status)}</td>
         <td class="num">${state.lots.filter((l) => l.auctionId === a.id).length}</td>
         <td class="num">${regsFor(a.id).length}</td></tr>`
      ).join('') + '</table>'
    : '<p class="sub">No upcoming auctions.</p>';

  const unpaid = state.invoices.filter((i) => i.status === 'unpaid' || i.status === 'partial');
  const owed = state.settlements.filter((s) => s.status === 'owed');
  let html = '';
  if (unpaid.length) {
    html += '<h4>Buyers with a balance</h4><table><tr><th>Invoice</th><th>Buyer</th><th class="num">Balance</th></tr>' +
      unpaid.map((i) => {
        const b = bidderById(i.bidderId);
        return `<tr class="drill" data-drill="cashier" title="Open Cashier"><td>INV-${i.number}</td><td>#${i.paddle} ${b ? bidderLink(b.id, b.name) : ''}</td><td class="num">${money(i.total - i.amountPaid)}</td></tr>`;
      }).join('') + '</table>';
  }
  if (owed.length) {
    html += '<h4 style="margin-top:10px">Sellers awaiting payout</h4><table><tr><th>Settlement</th><th>Consignor</th><th class="num">Net due</th></tr>' +
      owed.map((s) => {
        const c = consignorById(s.consignorId);
        return `<tr class="drill" data-drill="cashier" title="Open Cashier"><td>ST-${s.number}</td><td>${c ? consignorLink(c.id, c.name) : ''}</td><td class="num">${money(s.netDue)}</td></tr>`;
      }).join('') + '</table>';
  }
  $('#dash-money').innerHTML = html || '<p class="sub">All settled up. 🎉</p>';
}

// Dashboard drill-through: cards and rows navigate to the right view with filters set.
function drillTo(key, id) {
  if (key === 'auctions') state.view = 'auctions';
  else if (key === 'clerk') state.view = 'clerk';
  else if (key === 'bidders') state.view = 'bidders';
  else if (key === 'reports') state.view = 'reports';
  else if (key === 'cashier') state.view = 'cashier';
  else if (key === 'lots-sold') {
    state.view = 'lots';
    state.lotFilterStatus = 'sold';
    state.lotFilterAuction = '';
    state.lotSearch = '';
  } else if (key === 'auction-lots') {
    state.view = 'lots';
    state.lotFilterAuction = id;
    state.lotFilterStatus = '';
    state.lotSearch = '';
  } else if (key === 'auction-clerk') {
    state.view = 'clerk';
    state.clerkAuction = id;
    state.clerkPos = 0;
  } else return;
  refresh();
}

$('#view-dashboard').addEventListener('click', (e) => {
  if (e.target.closest('button')) return; // entity links keep their own behavior
  const el = e.target.closest('[data-drill]');
  if (el) drillTo(el.dataset.drill, el.dataset.id);
});
$('#view-dashboard').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-drill]');
  if (el) drillTo(el.dataset.drill, el.dataset.id);
});

// ---------- auctions ----------

function auctionFields(a = {}) {
  return [
    { name: 'title', label: 'Title', required: true, value: a.title },
    { name: 'date', label: 'Date', type: 'date', value: a.date },
    { name: 'location', label: 'Location', value: a.location },
    { name: 'status', label: 'Status', type: 'select', value: a.status,
      options: ['upcoming', 'live', 'closed'].map((s) => ({ value: s, label: s })) },
    { name: 'premiumPct', label: `Buyer's premium % (blank = default ${state.settings.buyersPremiumPct}%)`, type: 'number', step: '0.1', min: 0, value: a.premiumPct ?? '' },
    { name: 'taxPct', label: `Sales tax % (blank = default ${state.settings.taxPct}%)`, type: 'number', step: '0.01', min: 0, value: a.taxPct ?? '' },
    { name: 'notes', label: 'Notes', type: 'textarea', value: a.notes },
  ];
}

function renderAuctions() {
  const el = $('#auctions-table');
  if (!state.auctions.length) {
    el.innerHTML = '<div class="empty">No auctions yet. Create your first auction to get started.</div>';
    return;
  }
  el.innerHTML = '<table><tr><th>Title</th><th>Date</th><th>Status</th><th class="num">Premium</th><th class="num">Lots</th><th class="num">Registered</th><th class="num">Hammer</th><th></th></tr>' +
    state.auctions.map((a) => {
      const lots = state.lots.filter((l) => l.auctionId === a.id);
      const hammer = lots.filter((l) => l.status === 'sold').reduce((s, l) => s + lotAmount(l), 0);
      return `<tr>
        <td>${esc(a.title)}${a.location ? `<div class="sub">${esc(a.location)}</div>` : ''}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${badge(a.status)}</td>
        <td class="num">${effPremium(a)}%${a.premiumPct !== null ? '' : '<span class="sub"> (default)</span>'}</td>
        <td class="num">${lots.length}</td>
        <td class="num">${regsFor(a.id).length}</td>
        <td class="num">${money(hammer)}</td>
        <td class="actions">
          <button class="small" data-act="edit-auction" data-id="${a.id}">Edit</button>
          <button class="small danger" data-act="del-auction" data-id="${a.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') + '</table>';
}

// ---------- lots ----------

function lotFields(l = {}) {
  return [
    { name: 'auctionId', label: 'Auction', type: 'select', value: l.auctionId, required: true,
      options: state.auctions.map((a) => ({ value: a.id, label: a.title })) },
    { name: 'title', label: 'Title', required: true, value: l.title },
    { name: 'description', label: 'Description', type: 'textarea', value: l.description },
    { name: 'category', label: 'Category', value: l.category },
    { name: 'consignorId', label: 'Consignor', type: 'select', value: l.consignorId || '',
      options: [{ value: '', label: '— none —' }].concat(state.consignors.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))) },
    { name: 'quantity', label: 'Quantity (price × quantity, e.g. "6 × the money")', type: 'number', min: 1, step: '1', value: l.quantity ?? 1 },
    { name: 'startingBid', label: 'Starting bid ($ each)', type: 'number', step: '0.01', min: 0, value: l.startingBid },
    { name: 'reserve', label: 'Reserve ($ each, 0 = none)', type: 'number', step: '0.01', min: 0, value: l.reserve },
  ];
}

function lotMatchesSearch(l, q) {
  if (!q) return true;
  const c = consignorById(l.consignorId);
  const hay = `${l.lotNumber} ${l.title} ${l.description} ${l.category} ${c ? c.name + ' ' + c.code : ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function renderLots() {
  const setA = auctionOptions($('#lot-filter-auction'), { placeholder: 'All auctions' });
  state.lotFilterAuction = setA(state.lotFilterAuction);
  $('#lot-filter-status').value = state.lotFilterStatus;
  $('#lot-search').value = state.lotSearch;

  let lots = state.lots;
  if (state.lotFilterAuction) lots = lots.filter((l) => l.auctionId === state.lotFilterAuction);
  if (state.lotFilterStatus) lots = lots.filter((l) => l.status === state.lotFilterStatus);
  lots = lots.filter((l) => lotMatchesSearch(l, state.lotSearch));

  const el = $('#lots-table');
  if (!lots.length) {
    el.innerHTML = '<div class="empty">No lots match. Add a lot to an auction to begin cataloging.</div>';
    return;
  }
  lots = [...lots].sort((a, b) =>
    a.auctionId === b.auctionId ? a.lotNumber - b.lotNumber : a.auctionId.localeCompare(b.auctionId));

  el.innerHTML = '<table><tr><th>Lot</th><th>Item</th><th>Auction</th><th>Consignor</th><th class="num">Start</th><th>Status</th><th class="num">Amount</th><th></th></tr>' +
    lots.map((l) => {
      const c = consignorById(l.consignorId);
      const bids = state.bids.filter((b) => b.lotId === l.id).sort((x, y) => y.amount - x.amount);
      const bidsHtml = `
        <details class="bids">
          <summary>${bids.length} absentee bid${bids.length === 1 ? '' : 's'}${bids[0] ? ` · high ${money(bids[0].amount)}` : ''}</summary>
          ${bids.map((b) => {
            const bd = bidderById(b.bidderId);
            return `<div class="bid-row"><span>${esc(bd ? bd.name : '?')}</span>
              <span>${money(b.amount)} <button class="small danger" data-act="del-bid" data-id="${b.id}">✕</button></span></div>`;
          }).join('') || '<div class="sub">None.</div>'}
          ${l.status === 'open' ? `<button class="small" data-act="add-bid" data-id="${l.id}">+ Absentee bid</button>` : ''}
        </details>`;
      return `<tr>
        <td>${l.lotNumber}</td>
        <td>${esc(l.title)}${l.quantity > 1 ? ` <span class="badge qty">× ${l.quantity}</span>` : ''}
            ${l.category ? `<div class="sub">${esc(l.category)}</div>` : ''}${bidsHtml}</td>
        <td>${esc(auctionById(l.auctionId)?.title || '—')}</td>
        <td>${c ? consignorLink(c.id, c.code + ' ' + c.name) : '—'}</td>
        <td class="num">${money(l.startingBid)}</td>
        <td>${badge(l.status)}${l.status === 'sold' ? `<div class="sub">${(() => {
          const reg = regById(l.winningRegId);
          return reg ? bidderLink(reg.bidderId, winnerLabel(l)) : esc(winnerLabel(l));
        })()} @ ${money(l.hammerPrice)}</div>` : ''}</td>
        <td class="num">${l.status === 'sold' ? money(lotAmount(l)) : '—'}</td>
        <td class="actions">
          ${l.status === 'open' ? `<button class="small" data-act="sell-lot" data-id="${l.id}">Sell</button>
            <button class="small" data-act="pass-lot" data-id="${l.id}">Pass</button>` : ''}
          ${l.status !== 'open' && !l.invoiceId && !l.settlementId ? `<button class="small" data-act="reopen" data-id="${l.id}">Reopen</button>` : ''}
          <button class="small" data-act="edit-lot" data-id="${l.id}">Edit</button>
          <button class="small danger" data-act="del-lot" data-id="${l.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') + '</table>';
}

function sellLotModal(lot) {
  const auction = auctionById(lot.auctionId);
  const regs = regsFor(lot.auctionId);
  if (!regs.length) return toast('No bidders are checked in for this auction yet', true);
  const high = state.bids.filter((b) => b.lotId === lot.id).sort((x, y) => y.amount - x.amount)[0];
  openModal({
    title: `Sell lot ${lot.lotNumber} — ${lot.title}${lot.quantity > 1 ? ` (× ${lot.quantity})` : ''}`,
    submitLabel: 'Sold',
    fields: [
      { name: 'paddle', label: 'Winning paddle #', type: 'number', min: 1, required: true },
      { name: 'price', label: `Hammer price ($${lot.quantity > 1 ? ' each' : ''})`, type: 'number', step: '0.01', min: 0,
        required: true, value: high?.amount ?? (lot.startingBid || '') },
    ],
    onSubmit: (v) => run(async () => {
      if (lot.reserve > 0 && Number(v.price) < lot.reserve &&
          !confirm(`Hammer price is below the reserve of ${money(lot.reserve)}. Sell anyway?`)) return;
      await api('POST', '/api/clerk/sell', { lotId: lot.id, paddle: v.paddle, price: v.price });
    }, `Lot ${lot.lotNumber} sold`),
  });
}

// ---------- check-in ----------

function renderCheckin() {
  const setA = auctionOptions($('#checkin-auction'), { preferLive: true });
  state.checkinAuction = setA(state.checkinAuction);
  const sel = $('#checkin-bidder');
  const registeredIds = new Set(regsFor(state.checkinAuction).map((r) => r.bidderId));
  sel.innerHTML = '<option value="">— New bidder —</option>' +
    [...state.bidders].sort((a, b) => a.name.localeCompare(b.name))
      .filter((b) => !registeredIds.has(b.id))
      .map((b) => `<option value="${b.id}">${esc(b.name)}${b.phone ? ' · ' + esc(b.phone) : ''}</option>`).join('');
  toggleCheckinFields();

  const regs = regsFor(state.checkinAuction).sort((a, b) => a.paddle - b.paddle);
  $('#checkin-table').innerHTML = regs.length
    ? '<table><tr><th>Paddle</th><th>Bidder</th><th>Contact</th><th></th><th></th></tr>' +
      regs.map((r) => {
        const b = bidderById(r.bidderId);
        return `<tr>
          <td><strong>#${r.paddle}</strong></td>
          <td>${b ? bidderLink(b.id, b.name) : '?'}</td>
          <td class="sub">${esc(b ? (b.phone || b.email || '') : '')}</td>
          <td>${r.taxExempt ? '<span class="badge exempt">tax exempt</span>' : ''}</td>
          <td class="actions">
            <button class="small" data-act="edit-reg" data-id="${r.id}">Edit</button>
            <button class="small danger" data-act="del-reg" data-id="${r.id}">Remove</button>
          </td>
        </tr>`;
      }).join('') + '</table>'
    : '<div class="empty">No bidders checked in yet.</div>';
}

function toggleCheckinFields() {
  const isNew = !$('#checkin-bidder').value;
  $('#checkin-new-fields').style.display = isNew ? '' : 'none';
  $('#checkin-form').elements.name.required = isNew;
}
$('#checkin-bidder').addEventListener('change', toggleCheckinFields);

$('#checkin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  if (!state.checkinAuction) return toast('Create an auction first', true);
  const payload = {
    auctionId: state.checkinAuction,
    paddle: f.paddle.value || undefined,
    taxExempt: f.taxExempt.checked,
  };
  if ($('#checkin-bidder').value) {
    payload.bidderId = $('#checkin-bidder').value;
  } else {
    payload.newBidder = { name: f.name.value, phone: f.phone.value, email: f.email.value, idNumber: f.idNumber.value };
  }
  run(async () => {
    const reg = await api('POST', '/api/registrations', payload);
    e.target.reset();
    toast(`Paddle #${reg.paddle} assigned`);
  });
});

$('#checkin-auction').addEventListener('change', (e) => { state.checkinAuction = e.target.value; refresh(); });
$('#btn-print-regform').addEventListener('click', () => openPrint('regform', { auctionId: state.checkinAuction }));

// ---------- clerk ----------

function renderClerk() {
  const setA = auctionOptions($('#clerk-auction'), { preferLive: true });
  state.clerkAuction = setA(state.clerkAuction);
  const area = $('#clerk-area');
  const auctionId = state.clerkAuction;
  if (!auctionId) {
    area.innerHTML = '<div class="empty">Create an auction and add lots to start clerking.</div>';
    return;
  }
  const lots = state.lots.filter((l) => l.auctionId === auctionId).sort((a, b) => a.lotNumber - b.lotNumber);
  const openLots = lots.filter((l) => l.status === 'open');
  const soldLots = lots.filter((l) => l.status === 'sold');
  const gross = soldLots.reduce((s, l) => s + lotAmount(l), 0);
  const regs = regsFor(auctionId);

  const progress = `
    <div class="clerk-progress">
      <span><strong>${lots.length - openLots.length}</strong> of ${lots.length} lots hammered</span>
      <span>Gross: <strong>${money(gross)}</strong></span>
      <span>${regs.length} paddles out</span>
    </div>`;

  const recent = state.clerkRecent.filter((r) => lotById(r.lotId)).slice(0, 8).map((r) => {
    const l = lotById(r.lotId);
    return `<div class="bid-row">
      <span>Lot ${l.lotNumber} — ${esc(l.title)}</span>
      <span>${l.status === 'sold' ? `${esc(winnerLabel(l))} · ${money(lotAmount(l))}` : 'passed'}
        ${!l.invoiceId && !l.settlementId && l.status !== 'open' ? `<button class="small" data-act="clerk-undo" data-id="${l.id}">Undo</button>` : ''}
      </span>
    </div>`;
  }).join('');

  if (!openLots.length) {
    area.innerHTML = progress + `<div class="empty">All ${lots.length ? 'lots hammered — head to the Cashier tab to generate invoices.' : 'quiet: this auction has no lots yet.'}</div>` +
      (recent ? `<div class="panel" style="margin-top:14px"><h3>Recent</h3>${recent}</div>` : '');
    return;
  }
  if (!regs.length) {
    area.innerHTML = progress + '<div class="empty">No paddles assigned yet — check bidders in first (Check-in tab).</div>';
    return;
  }

  state.clerkPos = Math.min(state.clerkPos, openLots.length - 1);
  const lot = openLots[state.clerkPos];
  const high = state.bids.filter((b) => b.lotId === lot.id).sort((x, y) => y.amount - x.amount)[0];
  const highBidder = high ? bidderById(high.bidderId) : null;

  area.innerHTML = progress + `
    <div class="clerk-card panel">
      <div class="clerk-lotnum">LOT ${lot.lotNumber}</div>
      <div class="clerk-title">${esc(lot.title)}${lot.quantity > 1 ? ` <span class="badge qty">× ${lot.quantity} — bid is per item</span>` : ''}</div>
      ${lot.description ? `<div class="sub">${esc(lot.description)}</div>` : ''}
      <div class="clerk-meta">
        ${lot.category ? `<span>${esc(lot.category)}</span>` : ''}
        <span>Start ${money(lot.startingBid)}</span>
        ${lot.reserve > 0 ? `<span>Reserve ${money(lot.reserve)}</span>` : ''}
        ${high ? `<span class="highbid">Absentee high: ${money(high.amount)}${highBidder ? ' (' + esc(highBidder.name) + ')' : ''}</span>` : ''}
      </div>
      <form id="clerk-form" class="clerk-form">
        <label>Paddle #<input name="paddle" type="number" min="1" required autocomplete="off"></label>
        <label>Price $${lot.quantity > 1 ? ' (each)' : ''}<input name="price" type="number" step="0.01" min="0" required autocomplete="off" value="${high ? high.amount : ''}"></label>
        <button class="primary big" type="submit">SOLD ⏎</button>
        <button type="button" class="big" id="clerk-pass">Pass</button>
        <button type="button" class="big" id="clerk-skip" ${openLots.length < 2 ? 'disabled' : ''}>Skip ›</button>
      </form>
    </div>
    ${recent ? `<div class="panel" style="margin-top:14px"><h3>Recent</h3>${recent}</div>` : ''}`;

  const form = $('#clerk-form');
  form.elements.paddle.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const paddle = form.elements.paddle.value;
    const price = form.elements.price.value;
    if (lot.reserve > 0 && Number(price) < lot.reserve &&
        !confirm(`Below reserve of ${money(lot.reserve)}. Sell anyway?`)) return;
    run(async () => {
      await api('POST', '/api/clerk/sell', { lotId: lot.id, paddle, price });
      state.clerkRecent.unshift({ lotId: lot.id });
    });
  });
  $('#clerk-pass').addEventListener('click', () =>
    run(async () => {
      await api('POST', '/api/clerk/pass', { lotId: lot.id });
      state.clerkRecent.unshift({ lotId: lot.id });
    }, `Lot ${lot.lotNumber} passed`));
  $('#clerk-skip').addEventListener('click', () => {
    state.clerkPos = (state.clerkPos + 1) % openLots.length;
    renderClerk();
  });
}

$('#clerk-auction').addEventListener('change', (e) => {
  state.clerkAuction = e.target.value;
  state.clerkPos = 0;
  state.clerkRecent = [];
  refresh();
});
$('#btn-print-clerksheet').addEventListener('click', () => openPrint('clerksheet', { auctionId: state.clerkAuction }));

// ---------- cashier: invoices & settlements ----------

function renderCashier() {
  const setA = auctionOptions($('#invoice-gen-auction'), { preferLive: true });
  state.cashierAuction = setA(state.cashierAuction);

  const el = $('#invoices-table');
  if (!state.invoices.length) {
    el.innerHTML = '<div class="empty">No invoices yet. Sell lots, then generate invoices.</div>';
  } else {
    el.innerHTML = '<table><tr><th>Invoice</th><th>Buyer</th><th>Auction</th><th>Detail</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th></th></tr>' +
      [...state.invoices].reverse().map((i) => {
        const b = bidderById(i.bidderId);
        const balance = Math.round((i.total - i.amountPaid) * 100) / 100;
        return `<tr>
          <td><strong>INV-${i.number}</strong><div class="sub">${new Date(i.createdAt).toLocaleDateString()}</div></td>
          <td>#${i.paddle} ${b ? bidderLink(b.id, b.name) : '?'}${i.taxExempt ? '<div><span class="badge exempt">tax exempt</span></div>' : ''}</td>
          <td>${esc(auctionById(i.auctionId)?.title || '—')}</td>
          <td>
            <details class="bids">
              <summary>${i.lineItems.length} lot${i.lineItems.length === 1 ? '' : 's'} · subtotal ${money(i.subtotal)} + ${i.premiumPct}% premium${i.tax ? ' + tax' : ''}</summary>
              ${i.lineItems.map((li) => `<div class="bid-row"><span>Lot ${li.lotNumber} — ${esc(li.title)}${li.quantity > 1 ? ` × ${li.quantity}` : ''}</span><span>${money(li.amount)}</span></div>`).join('')}
              ${i.payments.map((p) => `<div class="bid-row pay"><span>↳ ${p.method} payment ${new Date(p.time).toLocaleDateString()}</span>
                <span>−${money(p.amount)} ${i.status !== 'void' ? `<button class="small danger" data-act="del-payment" data-id="${i.id}" data-pid="${p.id}">✕</button>` : ''}</span></div>`).join('')}
            </details>
          </td>
          <td class="num"><strong>${money(i.total)}</strong></td>
          <td class="num">${i.status === 'void' ? '—' : money(balance)}</td>
          <td>${badge(i.status)}</td>
          <td class="actions">
            ${i.status !== 'void' && balance > 0 ? `<button class="small primary" data-act="pay-invoice" data-id="${i.id}">Payment</button>` : ''}
            <button class="small" data-act="print-invoice" data-id="${i.id}">Print</button>
            ${i.status !== 'void' ? `<button class="small danger" data-act="void-invoice" data-id="${i.id}">Void</button>` : ''}
          </td>
        </tr>`;
      }).join('') + '</table>';
  }

  const st = $('#settlements-table');
  if (!state.settlements.length) {
    st.innerHTML = '<div class="empty">No settlements yet. After the sale, generate settlements to pay consignors.</div>';
  } else {
    st.innerHTML = '<table><tr><th>Settlement</th><th>Consignor</th><th>Auction</th><th class="num">Gross</th><th class="num">Commission</th><th class="num">Net due</th><th>Status</th><th></th></tr>' +
      [...state.settlements].reverse().map((s) => {
        const c = consignorById(s.consignorId);
        return `<tr>
          <td><strong>ST-${s.number}</strong><div class="sub">${new Date(s.createdAt).toLocaleDateString()}</div></td>
          <td>${c ? consignorLink(c.id, c.code + ' ' + c.name) : '?'}</td>
          <td>${esc(auctionById(s.auctionId)?.title || '—')}</td>
          <td class="num">${money(s.grossHammer)}</td>
          <td class="num">${s.commissionPct}% · ${money(s.commission)}</td>
          <td class="num"><strong>${money(s.netDue)}</strong></td>
          <td>${badge(s.status)}${s.status === 'paid' ? `<div class="sub">${esc(s.method)}</div>` : ''}</td>
          <td class="actions">
            ${s.status === 'owed' ? `<button class="small primary" data-act="pay-settlement" data-id="${s.id}">Mark paid</button>` : ''}
            ${s.status === 'paid' ? `<button class="small" data-act="unpay-settlement" data-id="${s.id}">Mark unpaid</button>` : ''}
            <button class="small" data-act="print-settlement" data-id="${s.id}">Print</button>
            ${s.status !== 'void' ? `<button class="small danger" data-act="void-settlement" data-id="${s.id}">Void</button>` : ''}
          </td>
        </tr>`;
      }).join('') + '</table>';
  }
}

$('#invoice-gen-auction').addEventListener('change', (e) => { state.cashierAuction = e.target.value; });
$('#btn-generate-invoices').addEventListener('click', () => {
  if (!state.cashierAuction) return toast('Create an auction first', true);
  run(async () => {
    const created = await api('POST', '/api/invoices/generate', { auctionId: state.cashierAuction });
    toast(`${created.length} invoice${created.length === 1 ? '' : 's'} generated`);
  });
});
$('#btn-generate-settlements').addEventListener('click', () => {
  if (!state.cashierAuction) return toast('Create an auction first', true);
  run(async () => {
    const created = await api('POST', '/api/settlements/generate', { auctionId: state.cashierAuction });
    toast(`${created.length} settlement${created.length === 1 ? '' : 's'} generated`);
  });
});

// ---------- consignors ----------

function consignorFields(c = {}) {
  return [
    { name: 'name', label: 'Name', required: true, value: c.name },
    { name: 'commissionPct', label: `Commission % (blank = default ${state.settings.defaultCommissionPct}%)`, type: 'number', step: '0.1', min: 0, value: c.commissionPct ?? '' },
    { name: 'phone', label: 'Phone', value: c.phone },
    { name: 'email', label: 'Email', type: 'email', value: c.email },
    { name: 'address', label: 'Address', type: 'textarea', value: c.address },
    { name: 'notes', label: 'Notes', type: 'textarea', value: c.notes },
  ];
}

function renderConsignors() {
  const el = $('#consignors-table');
  if (!state.consignors.length) {
    el.innerHTML = '<div class="empty">No consignors yet. Add the sellers whose items you auction.</div>';
    return;
  }
  el.innerHTML = '<table><tr><th>Code</th><th>Name</th><th>Contact</th><th class="num">Commission</th><th class="num">Lots</th><th class="num">Sold gross</th><th></th></tr>' +
    state.consignors.map((c) => {
      const lots = state.lots.filter((l) => l.consignorId === c.id);
      const gross = lots.filter((l) => l.status === 'sold').reduce((s, l) => s + lotAmount(l), 0);
      return `<tr>
        <td><strong>${esc(c.code)}</strong></td>
        <td>${consignorLink(c.id, c.name)}${c.notes ? `<div class="sub">${esc(c.notes)}</div>` : ''}</td>
        <td class="sub">${esc(c.phone)}${c.phone && c.email ? '<br>' : ''}${esc(c.email)}</td>
        <td class="num">${c.commissionPct ?? state.settings.defaultCommissionPct}%${c.commissionPct === null ? '<span class="sub"> (default)</span>' : ''}</td>
        <td class="num">${lots.length}</td>
        <td class="num">${money(gross)}</td>
        <td class="actions">
          <button class="small" data-act="edit-consignor" data-id="${c.id}">Edit</button>
          <button class="small danger" data-act="del-consignor" data-id="${c.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') + '</table>';
}

// ---------- bidders (customer file) ----------

function bidderFields(b = {}) {
  return [
    { name: 'name', label: 'Full name', required: true, value: b.name },
    { name: 'phone', label: 'Phone', value: b.phone },
    { name: 'email', label: 'Email', type: 'email', value: b.email },
    { name: 'address', label: 'Address', type: 'textarea', value: b.address },
    { name: 'idNumber', label: "ID # (driver's license etc.)", value: b.idNumber },
    { name: 'taxExempt', label: 'Tax exempt by default (resale / farm exemption on file)', type: 'checkbox', value: b.taxExempt },
    { name: 'notes', label: 'Notes', type: 'textarea', value: b.notes },
  ];
}

function renderBidders() {
  $('#bidder-search').value = state.bidderSearch;
  let bidders = [...state.bidders].sort((a, b) => a.name.localeCompare(b.name));
  const q = state.bidderSearch.toLowerCase();
  if (q) bidders = bidders.filter((b) => `${b.name} ${b.phone} ${b.email}`.toLowerCase().includes(q));
  const el = $('#bidders-table');
  if (!bidders.length) {
    el.innerHTML = '<div class="empty">No bidders found.</div>';
    return;
  }
  el.innerHTML = '<table><tr><th>Name</th><th>Contact</th><th></th><th class="num">Auctions</th><th class="num">Won total</th><th></th></tr>' +
    bidders.map((b) => {
      const regIds = new Set(state.registrations.filter((r) => r.bidderId === b.id).map((r) => r.id));
      const wins = state.lots.filter((l) => l.status === 'sold' && regIds.has(l.winningRegId));
      return `<tr>
        <td>${bidderLink(b.id, b.name)}${b.notes ? `<div class="sub">${esc(b.notes)}</div>` : ''}</td>
        <td class="sub">${esc(b.phone)}${b.phone && b.email ? '<br>' : ''}${esc(b.email)}</td>
        <td>${b.taxExempt ? '<span class="badge exempt">tax exempt</span>' : ''}</td>
        <td class="num">${state.registrations.filter((r) => r.bidderId === b.id).length}</td>
        <td class="num">${money(wins.reduce((s, l) => s + lotAmount(l), 0))}</td>
        <td class="actions">
          <button class="small" data-act="edit-bidder" data-id="${b.id}">Edit</button>
          <button class="small danger" data-act="del-bidder" data-id="${b.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') + '</table>';
}

// ---------- reports ----------

function reportRangeActive() {
  return !!(state.reportFrom || state.reportTo);
}

async function renderReports() {
  const setA = auctionOptions($('#report-auction'));
  state.reportAuction = setA(state.reportAuction);
  $('#report-from').value = state.reportFrom || '';
  $('#report-to').value = state.reportTo || '';
  const rangeOn = reportRangeActive();
  $('#report-clear').classList.toggle('hidden', !rangeOn);
  $('#report-auction').disabled = rangeOn;

  const area = $('#report-area');
  if (!rangeOn && !state.reportAuction) {
    area.innerHTML = '<div class="empty">Create an auction to see reports.</div>';
    state.report = null;
    return;
  }
  const r = rangeOn
    ? await api('GET', `/api/reports/range?from=${state.reportFrom || ''}&to=${state.reportTo || ''}`)
    : await api('GET', `/api/reports/auction/${state.reportAuction}`);
  state.report = r;

  const statRow = (pairs) => `<div class="stat-grid">${pairs.map(([l, v]) =>
    `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>`;
  const groupTable = (title, rows) => {
    if (!rows.length) return '';
    const max = Math.max(...rows.map((g) => g.gross), 1);
    return `<div class="panel"><h3>${title}</h3><table class="meter-table"><tr><th></th><th class="num">Lots</th><th class="num">Gross</th></tr>` +
      rows.map((g) => `<tr><td>${esc(g.label)}<div class="meter"><span style="width:${Math.max(2, Math.round(100 * g.gross / max))}%"></span></div></td>
        <td class="num">${g.count}</td><td class="num">${money(g.gross)}</td></tr>`).join('') +
      '</table></div>';
  };

  const headline = rangeOn
    ? `<p class="sub report-scope">${r.auctionCount} auction${r.auctionCount === 1 ? '' : 's'} between ${state.reportFrom ? fmtDate(state.reportFrom) : 'the beginning'} and ${state.reportTo ? fmtDate(state.reportTo) : 'today'}</p>`
    : '';

  area.innerHTML = headline +
    statRow([
      ...(rangeOn ? [['Auctions', r.auctionCount]] : []),
      ['Lots', r.lotCount],
      ['Sold', r.soldCount],
      ['Passed', r.passedCount],
      ['Still open', r.openCount],
      ['Sell-through', r.sellThroughPct + '%'],
      ['Registered', r.registeredBidders],
      ['Buyers', r.buyersWhoWon],
      ['Gross hammer', money(r.grossHammer)],
    ]) +
    statRow([
      ['Premium collected', money(r.premiumCollected)],
      ['Tax collected', money(r.taxCollected)],
      ['Invoiced', money(r.invoicedTotal)],
      ['Collected', money(r.collectedTotal)],
      ['Outstanding', money(r.outstandingTotal)],
      ['Commission earned', money(r.commissionEarned)],
      ['Owed to sellers', money(r.owedToConsignors)],
    ]) +
    (rangeOn ? groupTable('By auction', r.byAuction) : '') +
    `<div class="two-col" style="margin-top:14px">
      ${groupTable('By consignor', r.byConsignor)}
      ${groupTable('By category', r.byCategory)}
    </div>` +
    (r.topLots.length
      ? `<div class="panel" style="margin-top:14px"><h3>Top lots</h3><table><tr><th>Lot</th><th></th><th class="num">Amount</th></tr>` +
        r.topLots.map((t) => `<tr><td>${t.lotNumber}</td><td>${esc(t.title)}</td><td class="num">${money(t.amount)}</td></tr>`).join('') +
        '</table></div>'
      : '');
}

$('#report-auction').addEventListener('change', (e) => { state.reportAuction = e.target.value; refresh(); });
$('#report-from').addEventListener('change', (e) => { state.reportFrom = e.target.value; refresh(); });
$('#report-to').addEventListener('change', (e) => { state.reportTo = e.target.value; refresh(); });
$('#report-clear').addEventListener('click', () => {
  state.reportFrom = '';
  state.reportTo = '';
  refresh();
});
$('#btn-print-report').addEventListener('click', () => {
  if (reportRangeActive()) openPrint('report', { from: state.reportFrom || '', to: state.reportTo || '' });
  else if (state.reportAuction) openPrint('report', { auctionId: state.reportAuction });
});
document.querySelectorAll('button[data-csv]').forEach((btn) =>
  btn.addEventListener('click', () => downloadCsv(btn.dataset.csv, reportRangeActive()
    ? { from: state.reportFrom, to: state.reportTo }
    : { auctionId: state.reportAuction })));

// ---------- settings ----------

async function renderSettings() {
  const f = $('#settings-form');
  for (const k of ['businessName', 'address', 'phone', 'buyersPremiumPct', 'taxPct', 'defaultCommissionPct', 'invoiceFooter']) {
    f.elements[k].value = state.settings[k] ?? '';
  }
  $('#pin-status').textContent = state.settings.pinSet
    ? 'A PIN is set — everyone must log in to use the system.'
    : 'No PIN set — anyone at this computer can use the system.';
  const log = await api('GET', '/api/audit?limit=100');
  $('#audit-table').innerHTML = log.length
    ? log.map((e) => `<div class="audit-row"><span class="sub">${new Date(e.time).toLocaleString()}</span> ${esc(e.detail)}</div>`).join('')
    : '<p class="sub">Nothing yet.</p>';
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  run(() => api('PUT', '/api/settings', {
    businessName: f.businessName.value,
    address: f.address.value,
    phone: f.phone.value,
    buyersPremiumPct: f.buyersPremiumPct.value,
    taxPct: f.taxPct.value,
    defaultCommissionPct: f.defaultCommissionPct.value,
    invoiceFooter: f.invoiceFooter.value,
  }), 'Settings saved');
});

$('#pin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const newPin = e.target.elements.newPin.value.trim();
  if (newPin === '' && !confirm('Remove the PIN and disable login?')) return;
  run(async () => {
    await api('PUT', '/api/settings', { newPin });
    authToken = '';
    localStorage.removeItem('brinkley-token');
    e.target.reset();
    if (newPin) {
      toast('PIN updated — log in with the new PIN');
      showLogin();
    } else {
      toast('Login disabled');
    }
  });
});

// ---------- navigation & refresh ----------

async function refresh() {
  try {
    await loadAll();
  } catch (err) {
    if (err.message === 'Login required') return;
    toast(err.message, true);
    return;
  }
  const view = state.view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  document.querySelectorAll('nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  if (view === 'dashboard') await renderDashboard();
  if (view === 'auctions') renderAuctions();
  if (view === 'lots') renderLots();
  if (view === 'checkin') renderCheckin();
  if (view === 'clerk') renderClerk();
  if (view === 'cashier') renderCashier();
  if (view === 'consignors') renderConsignors();
  if (view === 'bidders') renderBidders();
  if (view === 'reports') await renderReports();
  if (view === 'settings') await renderSettings();
}

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.view = btn.dataset.view;
  refresh();
});

// ---------- top-level buttons ----------

$('#btn-new-auction').addEventListener('click', () =>
  openModal({
    title: 'New auction',
    fields: auctionFields(),
    onSubmit: (v) => run(() => api('POST', '/api/auctions', v), 'Auction created'),
  }));

$('#btn-new-lot').addEventListener('click', () => {
  if (!state.auctions.length) return toast('Create an auction first', true);
  openModal({
    title: 'New lot',
    fields: lotFields({ auctionId: state.lotFilterAuction || undefined }),
    onSubmit: (v) => run(() => api('POST', '/api/lots', v), 'Lot added'),
  });
});

$('#btn-new-bidder').addEventListener('click', () =>
  openModal({
    title: 'Add bidder',
    fields: bidderFields(),
    onSubmit: (v) => run(() => api('POST', '/api/bidders', v), 'Bidder added'),
  }));

$('#btn-new-consignor').addEventListener('click', () =>
  openModal({
    title: 'New consignor',
    fields: consignorFields(),
    onSubmit: (v) => run(() => api('POST', '/api/consignors', v), 'Consignor added'),
  }));

$('#lot-filter-auction').addEventListener('change', (e) => { state.lotFilterAuction = e.target.value; refresh(); });
$('#lot-filter-status').addEventListener('change', (e) => { state.lotFilterStatus = e.target.value; refresh(); });
$('#lot-search').addEventListener('input', (e) => { state.lotSearch = e.target.value; renderLots(); });
$('#bidder-search').addEventListener('input', (e) => { state.bidderSearch = e.target.value; renderBidders(); });

// ---------- table action buttons (event delegation) ----------

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id, pid } = btn.dataset;

  // Actions launched from inside the detail dialog swap to the edit modal.
  if (['edit-bidder', 'edit-consignor'].includes(act) && $('#detail').open) $('#detail').close();

  if (act === 'view-bidder') openBidderDetail(id);
  if (act === 'view-consignor') openConsignorDetail(id);
  if (act === 'print-bidder') openPrint('bidder', { id });

  if (act === 'edit-auction') {
    const a = auctionById(id);
    openModal({
      title: 'Edit auction',
      fields: auctionFields(a),
      onSubmit: (v) => run(() => api('PUT', `/api/auctions/${id}`, v), 'Auction updated'),
    });
  }
  if (act === 'del-auction' && confirm('Delete this auction?')) {
    run(() => api('DELETE', `/api/auctions/${id}`), 'Auction deleted');
  }
  if (act === 'edit-lot') {
    openModal({
      title: 'Edit lot',
      fields: lotFields(lotById(id)),
      onSubmit: (v) => run(() => api('PUT', `/api/lots/${id}`, v), 'Lot updated'),
    });
  }
  if (act === 'del-lot' && confirm('Delete this lot?')) {
    run(() => api('DELETE', `/api/lots/${id}`), 'Lot deleted');
  }
  if (act === 'sell-lot') sellLotModal(lotById(id));
  if (act === 'pass-lot') run(() => api('POST', '/api/clerk/pass', { lotId: id }), 'Lot passed');
  if (act === 'reopen') run(() => api('POST', '/api/clerk/reopen', { lotId: id }), 'Lot reopened');
  if (act === 'clerk-undo') run(() => api('POST', '/api/clerk/reopen', { lotId: id }), 'Undone — lot reopened');
  if (act === 'add-bid') {
    if (!state.bidders.length) return toast('Add the bidder to the customer file first', true);
    openModal({
      title: 'Absentee bid',
      submitLabel: 'Record',
      fields: [
        { name: 'bidderId', label: 'Bidder', type: 'select',
          options: [...state.bidders].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ value: b.id, label: b.name })) },
        { name: 'amount', label: 'Maximum bid ($)', type: 'number', step: '0.01', min: 0, required: true },
      ],
      onSubmit: (v) => run(() => api('POST', '/api/bids', { lotId: id, ...v }), 'Absentee bid recorded'),
    });
  }
  if (act === 'del-bid' && confirm('Remove this absentee bid?')) {
    run(() => api('DELETE', `/api/bids/${id}`), 'Bid removed');
  }
  if (act === 'edit-reg') {
    const r = regById(id);
    openModal({
      title: 'Edit registration',
      fields: [
        { name: 'paddle', label: 'Paddle #', type: 'number', min: 1, value: r.paddle, required: true },
        { name: 'taxExempt', label: 'Tax exempt for this auction', type: 'checkbox', value: r.taxExempt },
      ],
      onSubmit: (v) => run(() => api('PUT', `/api/registrations/${id}`, v), 'Registration updated'),
    });
  }
  if (act === 'del-reg' && confirm('Remove this paddle?')) {
    run(() => api('DELETE', `/api/registrations/${id}`), 'Paddle removed');
  }
  if (act === 'edit-consignor') {
    openModal({
      title: 'Edit consignor',
      fields: consignorFields(consignorById(id)),
      onSubmit: (v) => run(() => api('PUT', `/api/consignors/${id}`, v), 'Consignor updated'),
    });
  }
  if (act === 'del-consignor' && confirm('Delete this consignor?')) {
    run(() => api('DELETE', `/api/consignors/${id}`), 'Consignor deleted');
  }
  if (act === 'edit-bidder') {
    openModal({
      title: 'Edit bidder',
      fields: bidderFields(bidderById(id)),
      onSubmit: (v) => run(() => api('PUT', `/api/bidders/${id}`, v), 'Bidder updated'),
    });
  }
  if (act === 'del-bidder' && confirm('Delete this bidder?')) {
    run(() => api('DELETE', `/api/bidders/${id}`), 'Bidder deleted');
  }
  if (act === 'pay-invoice') {
    const inv = state.invoices.find((x) => x.id === id);
    const balance = Math.round((inv.total - inv.amountPaid) * 100) / 100;
    openModal({
      title: `Payment — INV-${inv.number} (balance ${money(balance)})`,
      submitLabel: 'Record payment',
      fields: [
        { name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', min: 0, value: balance, required: true },
        { name: 'method', label: 'Method', type: 'select',
          options: ['cash', 'check', 'card', 'other'].map((m) => ({ value: m, label: m })) },
        { name: 'note', label: 'Note (check #, last 4, …)', placeholder: 'optional' },
      ],
      onSubmit: (v) => run(() => api('POST', `/api/invoices/${id}/payments`, v), 'Payment recorded'),
    });
  }
  if (act === 'del-payment' && confirm('Remove this payment?')) {
    run(() => api('DELETE', `/api/invoices/${id}/payments/${pid}`), 'Payment removed');
  }
  if (act === 'print-invoice') openPrint('invoice', { id });
  if (act === 'void-invoice' && confirm('Void this invoice? Its lots can then be corrected or re-invoiced.')) {
    run(() => api('PUT', `/api/invoices/${id}`, { status: 'void' }), 'Invoice voided');
  }
  if (act === 'pay-settlement') {
    openModal({
      title: 'Pay consignor',
      submitLabel: 'Mark paid',
      fields: [
        { name: 'method', label: 'Method', type: 'select',
          options: ['check', 'cash', 'card', 'other'].map((m) => ({ value: m, label: m })) },
      ],
      onSubmit: (v) => run(() => api('PUT', `/api/settlements/${id}`, { status: 'paid', method: v.method }), 'Settlement paid'),
    });
  }
  if (act === 'unpay-settlement') run(() => api('PUT', `/api/settlements/${id}`, { status: 'owed' }), 'Settlement marked unpaid');
  if (act === 'print-settlement') openPrint('settlement', { id });
  if (act === 'void-settlement' && confirm('Void this settlement? Its lots can then be re-settled.')) {
    run(() => api('PUT', `/api/settlements/${id}`, { status: 'void' }), 'Settlement voided');
  }
});

// ---------- crash reporting ----------

function reportClientError(msg) {
  if (!msg || msg === 'Login required') return;
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg }),
    });
  } catch { /* reporting must never break the app */ }
  toast('Something went wrong: ' + msg, true);
}

window.addEventListener('error', (e) =>
  reportClientError(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) =>
  reportClientError(e.reason && e.reason.message ? e.reason.message : String(e.reason)));

// ---------- boot ----------

(async function boot() {
  let backendOk = false;
  try {
    const res = await fetch('/api/auth-status');
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('json')) {
      backendOk = true;
      const { authRequired } = await res.json();
      if (authRequired && !authToken) return showLogin();
    }
  } catch { /* no server — fall through to demo detection */ }
  if (!backendOk) {
    if (typeof createBrinkleyCore === 'function' && window.BRINKLEY_DEMO_DB) {
      initDemo();
    } else {
      toast('Cannot reach the auction server. Start it with "Start Auction System.command".', true);
      return;
    }
  }
  refresh();
})();
