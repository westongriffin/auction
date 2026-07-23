// Brinkley Auctions — business logic core.
// Runs in Node (required by server.js) AND in the browser (demo mode on static
// hosting, where it executes against localStorage instead of a server).
// createBrinkleyCore(persist) — persist: { load(): object|null, save(db): void }

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.createBrinkleyCore = factory().createBrinkleyCore;
})(typeof self !== 'undefined' ? self : this, function () {

  const AUDIT_CAP = 5000;

  const DEFAULT_SETTINGS = {
    businessName: 'Brinkley Auctions Inc.',
    address: '',
    phone: '',
    buyersPremiumPct: 15,
    taxPct: 0,
    defaultCommissionPct: 20,
    invoiceFooter: 'All sales are final. Items sold as-is, where-is.',
    portalUrl: '',
    pin: '',
    nextInvoiceNumber: 1000,
    nextSettlementNumber: 5000,
    nextConsignorNumber: 1,
  };

  function migrate(d) {
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    delete d.settings.nextBidderNumber;
    for (const key of ['auctions', 'bidders', 'consignors', 'registrations', 'lots', 'bids', 'invoices', 'settlements', 'auditLog']) {
      if (!Array.isArray(d[key])) d[key] = [];
    }
    for (const a of d.auctions) {
      if (a.premiumPct === undefined) a.premiumPct = null;
      if (a.taxPct === undefined) a.taxPct = null;
    }
    for (const l of d.lots) {
      if (l.quantity === undefined || !(Number(l.quantity) >= 1)) l.quantity = 1;
      if (l.consignorId === undefined) l.consignorId = null;
      if (l.winningRegId === undefined) l.winningRegId = null;
      delete l.winningBidderId;
      if (l.settlementId === undefined) l.settlementId = null;
    }
    for (const b of d.bidders) {
      if (b.taxExempt === undefined) b.taxExempt = false;
      if (b.idNumber === undefined) b.idNumber = '';
      if (b.portalCode === undefined) b.portalCode = null;
    }
    for (const c of d.consignors) {
      if (c.portalCode === undefined) c.portalCode = null;
    }
    for (const inv of d.invoices) {
      if (!Array.isArray(inv.payments)) inv.payments = [];
      if (inv.amountPaid === undefined) inv.amountPaid = 0;
    }
    return d;
  }

  function createBrinkleyCore(persist) {
    let db = migrate(persist.load() || {});
    const saveDb = () => persist.save(db);

    let idCounter = Date.now();
    const newId = () => (++idCounter).toString(36);

    const num = (v, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const round2 = (n) => Math.round(n * 100) / 100;
    const findById = (arr, id) => arr.find((x) => x.id === id);
    function removeById(arr, id) {
      const i = arr.findIndex((x) => x.id === id);
      if (i === -1) return false;
      arr.splice(i, 1);
      return true;
    }

    function audit(action, detail) {
      db.auditLog.unshift({ id: newId(), time: new Date().toISOString(), action, detail });
      if (db.auditLog.length > AUDIT_CAP) db.auditLog.length = AUDIT_CAP;
    }

    const auctionPremiumPct = (a) => (a.premiumPct === null || a.premiumPct === undefined ? db.settings.buyersPremiumPct : a.premiumPct);
    const auctionTaxPct = (a) => (a.taxPct === null || a.taxPct === undefined ? db.settings.taxPct : a.taxPct);
    const lotAmount = (l) => round2((l.hammerPrice || 0) * (l.quantity || 1));
    const regByPaddle = (auctionId, paddle) => db.registrations.find((r) => r.auctionId === auctionId && r.paddle === paddle);
    const bidderOfReg = (reg) => (reg ? findById(db.bidders, reg.bidderId) : null);
    function invoiceStatusOf(inv) {
      if (inv.status === 'void') return 'void';
      if (inv.amountPaid >= inv.total - 0.005) return 'paid';
      if (inv.amountPaid > 0) return 'partial';
      return 'unpaid';
    }

    // ---------- routes ----------

    const routes = [];
    function route(method, pattern, handler) {
      const keys = [];
      const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
      routes.push({ method, regex, keys, handler });
    }

    route('POST', '/api/client-error', (params, body) => {
      audit('client.error', String(body.msg || 'unknown').slice(0, 500));
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- settings --
    route('GET', '/api/settings', () => {
      const { pin, ...rest } = db.settings;
      return { status: 200, body: { ...rest, pinSet: !!pin } };
    });
    route('PUT', '/api/settings', (params, body) => {
      const s = db.settings;
      for (const k of ['businessName', 'address', 'phone', 'invoiceFooter']) {
        if (body[k] !== undefined) s[k] = String(body[k]);
      }
      for (const k of ['buyersPremiumPct', 'taxPct', 'defaultCommissionPct']) {
        if (body[k] !== undefined) s[k] = num(body[k], s[k]);
      }
      if (body.newPin !== undefined) {
        s.pin = String(body.newPin).trim();
        audit('settings.pin', s.pin ? 'PIN changed' : 'PIN removed (login disabled)');
      }
      audit('settings.update', 'Settings updated');
      saveDb();
      const { pin, ...rest } = s;
      return { status: 200, body: { ...rest, pinSet: !!pin } };
    });

    // -- auctions --
    route('GET', '/api/auctions', () => ({ status: 200, body: db.auctions }));
    route('POST', '/api/auctions', (params, body) => {
      if (!body.title) return { status: 400, body: { error: 'Title is required' } };
      const auction = {
        id: newId(),
        title: String(body.title),
        date: body.date || '',
        location: body.location || '',
        status: body.status || 'upcoming',
        premiumPct: body.premiumPct === '' || body.premiumPct === undefined || body.premiumPct === null ? null : num(body.premiumPct),
        taxPct: body.taxPct === '' || body.taxPct === undefined || body.taxPct === null ? null : num(body.taxPct),
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
      };
      db.auctions.push(auction);
      audit('auction.create', `Auction "${auction.title}" created`);
      saveDb();
      return { status: 201, body: auction };
    });
    route('PUT', '/api/auctions/:id', (params, body) => {
      const auction = findById(db.auctions, params.id);
      if (!auction) return { status: 404, body: { error: 'Auction not found' } };
      for (const k of ['title', 'date', 'location', 'status', 'notes']) {
        if (body[k] !== undefined) auction[k] = body[k];
      }
      for (const k of ['premiumPct', 'taxPct']) {
        if (body[k] !== undefined) auction[k] = body[k] === '' || body[k] === null ? null : num(body[k]);
      }
      audit('auction.update', `Auction "${auction.title}" updated`);
      saveDb();
      return { status: 200, body: auction };
    });
    route('DELETE', '/api/auctions/:id', (params) => {
      const auction = findById(db.auctions, params.id);
      if (!auction) return { status: 404, body: { error: 'Auction not found' } };
      if (db.lots.some((l) => l.auctionId === params.id)) {
        return { status: 400, body: { error: 'Auction has lots; delete or reassign them first' } };
      }
      if (db.registrations.some((r) => r.auctionId === params.id)) {
        return { status: 400, body: { error: 'Auction has bidder registrations; remove them first' } };
      }
      removeById(db.auctions, params.id);
      audit('auction.delete', `Auction "${auction.title}" deleted`);
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- consignors --
    route('GET', '/api/consignors', () => ({ status: 200, body: db.consignors }));
    route('POST', '/api/consignors', (params, body) => {
      if (!body.name) return { status: 400, body: { error: 'Name is required' } };
      const consignor = {
        id: newId(),
        code: 'C' + String(db.settings.nextConsignorNumber++).padStart(3, '0'),
        name: String(body.name),
        email: body.email || '',
        phone: body.phone || '',
        address: body.address || '',
        commissionPct: body.commissionPct === '' || body.commissionPct === undefined || body.commissionPct === null ? null : num(body.commissionPct),
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
      };
      db.consignors.push(consignor);
      audit('consignor.create', `Consignor ${consignor.code} "${consignor.name}" created`);
      saveDb();
      return { status: 201, body: consignor };
    });
    route('PUT', '/api/consignors/:id', (params, body) => {
      const c = findById(db.consignors, params.id);
      if (!c) return { status: 404, body: { error: 'Consignor not found' } };
      for (const k of ['name', 'email', 'phone', 'address', 'notes']) {
        if (body[k] !== undefined) c[k] = body[k];
      }
      if (body.commissionPct !== undefined) {
        c.commissionPct = body.commissionPct === '' || body.commissionPct === null ? null : num(body.commissionPct);
      }
      audit('consignor.update', `Consignor ${c.code} "${c.name}" updated`);
      saveDb();
      return { status: 200, body: c };
    });
    route('DELETE', '/api/consignors/:id', (params) => {
      const c = findById(db.consignors, params.id);
      if (!c) return { status: 404, body: { error: 'Consignor not found' } };
      if (db.lots.some((l) => l.consignorId === params.id) || db.settlements.some((s) => s.consignorId === params.id)) {
        return { status: 400, body: { error: 'Consignor has lots or settlements and cannot be deleted' } };
      }
      removeById(db.consignors, params.id);
      audit('consignor.delete', `Consignor ${c.code} "${c.name}" deleted`);
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- bidders --
    route('GET', '/api/bidders', () => ({ status: 200, body: db.bidders }));
    route('POST', '/api/bidders', (params, body) => {
      if (!body.name) return { status: 400, body: { error: 'Name is required' } };
      const bidder = {
        id: newId(),
        name: String(body.name),
        email: body.email || '',
        phone: body.phone || '',
        address: body.address || '',
        idNumber: body.idNumber || '',
        taxExempt: !!body.taxExempt,
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
      };
      db.bidders.push(bidder);
      audit('bidder.create', `Bidder "${bidder.name}" added to customer file`);
      saveDb();
      return { status: 201, body: bidder };
    });
    route('PUT', '/api/bidders/:id', (params, body) => {
      const bidder = findById(db.bidders, params.id);
      if (!bidder) return { status: 404, body: { error: 'Bidder not found' } };
      for (const k of ['name', 'email', 'phone', 'address', 'idNumber', 'notes']) {
        if (body[k] !== undefined) bidder[k] = body[k];
      }
      if (body.taxExempt !== undefined) bidder.taxExempt = !!body.taxExempt;
      audit('bidder.update', `Bidder "${bidder.name}" updated`);
      saveDb();
      return { status: 200, body: bidder };
    });
    route('DELETE', '/api/bidders/:id', (params) => {
      const bidder = findById(db.bidders, params.id);
      if (!bidder) return { status: 404, body: { error: 'Bidder not found' } };
      const inUse = db.registrations.some((r) => r.bidderId === params.id) ||
        db.bids.some((b) => b.bidderId === params.id) ||
        db.invoices.some((i) => i.bidderId === params.id);
      if (inUse) return { status: 400, body: { error: 'Bidder has registrations, bids, or invoices and cannot be deleted' } };
      removeById(db.bidders, params.id);
      audit('bidder.delete', `Bidder "${bidder.name}" deleted`);
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- registrations --
    route('GET', '/api/registrations', (params, body, query) => {
      const list = query.auctionId ? db.registrations.filter((r) => r.auctionId === query.auctionId) : db.registrations;
      return { status: 200, body: list };
    });
    route('POST', '/api/registrations', (params, body) => {
      const auction = findById(db.auctions, body.auctionId);
      if (!auction) return { status: 400, body: { error: 'A valid auction is required' } };

      let bidder;
      if (body.bidderId) {
        bidder = findById(db.bidders, body.bidderId);
        if (!bidder) return { status: 400, body: { error: 'Bidder not found' } };
      } else if (body.newBidder && body.newBidder.name) {
        bidder = {
          id: newId(),
          name: String(body.newBidder.name),
          email: body.newBidder.email || '',
          phone: body.newBidder.phone || '',
          address: body.newBidder.address || '',
          idNumber: body.newBidder.idNumber || '',
          taxExempt: !!body.newBidder.taxExempt,
          notes: '',
          createdAt: new Date().toISOString(),
        };
        db.bidders.push(bidder);
        audit('bidder.create', `Bidder "${bidder.name}" added at check-in`);
      } else {
        return { status: 400, body: { error: 'Choose an existing bidder or provide a new bidder name' } };
      }

      if (db.registrations.some((r) => r.auctionId === auction.id && r.bidderId === bidder.id)) {
        return { status: 400, body: { error: `${bidder.name} is already registered for this auction` } };
      }
      const inAuction = db.registrations.filter((r) => r.auctionId === auction.id);
      const paddle = body.paddle ? num(body.paddle) : inAuction.reduce((m, r) => Math.max(m, r.paddle), 99) + 1;
      if (paddle < 1) return { status: 400, body: { error: 'Paddle number must be positive' } };
      if (inAuction.some((r) => r.paddle === paddle)) {
        return { status: 400, body: { error: `Paddle #${paddle} is already assigned in this auction` } };
      }
      const reg = {
        id: newId(),
        auctionId: auction.id,
        bidderId: bidder.id,
        paddle,
        taxExempt: body.taxExempt !== undefined ? !!body.taxExempt : !!bidder.taxExempt,
        registeredAt: new Date().toISOString(),
      };
      db.registrations.push(reg);
      audit('registration.create', `Paddle #${paddle} → ${bidder.name} (${auction.title})`);
      saveDb();
      return { status: 201, body: reg };
    });
    route('PUT', '/api/registrations/:id', (params, body) => {
      const reg = findById(db.registrations, params.id);
      if (!reg) return { status: 404, body: { error: 'Registration not found' } };
      if (body.paddle !== undefined) {
        const paddle = num(body.paddle);
        if (paddle < 1) return { status: 400, body: { error: 'Paddle number must be positive' } };
        if (db.registrations.some((r) => r.id !== reg.id && r.auctionId === reg.auctionId && r.paddle === paddle)) {
          return { status: 400, body: { error: `Paddle #${paddle} is already assigned in this auction` } };
        }
        reg.paddle = paddle;
      }
      if (body.taxExempt !== undefined) reg.taxExempt = !!body.taxExempt;
      audit('registration.update', `Registration paddle #${reg.paddle} updated`);
      saveDb();
      return { status: 200, body: reg };
    });
    route('DELETE', '/api/registrations/:id', (params) => {
      const reg = findById(db.registrations, params.id);
      if (!reg) return { status: 404, body: { error: 'Registration not found' } };
      if (db.lots.some((l) => l.winningRegId === reg.id) || db.invoices.some((i) => i.regId === reg.id && i.status !== 'void')) {
        return { status: 400, body: { error: 'This paddle has purchases and cannot be removed' } };
      }
      const bidder = bidderOfReg(reg);
      removeById(db.registrations, params.id);
      audit('registration.delete', `Paddle #${reg.paddle} (${bidder ? bidder.name : '?'}) removed`);
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- lots --
    route('GET', '/api/lots', () => ({ status: 200, body: db.lots }));
    route('POST', '/api/lots', (params, body) => {
      if (!body.title) return { status: 400, body: { error: 'Title is required' } };
      if (!body.auctionId || !findById(db.auctions, body.auctionId)) {
        return { status: 400, body: { error: 'A valid auction is required' } };
      }
      if (body.consignorId && !findById(db.consignors, body.consignorId)) {
        return { status: 400, body: { error: 'Consignor not found' } };
      }
      const inAuction = db.lots.filter((l) => l.auctionId === body.auctionId);
      const lot = {
        id: newId(),
        auctionId: body.auctionId,
        lotNumber: body.lotNumber ? num(body.lotNumber) : inAuction.reduce((m, l) => Math.max(m, l.lotNumber), 0) + 1,
        title: String(body.title),
        description: body.description || '',
        category: body.category || '',
        consignorId: body.consignorId || null,
        quantity: Math.max(1, Math.round(num(body.quantity, 1))),
        startingBid: num(body.startingBid),
        reserve: num(body.reserve),
        status: 'open',
        hammerPrice: null,
        winningRegId: null,
        invoiceId: null,
        settlementId: null,
        createdAt: new Date().toISOString(),
      };
      db.lots.push(lot);
      audit('lot.create', `Lot ${lot.lotNumber} "${lot.title}" added`);
      saveDb();
      return { status: 201, body: lot };
    });
    route('PUT', '/api/lots/:id', (params, body) => {
      const lot = findById(db.lots, params.id);
      if (!lot) return { status: 404, body: { error: 'Lot not found' } };
      if ((lot.invoiceId || lot.settlementId) &&
          (body.status !== undefined || body.hammerPrice !== undefined || body.quantity !== undefined || body.consignorId !== undefined)) {
        return { status: 400, body: { error: 'Lot is on an invoice or settlement; void that document first' } };
      }
      if (body.consignorId !== undefined && body.consignorId && !findById(db.consignors, body.consignorId)) {
        return { status: 400, body: { error: 'Consignor not found' } };
      }
      for (const k of ['title', 'description', 'category', 'auctionId']) {
        if (body[k] !== undefined) lot[k] = body[k];
      }
      if (body.consignorId !== undefined) lot.consignorId = body.consignorId || null;
      if (body.lotNumber !== undefined) lot.lotNumber = num(body.lotNumber, lot.lotNumber);
      if (body.quantity !== undefined) lot.quantity = Math.max(1, Math.round(num(body.quantity, lot.quantity)));
      if (body.startingBid !== undefined) lot.startingBid = num(body.startingBid);
      if (body.reserve !== undefined) lot.reserve = num(body.reserve);
      audit('lot.update', `Lot ${lot.lotNumber} "${lot.title}" updated`);
      saveDb();
      return { status: 200, body: lot };
    });
    route('DELETE', '/api/lots/:id', (params) => {
      const lot = findById(db.lots, params.id);
      if (!lot) return { status: 404, body: { error: 'Lot not found' } };
      if (lot.invoiceId || lot.settlementId) {
        return { status: 400, body: { error: 'Lot is on an invoice or settlement and cannot be deleted' } };
      }
      db.bids = db.bids.filter((b) => b.lotId !== params.id);
      removeById(db.lots, params.id);
      audit('lot.delete', `Lot ${lot.lotNumber} "${lot.title}" deleted`);
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- absentee bids --
    route('GET', '/api/bids', () => ({ status: 200, body: db.bids }));
    route('POST', '/api/bids', (params, body) => {
      const lot = findById(db.lots, body.lotId);
      if (!lot) return { status: 400, body: { error: 'A valid lot is required' } };
      if (lot.status !== 'open') return { status: 400, body: { error: 'This lot is no longer open' } };
      const bidder = findById(db.bidders, body.bidderId);
      if (!bidder) return { status: 400, body: { error: 'A valid bidder is required' } };
      const amount = num(body.amount);
      if (amount <= 0) return { status: 400, body: { error: 'Bid amount must be positive' } };
      const bid = { id: newId(), lotId: lot.id, bidderId: bidder.id, amount, time: new Date().toISOString() };
      db.bids.push(bid);
      audit('bid.absentee', `Absentee bid $${amount} on lot ${lot.lotNumber} by ${bidder.name}`);
      saveDb();
      return { status: 201, body: bid };
    });
    route('DELETE', '/api/bids/:id', (params) => {
      const bid = findById(db.bids, params.id);
      if (!bid) return { status: 404, body: { error: 'Bid not found' } };
      removeById(db.bids, params.id);
      audit('bid.delete', 'Absentee bid removed');
      saveDb();
      return { status: 200, body: { ok: true } };
    });

    // -- clerking --
    route('POST', '/api/clerk/sell', (params, body) => {
      const lot = findById(db.lots, body.lotId);
      if (!lot) return { status: 400, body: { error: 'Lot not found' } };
      if (lot.status !== 'open') return { status: 400, body: { error: `Lot ${lot.lotNumber} is already ${lot.status}` } };
      const paddle = num(body.paddle);
      const reg = regByPaddle(lot.auctionId, paddle);
      if (!reg) return { status: 400, body: { error: `Paddle #${paddle || '?'} is not registered for this auction` } };
      const price = num(body.price);
      if (price <= 0) return { status: 400, body: { error: 'Price must be positive' } };
      lot.status = 'sold';
      lot.hammerPrice = round2(price);
      lot.winningRegId = reg.id;
      const bidder = bidderOfReg(reg);
      audit('lot.sold', `Lot ${lot.lotNumber} "${lot.title}" sold to paddle #${paddle} (${bidder ? bidder.name : '?'}) for $${lot.hammerPrice}${lot.quantity > 1 ? ` × ${lot.quantity}` : ''}`);
      saveDb();
      return { status: 200, body: lot };
    });
    route('POST', '/api/clerk/pass', (params, body) => {
      const lot = findById(db.lots, body.lotId);
      if (!lot) return { status: 400, body: { error: 'Lot not found' } };
      if (lot.status !== 'open') return { status: 400, body: { error: `Lot ${lot.lotNumber} is already ${lot.status}` } };
      lot.status = 'passed';
      audit('lot.passed', `Lot ${lot.lotNumber} "${lot.title}" passed (no sale)`);
      saveDb();
      return { status: 200, body: lot };
    });
    route('POST', '/api/clerk/reopen', (params, body) => {
      const lot = findById(db.lots, body.lotId);
      if (!lot) return { status: 400, body: { error: 'Lot not found' } };
      if (lot.invoiceId || lot.settlementId) {
        return { status: 400, body: { error: 'Lot is on an invoice or settlement; void that document first' } };
      }
      audit('lot.reopen', `Lot ${lot.lotNumber} "${lot.title}" reopened (was ${lot.status})`);
      lot.status = 'open';
      lot.hammerPrice = null;
      lot.winningRegId = null;
      saveDb();
      return { status: 200, body: lot };
    });

    // -- invoices --
    route('GET', '/api/invoices', () => ({ status: 200, body: db.invoices }));
    route('POST', '/api/invoices/generate', (params, body) => {
      const auction = findById(db.auctions, body.auctionId);
      if (!auction) return { status: 400, body: { error: 'A valid auction is required' } };
      const sellable = db.lots.filter((l) => l.auctionId === auction.id && l.status === 'sold' && !l.invoiceId && l.winningRegId);
      if (!sellable.length) return { status: 400, body: { error: 'No uninvoiced sold lots in this auction' } };

      const byReg = new Map();
      for (const lot of sellable) {
        if (!byReg.has(lot.winningRegId)) byReg.set(lot.winningRegId, []);
        byReg.get(lot.winningRegId).push(lot);
      }
      const created = [];
      for (const [regId, lots] of byReg) {
        const reg = findById(db.registrations, regId);
        if (!reg) continue;
        const bidder = bidderOfReg(reg);
        const subtotal = round2(lots.reduce((s, l) => s + lotAmount(l), 0));
        const premiumPct = auctionPremiumPct(auction);
        const premium = round2(subtotal * premiumPct / 100);
        const taxPct = reg.taxExempt ? 0 : auctionTaxPct(auction);
        const tax = round2((subtotal + premium) * taxPct / 100);
        const invoice = {
          id: newId(),
          number: db.settings.nextInvoiceNumber++,
          auctionId: auction.id,
          regId: reg.id,
          bidderId: reg.bidderId,
          paddle: reg.paddle,
          lineItems: lots.sort((a, b) => a.lotNumber - b.lotNumber).map((l) => ({
            lotId: l.id, lotNumber: l.lotNumber, title: l.title,
            quantity: l.quantity, hammerPrice: l.hammerPrice, amount: lotAmount(l),
          })),
          subtotal, premiumPct, premium, taxPct, tax,
          taxExempt: !!reg.taxExempt,
          total: round2(subtotal + premium + tax),
          payments: [],
          amountPaid: 0,
          status: 'unpaid',
          createdAt: new Date().toISOString(),
        };
        for (const l of lots) l.invoiceId = invoice.id;
        db.invoices.push(invoice);
        created.push(invoice);
        audit('invoice.create', `Invoice INV-${invoice.number} for paddle #${reg.paddle} (${bidder ? bidder.name : '?'}): $${invoice.total}`);
      }
      saveDb();
      return { status: 201, body: created };
    });
    route('POST', '/api/invoices/:id/payments', (params, body) => {
      const inv = findById(db.invoices, params.id);
      if (!inv) return { status: 404, body: { error: 'Invoice not found' } };
      if (inv.status === 'void') return { status: 400, body: { error: 'Invoice is void' } };
      const amount = round2(num(body.amount));
      if (amount <= 0) return { status: 400, body: { error: 'Payment amount must be positive' } };
      const balance = round2(inv.total - inv.amountPaid);
      if (amount > balance + 0.005) return { status: 400, body: { error: `Payment exceeds balance of $${balance}` } };
      const method = ['cash', 'check', 'card', 'other'].includes(body.method) ? body.method : 'other';
      const payment = { id: newId(), amount, method, note: body.note || '', time: new Date().toISOString() };
      inv.payments.push(payment);
      inv.amountPaid = round2(inv.payments.reduce((s, p) => s + p.amount, 0));
      inv.status = invoiceStatusOf(inv);
      audit('invoice.payment', `INV-${inv.number}: $${amount} ${method}${inv.status === 'paid' ? ' (paid in full)' : ` (balance $${round2(inv.total - inv.amountPaid)})`}`);
      saveDb();
      return { status: 201, body: inv };
    });
    route('DELETE', '/api/invoices/:id/payments/:pid', (params) => {
      const inv = findById(db.invoices, params.id);
      if (!inv) return { status: 404, body: { error: 'Invoice not found' } };
      const payment = findById(inv.payments, params.pid);
      if (!payment) return { status: 404, body: { error: 'Payment not found' } };
      removeById(inv.payments, params.pid);
      inv.amountPaid = round2(inv.payments.reduce((s, p) => s + p.amount, 0));
      if (inv.status !== 'void') inv.status = invoiceStatusOf(inv);
      audit('invoice.payment.delete', `INV-${inv.number}: removed $${payment.amount} ${payment.method} payment`);
      saveDb();
      return { status: 200, body: inv };
    });
    route('PUT', '/api/invoices/:id', (params, body) => {
      const inv = findById(db.invoices, params.id);
      if (!inv) return { status: 404, body: { error: 'Invoice not found' } };
      if (body.status === 'void' && inv.status !== 'void') {
        if (inv.amountPaid > 0) {
          return { status: 400, body: { error: 'Invoice has payments; remove them before voiding' } };
        }
        inv.status = 'void';
        for (const item of inv.lineItems) {
          const lot = findById(db.lots, item.lotId);
          if (lot) lot.invoiceId = null;
        }
        audit('invoice.void', `Invoice INV-${inv.number} voided`);
        saveDb();
        return { status: 200, body: inv };
      }
      return { status: 400, body: { error: 'Invalid status change' } };
    });

    // -- settlements --
    route('GET', '/api/settlements', () => ({ status: 200, body: db.settlements }));
    route('POST', '/api/settlements/generate', (params, body) => {
      const auction = findById(db.auctions, body.auctionId);
      if (!auction) return { status: 400, body: { error: 'A valid auction is required' } };
      const eligible = db.lots.filter((l) =>
        l.auctionId === auction.id && l.consignorId && l.status === 'sold' && !l.settlementId);
      if (!eligible.length) {
        return { status: 400, body: { error: 'No unsettled sold lots with a consignor in this auction' } };
      }
      const byConsignor = new Map();
      for (const lot of eligible) {
        if (!byConsignor.has(lot.consignorId)) byConsignor.set(lot.consignorId, []);
        byConsignor.get(lot.consignorId).push(lot);
      }
      const created = [];
      for (const [consignorId, lots] of byConsignor) {
        const consignor = findById(db.consignors, consignorId);
        if (!consignor) continue;
        const passed = db.lots.filter((l) =>
          l.auctionId === auction.id && l.consignorId === consignorId && l.status === 'passed');
        const grossHammer = round2(lots.reduce((s, l) => s + lotAmount(l), 0));
        const commissionPct = consignor.commissionPct === null || consignor.commissionPct === undefined
          ? db.settings.defaultCommissionPct : consignor.commissionPct;
        const commission = round2(grossHammer * commissionPct / 100);
        const settlement = {
          id: newId(),
          number: db.settings.nextSettlementNumber++,
          auctionId: auction.id,
          consignorId,
          lineItems: lots.sort((a, b) => a.lotNumber - b.lotNumber).map((l) => ({
            lotId: l.id, lotNumber: l.lotNumber, title: l.title,
            quantity: l.quantity, hammerPrice: l.hammerPrice, amount: lotAmount(l), result: 'sold',
          })),
          passedItems: passed.sort((a, b) => a.lotNumber - b.lotNumber).map((l) => ({
            lotId: l.id, lotNumber: l.lotNumber, title: l.title, result: 'passed',
          })),
          grossHammer, commissionPct, commission,
          netDue: round2(grossHammer - commission),
          status: 'owed',
          method: '',
          paidAt: null,
          createdAt: new Date().toISOString(),
        };
        for (const l of lots) l.settlementId = settlement.id;
        db.settlements.push(settlement);
        created.push(settlement);
        audit('settlement.create', `Settlement ST-${settlement.number} for ${consignor.code} "${consignor.name}": net $${settlement.netDue}`);
      }
      saveDb();
      return { status: 201, body: created };
    });
    route('PUT', '/api/settlements/:id', (params, body) => {
      const st = findById(db.settlements, params.id);
      if (!st) return { status: 404, body: { error: 'Settlement not found' } };
      const consignor = findById(db.consignors, st.consignorId);
      if (body.status === 'paid' && st.status === 'owed') {
        st.status = 'paid';
        st.method = ['cash', 'check', 'card', 'other'].includes(body.method) ? body.method : 'check';
        st.paidAt = new Date().toISOString();
        audit('settlement.paid', `Settlement ST-${st.number} paid to ${consignor ? consignor.name : '?'} ($${st.netDue}, ${st.method})`);
      } else if (body.status === 'owed' && st.status === 'paid') {
        st.status = 'owed';
        st.method = '';
        st.paidAt = null;
        audit('settlement.unpaid', `Settlement ST-${st.number} marked unpaid`);
      } else if (body.status === 'void' && st.status !== 'void') {
        st.status = 'void';
        for (const item of st.lineItems) {
          const lot = findById(db.lots, item.lotId);
          if (lot) lot.settlementId = null;
        }
        audit('settlement.void', `Settlement ST-${st.number} voided`);
      } else {
        return { status: 400, body: { error: 'Invalid status change' } };
      }
      saveDb();
      return { status: 200, body: st };
    });

    // -- customer & consignor portals --
    // Access is by per-person code. Portal payloads contain ONLY that person's
    // data and never expose reserves, internal notes, ID numbers, or other
    // customers' records.

    const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    function makePortalCode() {
      let raw = '';
      for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      return raw.slice(0, 4) + '-' + raw.slice(4);
    }
    function issueCode() {
      let code;
      do { code = makePortalCode(); }
      while (db.bidders.some((x) => x.portalCode === code) || db.consignors.some((x) => x.portalCode === code));
      return code;
    }
    const normCode = (c) => String(c || '').trim().toUpperCase();
    const bidderByCode = (c) => { const code = normCode(c); return code ? db.bidders.find((b) => b.portalCode === code) : null; };
    const consignorByCode = (c) => { const code = normCode(c); return code ? db.consignors.find((x) => x.portalCode === code) : null; };
    const auctionRef = (id) => {
      const a = findById(db.auctions, id);
      return a ? { title: a.title, date: a.date, status: a.status } : { title: '?', date: '', status: '' };
    };

    route('POST', '/api/bidders/:id/portal-code', (params) => {
      const b = findById(db.bidders, params.id);
      if (!b) return { status: 404, body: { error: 'Bidder not found' } };
      b.portalCode = issueCode();
      audit('portal.code', `Portal code issued for bidder "${b.name}"`);
      saveDb();
      return { status: 200, body: { code: b.portalCode } };
    });
    route('POST', '/api/consignors/:id/portal-code', (params) => {
      const c = findById(db.consignors, params.id);
      if (!c) return { status: 404, body: { error: 'Consignor not found' } };
      c.portalCode = issueCode();
      audit('portal.code', `Portal code issued for consignor ${c.code} "${c.name}"`);
      saveDb();
      return { status: 200, body: { code: c.portalCode } };
    });

    route('GET', '/api/portal/lookup', (params, body, query) => {
      const b = bidderByCode(query.code);
      if (b) return { status: 200, body: { type: 'bidder', name: b.name } };
      const c = consignorByCode(query.code);
      if (c) return { status: 200, body: { type: 'consignor', name: c.name } };
      return { status: 404, body: { error: 'Code not recognized — check with the auction office' } };
    });

    route('GET', '/api/portal/bidder', (params, body, query) => {
      const bd = bidderByCode(query.code);
      if (!bd) return { status: 404, body: { error: 'Code not recognized' } };
      const regs = db.registrations.filter((r) => r.bidderId === bd.id);
      const regIds = new Set(regs.map((r) => r.id));
      const wins = db.lots.filter((l) => l.status === 'sold' && regIds.has(l.winningRegId));
      const invoices = db.invoices.filter((i) => i.bidderId === bd.id && i.status !== 'void');
      return {
        status: 200,
        body: {
          name: bd.name,
          email: bd.email,
          phone: bd.phone,
          taxExempt: !!bd.taxExempt,
          balanceDue: round2(invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)),
          lifetimeHammer: round2(wins.reduce((s, l) => s + lotAmount(l), 0)),
          registrations: regs.map((r) => ({ paddle: r.paddle, taxExempt: r.taxExempt, auction: auctionRef(r.auctionId) })),
          purchases: wins.map((l) => ({
            auction: auctionRef(l.auctionId), lotNumber: l.lotNumber, title: l.title,
            quantity: l.quantity, hammerPrice: l.hammerPrice, amount: lotAmount(l),
          })),
          invoices: invoices.map((i) => ({
            number: i.number, auction: auctionRef(i.auctionId), createdAt: i.createdAt,
            lineItems: i.lineItems, subtotal: i.subtotal, premiumPct: i.premiumPct, premium: i.premium,
            taxPct: i.taxPct, tax: i.tax, total: i.total, amountPaid: i.amountPaid,
            balance: round2(i.total - i.amountPaid), status: i.status,
            payments: i.payments.map((p) => ({ amount: p.amount, method: p.method, time: p.time })),
          })),
          absenteeBids: db.bids.filter((x) => x.bidderId === bd.id).map((x) => {
            const l = findById(db.lots, x.lotId);
            return l ? {
              auction: auctionRef(l.auctionId), lotNumber: l.lotNumber, title: l.title,
              amount: x.amount, lotStatus: l.status,
              won: l.status === 'sold' && regIds.has(l.winningRegId),
            } : null;
          }).filter(Boolean),
        },
      };
    });

    route('GET', '/api/portal/consignor', (params, body, query) => {
      const c = consignorByCode(query.code);
      if (!c) return { status: 404, body: { error: 'Code not recognized' } };
      const lots = db.lots.filter((l) => l.consignorId === c.id);
      const sold = lots.filter((l) => l.status === 'sold');
      const settlements = db.settlements.filter((s) => s.consignorId === c.id && s.status !== 'void');
      const byAuction = new Map();
      for (const l of lots) {
        if (!byAuction.has(l.auctionId)) byAuction.set(l.auctionId, { auction: auctionRef(l.auctionId), lots: [] });
        byAuction.get(l.auctionId).lots.push({
          lotNumber: l.lotNumber, title: l.title, quantity: l.quantity, status: l.status,
          hammerPrice: l.hammerPrice, amount: l.status === 'sold' ? lotAmount(l) : null,
        });
      }
      for (const g of byAuction.values()) g.lots.sort((a, b) => a.lotNumber - b.lotNumber);
      return {
        status: 200,
        body: {
          name: c.name,
          code: c.code,
          commissionPct: c.commissionPct === null || c.commissionPct === undefined ? db.settings.defaultCommissionPct : c.commissionPct,
          totals: {
            consigned: lots.length,
            sold: sold.length,
            gross: round2(sold.reduce((s, l) => s + lotAmount(l), 0)),
            netPaid: round2(settlements.filter((s) => s.status === 'paid').reduce((s, x) => s + x.netDue, 0)),
            owedNow: round2(settlements.filter((s) => s.status === 'owed').reduce((s, x) => s + x.netDue, 0)),
          },
          lotsByAuction: [...byAuction.values()],
          settlements: settlements.map((s) => ({
            number: s.number, auction: auctionRef(s.auctionId), grossHammer: s.grossHammer,
            commissionPct: s.commissionPct, commission: s.commission, netDue: s.netDue,
            status: s.status, paidAt: s.paidAt, method: s.method, createdAt: s.createdAt,
          })),
        },
      };
    });

    route('GET', '/api/portal/catalog', (params, body, query) => {
      const bd = bidderByCode(query.code);
      const cs = bd ? null : consignorByCode(query.code);
      if (!bd && !cs) return { status: 404, body: { error: 'Code not recognized' } };
      const myBidMax = (lotId) => {
        if (!bd) return null;
        const mine = db.bids.filter((x) => x.lotId === lotId && x.bidderId === bd.id);
        return mine.length ? Math.max(...mine.map((x) => x.amount)) : null;
      };
      return {
        status: 200,
        body: {
          canBid: !!bd,
          auctions: db.auctions.filter((a) => a.status !== 'closed')
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .map((a) => ({
              id: a.id, title: a.title, date: a.date, location: a.location, status: a.status,
              premiumPct: auctionPremiumPct(a),
              lots: db.lots.filter((l) => l.auctionId === a.id).sort((x, y) => x.lotNumber - y.lotNumber)
                .map((l) => ({
                  id: l.id, lotNumber: l.lotNumber, title: l.title, description: l.description,
                  category: l.category, quantity: l.quantity, startingBid: l.startingBid,
                  status: l.status, absenteeCount: db.bids.filter((x) => x.lotId === l.id).length,
                  myBid: myBidMax(l.id),
                })),
            })),
        },
      };
    });

    route('POST', '/api/portal/absentee', (params, body) => {
      const bd = bidderByCode(body.code);
      if (!bd) return { status: 404, body: { error: 'Code not recognized' } };
      const lot = findById(db.lots, body.lotId);
      if (!lot) return { status: 400, body: { error: 'Lot not found' } };
      if (lot.status !== 'open') return { status: 400, body: { error: 'This lot is no longer open for bids' } };
      const auction = findById(db.auctions, lot.auctionId);
      if (!auction || auction.status === 'closed') return { status: 400, body: { error: 'This auction has closed' } };
      const amount = round2(num(body.amount));
      if (amount <= 0) return { status: 400, body: { error: 'Bid amount must be positive' } };
      const prev = db.bids.filter((x) => x.lotId === lot.id && x.bidderId === bd.id);
      if (prev.length && amount <= Math.max(...prev.map((x) => x.amount))) {
        return { status: 400, body: { error: 'New bid must be higher than your current bid' } };
      }
      const bid = { id: newId(), lotId: lot.id, bidderId: bd.id, amount, time: new Date().toISOString() };
      db.bids.push(bid);
      audit('portal.bid', `Portal absentee bid $${amount} on lot ${lot.lotNumber} "${lot.title}" by ${bd.name}`);
      saveDb();
      return { status: 201, body: { ok: true, lotNumber: lot.lotNumber, amount } };
    });

    // -- reports --
    function reportExtras(sold, invoices) {
      const methods = {};
      for (const i of invoices) {
        for (const p of i.payments) methods[p.method] = round2((methods[p.method] || 0) + p.amount);
      }
      const buyers = new Map();
      for (const l of sold) {
        const reg = findById(db.registrations, l.winningRegId);
        if (!reg) continue;
        const b = bidderOfReg(reg);
        if (!buyers.has(reg.bidderId)) buyers.set(reg.bidderId, { id: reg.bidderId, label: b ? b.name : '?', count: 0, gross: 0 });
        const g = buyers.get(reg.bidderId);
        g.count++;
        g.gross = round2(g.gross + lotAmount(l));
      }
      const gross = round2(sold.reduce((s, l) => s + lotAmount(l), 0));
      return {
        avgLotPrice: sold.length ? round2(gross / sold.length) : 0,
        paymentMethods: ['cash', 'check', 'card', 'other'].filter((m) => methods[m])
          .map((m) => ({ id: m, label: m, count: null, gross: methods[m] })),
        topBuyers: [...buyers.values()].sort((a, b) => b.gross - a.gross).slice(0, 10),
      };
    }

    route('GET', '/api/reports/auction/:id', (params) => {
      const auction = findById(db.auctions, params.id);
      if (!auction) return { status: 404, body: { error: 'Auction not found' } };
      const lots = db.lots.filter((l) => l.auctionId === auction.id);
      const sold = lots.filter((l) => l.status === 'sold');
      const gross = round2(sold.reduce((s, l) => s + lotAmount(l), 0));
      const invoices = db.invoices.filter((i) => i.auctionId === auction.id && i.status !== 'void');
      const settlements = db.settlements.filter((s) => s.auctionId === auction.id && s.status !== 'void');

      const groupBy = (keyFn, labelFn) => {
        const map = new Map();
        for (const l of sold) {
          const key = keyFn(l) || '(none)';
          if (!map.has(key)) map.set(key, { id: key, label: labelFn ? labelFn(l) || '(none)' : key, count: 0, gross: 0 });
          const g = map.get(key);
          g.count++;
          g.gross = round2(g.gross + lotAmount(l));
        }
        return [...map.values()].sort((a, b) => b.gross - a.gross);
      };

      return {
        status: 200,
        body: {
          auction,
          premiumPct: auctionPremiumPct(auction),
          taxPct: auctionTaxPct(auction),
          lotCount: lots.length,
          soldCount: sold.length,
          passedCount: lots.filter((l) => l.status === 'passed').length,
          openCount: lots.filter((l) => l.status === 'open').length,
          sellThroughPct: lots.length ? round2(100 * sold.length / (lots.filter((l) => l.status !== 'open').length || 1)) : 0,
          registeredBidders: db.registrations.filter((r) => r.auctionId === auction.id).length,
          buyersWhoWon: new Set(sold.map((l) => l.winningRegId)).size,
          grossHammer: gross,
          premiumCollected: round2(invoices.reduce((s, i) => s + i.premium, 0)),
          taxCollected: round2(invoices.reduce((s, i) => s + i.tax, 0)),
          invoicedTotal: round2(invoices.reduce((s, i) => s + i.total, 0)),
          collectedTotal: round2(invoices.reduce((s, i) => s + i.amountPaid, 0)),
          outstandingTotal: round2(invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)),
          commissionEarned: round2(settlements.reduce((s, x) => s + x.commission, 0)),
          owedToConsignors: round2(settlements.filter((s) => s.status === 'owed').reduce((s, x) => s + x.netDue, 0)),
          ...reportExtras(sold, invoices),
          byCategory: groupBy((l) => l.category),
          byConsignor: groupBy((l) => l.consignorId, (l) => {
            const c = findById(db.consignors, l.consignorId);
            return c ? `${c.code} ${c.name}` : null;
          }),
          topLots: [...sold].sort((a, b) => lotAmount(b) - lotAmount(a)).slice(0, 10).map((l) => ({
            lotNumber: l.lotNumber, title: l.title, amount: lotAmount(l), auctionId: l.auctionId,
          })),
        },
      };
    });

    // Auctions whose date falls inside [from, to] (ISO date strings, both optional).
    function auctionsInRange(from, to) {
      return db.auctions.filter((a) =>
        a.date && (!from || a.date >= from) && (!to || a.date <= to));
    }

    route('GET', '/api/reports/range', (params, body, query) => {
      const from = query.from || '';
      const to = query.to || '';
      const auctions = auctionsInRange(from, to).sort((a, b) => a.date.localeCompare(b.date));
      const ids = new Set(auctions.map((a) => a.id));
      const lots = db.lots.filter((l) => ids.has(l.auctionId));
      const sold = lots.filter((l) => l.status === 'sold');
      const invoices = db.invoices.filter((i) => ids.has(i.auctionId) && i.status !== 'void');
      const settlements = db.settlements.filter((s) => ids.has(s.auctionId) && s.status !== 'void');

      const groupBy = (keyFn, labelFn) => {
        const map = new Map();
        for (const l of sold) {
          const key = keyFn(l) || '(none)';
          if (!map.has(key)) map.set(key, { id: key, label: labelFn ? labelFn(l) || '(none)' : key, count: 0, gross: 0 });
          const g = map.get(key);
          g.count++;
          g.gross = round2(g.gross + lotAmount(l));
        }
        return [...map.values()].sort((a, b) => b.gross - a.gross);
      };

      const hammered = lots.filter((l) => l.status !== 'open').length;
      return {
        status: 200,
        body: {
          from, to,
          auctionCount: auctions.length,
          lotCount: lots.length,
          soldCount: sold.length,
          passedCount: lots.filter((l) => l.status === 'passed').length,
          openCount: lots.filter((l) => l.status === 'open').length,
          sellThroughPct: hammered ? round2(100 * sold.length / hammered) : 0,
          registeredBidders: db.registrations.filter((r) => ids.has(r.auctionId)).length,
          buyersWhoWon: new Set(sold.map((l) => l.winningRegId)).size,
          grossHammer: round2(sold.reduce((s, l) => s + lotAmount(l), 0)),
          premiumCollected: round2(invoices.reduce((s, i) => s + i.premium, 0)),
          taxCollected: round2(invoices.reduce((s, i) => s + i.tax, 0)),
          invoicedTotal: round2(invoices.reduce((s, i) => s + i.total, 0)),
          collectedTotal: round2(invoices.reduce((s, i) => s + i.amountPaid, 0)),
          outstandingTotal: round2(invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)),
          commissionEarned: round2(settlements.reduce((s, x) => s + x.commission, 0)),
          owedToConsignors: round2(settlements.filter((s) => s.status === 'owed').reduce((s, x) => s + x.netDue, 0)),
          ...reportExtras(sold, invoices),
          byAuction: auctions.map((a) => {
            const aSold = sold.filter((l) => l.auctionId === a.id);
            return {
              id: a.id,
              label: `${a.title} (${a.date})`,
              count: aSold.length,
              gross: round2(aSold.reduce((s, l) => s + lotAmount(l), 0)),
            };
          }),
          monthly: (() => {
            const map = new Map();
            for (const l of sold) {
              const a = findById(db.auctions, l.auctionId);
              if (!a || !a.date) continue;
              const m = a.date.slice(0, 7);
              if (!map.has(m)) map.set(m, { id: m, label: m, count: 0, gross: 0 });
              const g = map.get(m);
              g.count++;
              g.gross = round2(g.gross + lotAmount(l));
            }
            return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
          })(),
          byCategory: groupBy((l) => l.category),
          byConsignor: groupBy((l) => l.consignorId, (l) => {
            const c = findById(db.consignors, l.consignorId);
            return c ? `${c.code} ${c.name}` : null;
          }),
          topLots: [...sold].sort((a, b) => lotAmount(b) - lotAmount(a)).slice(0, 10).map((l) => ({
            lotNumber: l.lotNumber, title: l.title, amount: lotAmount(l), auctionId: l.auctionId,
          })),
        },
      };
    });

    // -- audit log --
    route('GET', '/api/audit', (params, body, query) => {
      const limit = Math.min(num(query.limit, 100), 500);
      return { status: 200, body: db.auditLog.slice(0, limit) };
    });

    // -- dashboard --
    route('GET', '/api/dashboard', () => {
      const soldLots = db.lots.filter((l) => l.status === 'sold');
      const activeInvoices = db.invoices.filter((i) => i.status !== 'void');
      const owed = db.settlements.filter((s) => s.status === 'owed');
      return {
        status: 200,
        body: {
          auctions: db.auctions.length,
          liveAuctions: db.auctions.filter((a) => a.status === 'live').length,
          bidders: db.bidders.length,
          consignors: db.consignors.length,
          lots: db.lots.length,
          soldLots: soldLots.length,
          hammerTotal: round2(soldLots.reduce((s, l) => s + lotAmount(l), 0)),
          invoiceTotal: round2(activeInvoices.reduce((s, i) => s + i.total, 0)),
          unpaidCount: activeInvoices.filter((i) => i.status !== 'paid').length,
          unpaidTotal: round2(activeInvoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)),
          settlementsOwedCount: owed.length,
          settlementsOwedTotal: round2(owed.reduce((s, x) => s + x.netDue, 0)),
        },
      };
    });

    // ---------- CSV rows ----------

    function exportCsv(kind, query) {
      const auctionId = (query && query.auctionId) || '';
      const from = (query && query.from) || '';
      const to = (query && query.to) || '';
      const auction = findById(db.auctions, auctionId);
      let scope, tag;
      if (from || to) {
        const ids = new Set(auctionsInRange(from, to).map((a) => a.id));
        scope = (arr) => arr.filter((x) => ids.has(x.auctionId));
        tag = `${from || 'start'}-to-${to || 'now'}`;
      } else {
        scope = (arr) => (auction ? arr.filter((x) => x.auctionId === auctionId) : arr);
        tag = auction ? auction.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'all';
      }

      if (kind === 'lots') {
        const rows = [['Lot #', 'Title', 'Category', 'Quantity', 'Consignor', 'Starting bid', 'Reserve', 'Status', 'Hammer (each)', 'Extended amount', 'Winning paddle', 'Buyer']];
        for (const l of scope(db.lots).sort((a, b) => a.lotNumber - b.lotNumber)) {
          const c = findById(db.consignors, l.consignorId);
          const reg = findById(db.registrations, l.winningRegId);
          const bidder = bidderOfReg(reg);
          rows.push([l.lotNumber, l.title, l.category, l.quantity, c ? `${c.code} ${c.name}` : '', l.startingBid, l.reserve,
            l.status, l.hammerPrice ?? '', l.status === 'sold' ? lotAmount(l) : '', reg ? reg.paddle : '', bidder ? bidder.name : '']);
        }
        return { filename: `lots-${tag}.csv`, rows };
      }
      if (kind === 'invoices') {
        const rows = [['Invoice', 'Paddle', 'Buyer', 'Lots', 'Subtotal', 'Premium %', 'Premium', 'Tax %', 'Tax', 'Total', 'Paid', 'Balance', 'Status', 'Created']];
        for (const i of scope(db.invoices)) {
          const bidder = findById(db.bidders, i.bidderId);
          rows.push([`INV-${i.number}`, i.paddle, bidder ? bidder.name : '', i.lineItems.length, i.subtotal, i.premiumPct,
            i.premium, i.taxPct, i.tax, i.total, i.amountPaid, round2(i.total - i.amountPaid), i.status, i.createdAt.slice(0, 10)]);
        }
        return { filename: `invoices-${tag}.csv`, rows };
      }
      if (kind === 'settlements') {
        const rows = [['Settlement', 'Consignor', 'Sold lots', 'Gross hammer', 'Commission %', 'Commission', 'Net due', 'Status', 'Paid at']];
        for (const s of scope(db.settlements)) {
          const c = findById(db.consignors, s.consignorId);
          rows.push([`ST-${s.number}`, c ? `${c.code} ${c.name}` : '', s.lineItems.length, s.grossHammer,
            s.commissionPct, s.commission, s.netDue, s.status, s.paidAt ? s.paidAt.slice(0, 10) : '']);
        }
        return { filename: `settlements-${tag}.csv`, rows };
      }
      return null;
    }

    function rowsToCsv(rows) {
      const escape = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return rows.map((r) => r.map(escape).join(',')).join('\r\n');
    }

    function dispatch(method, pathname, body, query) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = pathname.match(r.regex);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return r.handler(params, body || {}, query || {});
      }
      return null;
    }

    return {
      get db() { return db; },
      dispatch,
      exportCsv,
      rowsToCsv,
      audit: (action, detail) => { audit(action, detail); saveDb(); },
    };
  }

  return { createBrinkleyCore, migrate, DEFAULT_SETTINGS };
});
