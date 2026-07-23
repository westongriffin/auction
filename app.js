// Brinkley Auction — frontend

const state = {
  settings: {},
  auctions: [],
  bidders: [],
  lots: [],
  bids: [],
  invoices: [],
  view: 'dashboard',
  lotFilterAuction: '',
  lotFilterStatus: '',
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => (s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString() : '—');

// ---------- api ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadAll() {
  [state.settings, state.auctions, state.bidders, state.lots, state.bids, state.invoices] =
    await Promise.all([
      api('GET', '/api/settings'),
      api('GET', '/api/auctions'),
      api('GET', '/api/bidders'),
      api('GET', '/api/lots'),
      api('GET', '/api/bids'),
      api('GET', '/api/invoices'),
    ]);
}

// ---------- toast ----------

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

async function run(fn, successMsg) {
  try {
    await fn();
    await refresh();
    if (successMsg) toast(successMsg);
  } catch (err) {
    toast(err.message, true);
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
    label.textContent = f.label;
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
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      if (f.step) input.step = f.step;
      if (f.min !== undefined) input.min = f.min;
    }
    input.name = f.name;
    if (f.required) input.required = true;
    if (f.value !== undefined && f.value !== null) input.value = f.value;
    label.appendChild(input);
    wrap.appendChild(label);
  }
  const modal = $('#modal');
  const form = $('#modal-form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) values[f.name] = form.elements[f.name].value;
    modal.close();
    onSubmit(values);
  };
  modal.showModal();
}
$('#modal-cancel').addEventListener('click', () => $('#modal').close());

// ---------- lookups ----------

const auctionById = (id) => state.auctions.find((a) => a.id === id);
const bidderById = (id) => state.bidders.find((b) => b.id === id);
const bidderLabel = (id) => {
  const b = bidderById(id);
  return b ? `#${b.number} ${b.name}` : '—';
};
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;

// ---------- dashboard ----------

async function renderDashboard() {
  const d = await api('GET', '/api/dashboard');
  $('#stats').innerHTML = [
    ['Auctions', d.auctions],
    ['Live now', d.liveAuctions],
    ['Registered bidders', d.bidders],
    ['Lots', d.lots],
    ['Lots sold', d.soldLots],
    ['Hammer total', money(d.hammerTotal)],
    ['Invoiced', money(d.invoiceTotal)],
    ['Outstanding', money(d.unpaidTotal)],
  ].map(([label, value]) =>
    `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
  ).join('');

  const active = state.auctions.filter((a) => a.status !== 'closed');
  $('#dash-auctions').innerHTML = active.length
    ? '<table><tr><th>Auction</th><th>Date</th><th>Status</th></tr>' +
      active.map((a) =>
        `<tr><td>${esc(a.title)}</td><td>${fmtDate(a.date)}</td><td>${badge(a.status)}</td></tr>`
      ).join('') + '</table>'
    : '<p class="sub">No upcoming auctions.</p>';

  const unpaid = state.invoices.filter((i) => i.status === 'unpaid');
  $('#dash-unpaid').innerHTML = unpaid.length
    ? '<table><tr><th>Invoice</th><th>Bidder</th><th class="num">Total</th></tr>' +
      unpaid.map((i) =>
        `<tr><td>INV-${i.number}</td><td>${esc(bidderLabel(i.bidderId))}</td><td class="num">${money(i.total)}</td></tr>`
      ).join('') + '</table>'
    : '<p class="sub">Nothing outstanding. 🎉</p>';
}

// ---------- auctions ----------

const AUCTION_STATUSES = ['upcoming', 'live', 'closed'];

function auctionFields(a = {}) {
  return [
    { name: 'title', label: 'Title', required: true, value: a.title },
    { name: 'date', label: 'Date', type: 'date', value: a.date },
    { name: 'location', label: 'Location', value: a.location },
    { name: 'status', label: 'Status', type: 'select', value: a.status,
      options: AUCTION_STATUSES.map((s) => ({ value: s, label: s })) },
    { name: 'notes', label: 'Notes', type: 'textarea', value: a.notes },
  ];
}

function renderAuctions() {
  const el = $('#auctions-table');
  if (!state.auctions.length) {
    el.innerHTML = '<div class="empty">No auctions yet. Create your first auction to get started.</div>';
    return;
  }
  el.innerHTML = '<table><tr><th>Title</th><th>Date</th><th>Location</th><th>Status</th><th class="num">Lots</th><th class="num">Hammer</th><th></th></tr>' +
    state.auctions.map((a) => {
      const lots = state.lots.filter((l) => l.auctionId === a.id);
      const hammer = lots.filter((l) => l.status === 'sold').reduce((s, l) => s + l.hammerPrice, 0);
      return `<tr>
        <td>${esc(a.title)}${a.notes ? `<div class="sub">${esc(a.notes)}</div>` : ''}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${esc(a.location) || '—'}</td>
        <td>${badge(a.status)}</td>
        <td class="num">${lots.length}</td>
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
    { name: 'consignor', label: 'Consignor', value: l.consignor },
    { name: 'startingBid', label: 'Starting bid ($)', type: 'number', step: '0.01', min: 0, value: l.startingBid },
    { name: 'reserve', label: 'Reserve ($, 0 = none)', type: 'number', step: '0.01', min: 0, value: l.reserve },
  ];
}

function renderLots() {
  const filterSel = $('#lot-filter-auction');
  filterSel.innerHTML = '<option value="">All auctions</option>' +
    state.auctions.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
  filterSel.value = state.lotFilterAuction;

  let lots = state.lots;
  if (state.lotFilterAuction) lots = lots.filter((l) => l.auctionId === state.lotFilterAuction);
  if (state.lotFilterStatus) lots = lots.filter((l) => l.status === state.lotFilterStatus);

  const el = $('#lots-table');
  if (!lots.length) {
    el.innerHTML = '<div class="empty">No lots match. Add a lot to an auction to begin cataloging.</div>';
    return;
  }
  lots = [...lots].sort((a, b) =>
    a.auctionId === b.auctionId ? a.lotNumber - b.lotNumber : a.auctionId.localeCompare(b.auctionId));

  el.innerHTML = '<table><tr><th>Lot</th><th>Item</th><th>Auction</th><th>Consignor</th><th class="num">Start</th><th>Status</th><th class="num">Hammer</th><th></th></tr>' +
    lots.map((l) => {
      const bids = state.bids.filter((b) => b.lotId === l.id).sort((x, y) => y.amount - x.amount);
      const high = bids[0];
      const bidsHtml = `
        <details class="bids">
          <summary>${bids.length} bid${bids.length === 1 ? '' : 's'}${high ? ` · high ${money(high.amount)}` : ''}</summary>
          ${bids.map((b) => `<div class="bid-row"><span>${esc(bidderLabel(b.bidderId))}</span><span>${money(b.amount)}</span></div>`).join('') || '<div class="sub">No bids yet.</div>'}
          ${l.status === 'open' ? `<button class="small" data-act="add-bid" data-id="${l.id}">+ Record bid</button>` : ''}
        </details>`;
      return `<tr>
        <td>${l.lotNumber}</td>
        <td>${esc(l.title)}${l.category ? `<div class="sub">${esc(l.category)}</div>` : ''}${bidsHtml}</td>
        <td>${esc(auctionById(l.auctionId)?.title || '—')}</td>
        <td>${esc(l.consignor) || '—'}</td>
        <td class="num">${money(l.startingBid)}</td>
        <td>${badge(l.status)}${l.status === 'sold' ? `<div class="sub">${esc(bidderLabel(l.winningBidderId))}</div>` : ''}</td>
        <td class="num">${l.status === 'sold' ? money(l.hammerPrice) : '—'}</td>
        <td class="actions">
          ${l.status === 'open' ? `<button class="small" data-act="hammer" data-id="${l.id}">Hammer</button>` : ''}
          ${l.status !== 'open' && !l.invoiceId ? `<button class="small" data-act="reopen" data-id="${l.id}">Reopen</button>` : ''}
          <button class="small" data-act="edit-lot" data-id="${l.id}">Edit</button>
          <button class="small danger" data-act="del-lot" data-id="${l.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') + '</table>';
}

function hammerLot(lot) {
  if (!state.bidders.length) return toast('Register a bidder first', true);
  const bids = state.bids.filter((b) => b.lotId === lot.id).sort((x, y) => y.amount - x.amount);
  const high = bids[0];
  openModal({
    title: `Hammer lot ${lot.lotNumber} — ${lot.title}`,
    submitLabel: 'Record result',
    fields: [
      { name: 'result', label: 'Result', type: 'select',
        options: [{ value: 'sold', label: 'Sold' }, { value: 'passed', label: 'Passed (unsold)' }] },
      { name: 'winningBidderId', label: 'Winning bidder', type: 'select',
        value: high?.bidderId,
        options: state.bidders.map((b) => ({ value: b.id, label: `#${b.number} ${b.name}` })) },
      { name: 'hammerPrice', label: 'Hammer price ($)', type: 'number', step: '0.01', min: 0,
        value: high?.amount ?? lot.startingBid },
    ],
    onSubmit: (v) => run(async () => {
      if (v.result === 'passed') {
        await api('PUT', `/api/lots/${lot.id}`, { status: 'passed' });
      } else {
        if (lot.reserve > 0 && Number(v.hammerPrice) < lot.reserve &&
            !confirm(`Hammer price is below the reserve of ${money(lot.reserve)}. Sell anyway?`)) return;
        await api('PUT', `/api/lots/${lot.id}`, {
          status: 'sold',
          winningBidderId: v.winningBidderId,
          hammerPrice: v.hammerPrice,
        });
      }
    }, v.result === 'passed' ? 'Lot passed' : 'Lot sold'),
  });
}

// ---------- bidders ----------

function bidderFields(b = {}) {
  return [
    { name: 'name', label: 'Full name', required: true, value: b.name },
    { name: 'email', label: 'Email', type: 'email', value: b.email },
    { name: 'phone', label: 'Phone', value: b.phone },
    { name: 'address', label: 'Address', type: 'textarea', value: b.address },
    { name: 'notes', label: 'Notes', type: 'textarea', value: b.notes },
  ];
}

function renderBidders() {
  const el = $('#bidders-table');
  if (!state.bidders.length) {
    el.innerHTML = '<div class="empty">No bidders registered yet.</div>';
    return;
  }
  el.innerHTML = '<table><tr><th>Paddle #</th><th>Name</th><th>Contact</th><th class="num">Wins</th><th class="num">Won total</th><th></th></tr>' +
    state.bidders.map((b) => {
      const wins = state.lots.filter((l) => l.status === 'sold' && l.winningBidderId === b.id);
      return `<tr>
        <td><strong>${b.number}</strong></td>
        <td>${esc(b.name)}${b.notes ? `<div class="sub">${esc(b.notes)}</div>` : ''}</td>
        <td>${esc(b.email)}${b.email && b.phone ? '<br>' : ''}${esc(b.phone)}</td>
        <td class="num">${wins.length}</td>
        <td class="num">${money(wins.reduce((s, l) => s + l.hammerPrice, 0))}</td>
        <td class="actions">
          <button class="small" data-act="edit-bidder" data-id="${b.id}">Edit</button>
          <button class="small danger" data-act="del-bidder" data-id="${b.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') + '</table>';
}

// ---------- invoices ----------

function renderInvoices() {
  const sel = $('#invoice-gen-auction');
  sel.innerHTML = state.auctions.length
    ? state.auctions.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('')
    : '<option value="">No auctions</option>';

  const el = $('#invoices-table');
  if (!state.invoices.length) {
    el.innerHTML = '<div class="empty">No invoices yet. Sell some lots, then generate invoices for the auction.</div>';
    return;
  }
  el.innerHTML = '<table><tr><th>Invoice</th><th>Bidder</th><th>Auction</th><th>Items</th><th class="num">Total</th><th>Status</th><th></th></tr>' +
    [...state.invoices].reverse().map((i) => `<tr>
      <td><strong>INV-${i.number}</strong><div class="sub">${new Date(i.createdAt).toLocaleDateString()}</div></td>
      <td>${esc(bidderLabel(i.bidderId))}</td>
      <td>${esc(auctionById(i.auctionId)?.title || '—')}</td>
      <td>
        <ul class="invoice-lines">
          ${i.lineItems.map((li) => `<li>Lot ${li.lotNumber} — ${esc(li.title)}: ${money(li.amount)}</li>`).join('')}
        </ul>
        <div class="sub">Subtotal ${money(i.subtotal)} + premium (${i.premiumPct}%) ${money(i.premium)}${i.tax ? ` + tax ${money(i.tax)}` : ''}</div>
      </td>
      <td class="num"><strong>${money(i.total)}</strong></td>
      <td>${badge(i.status)}</td>
      <td class="actions">
        ${i.status === 'unpaid' ? `<button class="small" data-act="pay-invoice" data-id="${i.id}">Mark paid</button>` : ''}
        ${i.status === 'paid' ? `<button class="small" data-act="unpay-invoice" data-id="${i.id}">Mark unpaid</button>` : ''}
        ${i.status !== 'void' ? `<button class="small danger" data-act="void-invoice" data-id="${i.id}">Void</button>` : ''}
      </td>
    </tr>`).join('') + '</table>';
}

// ---------- settings ----------

function renderSettings() {
  const f = $('#settings-form');
  f.elements.businessName.value = state.settings.businessName;
  f.elements.buyersPremiumPct.value = state.settings.buyersPremiumPct;
  f.elements.taxPct.value = state.settings.taxPct;
}

// ---------- navigation & refresh ----------

async function refresh() {
  await loadAll();
  const view = state.view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  document.querySelectorAll('nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  if (view === 'dashboard') await renderDashboard();
  if (view === 'auctions') renderAuctions();
  if (view === 'lots') renderLots();
  if (view === 'bidders') renderBidders();
  if (view === 'invoices') renderInvoices();
  if (view === 'settings') renderSettings();
}

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.view = btn.dataset.view;
  refresh();
});

// ---------- event wiring ----------

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
    title: 'Register bidder',
    fields: bidderFields(),
    submitLabel: 'Register',
    onSubmit: (v) => run(() => api('POST', '/api/bidders', v), 'Bidder registered'),
  }));

$('#btn-generate-invoices').addEventListener('click', () => {
  const auctionId = $('#invoice-gen-auction').value;
  if (!auctionId) return toast('Create an auction first', true);
  run(async () => {
    const created = await api('POST', '/api/invoices/generate', { auctionId });
    toast(`${created.length} invoice${created.length === 1 ? '' : 's'} generated`);
  });
});

$('#lot-filter-auction').addEventListener('change', (e) => {
  state.lotFilterAuction = e.target.value;
  refresh();
});
$('#lot-filter-status').addEventListener('change', (e) => {
  state.lotFilterStatus = e.target.value;
  refresh();
});

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  run(() => api('PUT', '/api/settings', {
    businessName: f.elements.businessName.value,
    buyersPremiumPct: f.elements.buyersPremiumPct.value,
    taxPct: f.elements.taxPct.value,
  }), 'Settings saved');
});

// Table action buttons (event delegation)
document.querySelector('main').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;

  if (act === 'edit-auction') {
    const a = auctionById(id);
    openModal({
      title: 'Edit auction',
      fields: auctionFields(a),
      onSubmit: (v) => run(() => api('PUT', `/api/auctions/${id}`, v), 'Auction updated'),
    });
  }
  if (act === 'del-auction') {
    if (confirm('Delete this auction?')) run(() => api('DELETE', `/api/auctions/${id}`), 'Auction deleted');
  }
  if (act === 'edit-lot') {
    const l = state.lots.find((x) => x.id === id);
    openModal({
      title: 'Edit lot',
      fields: lotFields(l),
      onSubmit: (v) => run(() => api('PUT', `/api/lots/${id}`, v), 'Lot updated'),
    });
  }
  if (act === 'del-lot') {
    if (confirm('Delete this lot and its bids?')) run(() => api('DELETE', `/api/lots/${id}`), 'Lot deleted');
  }
  if (act === 'hammer') hammerLot(state.lots.find((x) => x.id === id));
  if (act === 'reopen') run(() => api('PUT', `/api/lots/${id}`, { status: 'open' }), 'Lot reopened');
  if (act === 'add-bid') {
    if (!state.bidders.length) return toast('Register a bidder first', true);
    const lot = state.lots.find((x) => x.id === id);
    const high = state.bids.filter((b) => b.lotId === id).reduce((m, b) => Math.max(m, b.amount), 0);
    openModal({
      title: `Record bid — lot ${lot.lotNumber}`,
      submitLabel: 'Record',
      fields: [
        { name: 'bidderId', label: 'Bidder', type: 'select',
          options: state.bidders.map((b) => ({ value: b.id, label: `#${b.number} ${b.name}` })) },
        { name: 'amount', label: `Amount ($)${high ? ` — current high ${money(high)}` : ''}`,
          type: 'number', step: '0.01', min: 0, required: true },
      ],
      onSubmit: (v) => run(() => api('POST', '/api/bids', { lotId: id, ...v }), 'Bid recorded'),
    });
  }
  if (act === 'edit-bidder') {
    const b = bidderById(id);
    openModal({
      title: `Edit bidder #${b.number}`,
      fields: bidderFields(b),
      onSubmit: (v) => run(() => api('PUT', `/api/bidders/${id}`, v), 'Bidder updated'),
    });
  }
  if (act === 'del-bidder') {
    if (confirm('Delete this bidder?')) run(() => api('DELETE', `/api/bidders/${id}`), 'Bidder deleted');
  }
  if (act === 'pay-invoice') run(() => api('PUT', `/api/invoices/${id}`, { status: 'paid' }), 'Invoice marked paid');
  if (act === 'unpay-invoice') run(() => api('PUT', `/api/invoices/${id}`, { status: 'unpaid' }), 'Invoice marked unpaid');
  if (act === 'void-invoice') {
    if (confirm('Void this invoice? Its lots can then be re-invoiced or edited.'))
      run(() => api('PUT', `/api/invoices/${id}`, { status: 'void' }), 'Invoice voided');
  }
});

refresh();
