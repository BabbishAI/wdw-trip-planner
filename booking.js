// Shared money model for the trip: estimated-vs-actual costs, confirmation details,
// and splitting the bill across the households travelling together.
//
// Used by BOTH the builder (itinerary.js) and the read-only viewer (view.js), so it
// must not touch the DOM or assume either page's state object beyond the shape:
//   state.households = [{ id, name, size }]
//   item.cost   = the ESTIMATE (what we guessed it would run)
//   item.actual = what was really charged (null/undefined until booked)
//   item.payer  = household id that fronted the money
//   item.shares = household ids splitting it (null/empty = everyone)
window.Booking = (function () {
  // Where a line item sits on the way from "we think" to "money has left the account".
  const STATUS = {
    est:    { label: "Estimate", short: "est",    cls: "st-est" },
    booked: { label: "Booked",   short: "booked", cls: "st-booked" },
    paid:   { label: "Paid",     short: "paid",   cls: "st-paid" },
  };
  const STATUS_ORDER = ["est", "booked", "paid"];

  function statusOf(item) {
    return STATUS[item && item.status] ? item.status : "est";
  }

  function hasActual(item) {
    return item && typeof item.actual === "number" && isFinite(item.actual);
  }
  // The number that should drive every total: real money when we have it, estimate until then.
  function effCost(item) {
    if (!item) return 0;
    return hasActual(item) ? item.actual : (item.cost || 0);
  }
  // Positive = came in over the estimate. Zero when nothing real has landed yet.
  function variance(item) {
    return hasActual(item) ? item.actual - (item.cost || 0) : 0;
  }

  function households(state) {
    return Array.isArray(state && state.households) ? state.households : [];
  }
  function householdById(state, id) {
    return households(state).find((h) => h.id === id) || null;
  }
  function householdName(state, id) {
    const h = householdById(state, id);
    return h ? h.name : "";
  }
  function totalPeople(state) {
    return households(state).reduce((n, h) => n + headsOf(h), 0);
  }
  function totalAdults(state) {
    return households(state).reduce((n, h) => n + adultsOf(h), 0);
  }
  function totalKids(state) {
    return households(state).reduce((n, h) => n + kidsOf(h), 0);
  }

  // A household may be stored as a flat size (older plans) or split adults/kids.
  function adultsOf(h) {
    if (!h) return 0;
    if (typeof h.adults === "number") return Math.max(0, h.adults);
    return Math.max(0, h.size || 0);   // pre-kids plans counted everyone as an adult
  }
  function kidsOf(h) {
    if (!h) return 0;
    return typeof h.kids === "number" ? Math.max(0, h.kids) : 0;
  }
  function headsOf(h) {
    return adultsOf(h) + kidsOf(h);
  }

  // How much of a shared cost one household carries. Which of these is "fair" is a
  // judgement call the group makes, not a fact — so it's a setting, not a constant.
  const SPLIT_BASES = {
    people:    { label: "Per person — every traveller counts the same",
                 note: "A child's seat on a flight costs what an adult's does." },
    adultsHalf:{ label: "Per person, children count half",
                 note: "Common for houses and groceries, where kids share rooms and eat less." },
    adults:    { label: "Per adult — children ride free",
                 note: "The grown-ups split everything; kids add nothing to anyone's bill." },
    household: { label: "Per household — every family pays an equal share",
                 note: "Simplest, but a family of five pays the same as a couple." },
    shares:    { label: "Set each household's share yourself",
                 note: "You choose the multiplier per family — e.g. three families at 1 and a couple at 0.5. Doesn't drift if a head count changes." },
  };
  const SPLIT_ORDER = ["people", "adultsHalf", "adults", "household", "shares"];

  // The multiplier a household carries under the "shares" basis. Defaults to a full
  // share so a newly-added family is never silently free.
  function shareOf(h) {
    if (!h) return 0;
    const n = typeof h.share === "number" ? h.share : 1;
    return isFinite(n) && n >= 0 ? n : 1;
  }

  function splitBasis(state) {
    const b = state && state.splitBasis;
    return SPLIT_BASES[b] ? b : "people";
  }

  // The weight one household carries under the trip's chosen basis.
  function weightOf(state, h) {
    switch (splitBasis(state)) {
      case "adults": return adultsOf(h);
      case "adultsHalf": return adultsOf(h) + kidsOf(h) * 0.5;
      case "household": return 1;
      case "shares": return shareOf(h);
      default: return headsOf(h);
    }
  }

  // Which households split this item. Unset means the whole group is in on it.
  function sharersFor(state, item) {
    const all = households(state);
    if (!item || !Array.isArray(item.shares) || item.shares.length === 0) return all;
    const want = new Set(item.shares);
    const picked = all.filter((h) => want.has(h.id));
    return picked.length ? picked : all;
  }

  // Split one item's effective cost across its sharing households, weighted by head
  // count — a family of 5 carries more of a shared house than a couple does. Falls
  // back to an even per-household split if nobody has a size entered yet.
  function splitItem(state, item) {
    const out = {};
    const sharers = sharersFor(state, item);
    if (!sharers.length) return out;
    const cost = effCost(item);
    const total = sharers.reduce((n, h) => n + weightOf(state, h), 0);
    // No weights to go on (nobody sized yet, or an adults-only basis with no adults
    // listed) — fall back to an even split rather than dividing by zero.
    if (total <= 0) {
      const each = cost / sharers.length;
      for (const h of sharers) out[h.id] = each;
      return out;
    }
    for (const h of sharers) out[h.id] = cost * (weightOf(state, h) / total);
    return out;
  }

  // Per-household books over the items that actually count toward the trip.
  // owes = their share of everything; paid = what they fronted; net = paid - owes.
  // A positive net means the group owes them money back.
  // Two different questions, deliberately kept apart:
  //   owes  = this household's share of the whole trip (their real exposure)
  //   owesFunded = their share of only the items somebody has ALREADY fronted
  // Settling up can only move money that a person actually laid out. A cost nobody
  // has paid yet is still owed to the vendor, not to another family — folding it into
  // the net would make the settle-up transfers not add up to the stated balances.
  function ledger(state, countedItems) {
    const rows = {};
    for (const h of households(state)) {
      rows[h.id] = { id: h.id, name: h.name, size: h.size || 0, owes: 0, owesFunded: 0, paid: 0, net: 0 };
    }
    for (const item of countedItems) {
      const split = splitItem(state, item);
      const funded = !!(item.payer && rows[item.payer]);
      for (const hid of Object.keys(split)) {
        if (!rows[hid]) continue;
        rows[hid].owes += split[hid];
        if (funded) rows[hid].owesFunded += split[hid];
      }
      if (funded) rows[item.payer].paid += effCost(item);
    }
    for (const id of Object.keys(rows)) rows[id].net = rows[id].paid - rows[id].owesFunded;
    return Object.keys(rows).map((id) => rows[id]);
  }

  // Cost that no household has fronted yet — still owed to airlines, hosts and parks.
  function unfunded(state, countedItems) {
    let total = 0;
    const byId = new Set(households(state).map((h) => h.id));
    for (const item of countedItems) {
      if (!item.payer || !byId.has(item.payer)) total += effCost(item);
    }
    return total;
  }

  // Greedy settle-up: biggest creditor meets biggest debtor until everyone is square.
  // Produces at most (households - 1) transfers, which is the fewest possible.
  function settle(ledgerRows) {
    const EPS = 0.005;
    const creditors = ledgerRows.filter((r) => r.net > EPS).map((r) => ({ ...r })).sort((a, b) => b.net - a.net);
    const debtors = ledgerRows.filter((r) => r.net < -EPS).map((r) => ({ ...r })).sort((a, b) => a.net - b.net);
    const transfers = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci], d = debtors[di];
      const amount = Math.min(c.net, -d.net);
      if (amount > EPS) {
        transfers.push({ fromId: d.id, from: d.name, toId: c.id, to: c.name, amount });
      }
      c.net -= amount;
      d.net += amount;
      if (c.net <= EPS) ci++;
      if (d.net >= -EPS) di++;
    }
    return transfers;
  }

  // Trip-level estimate-vs-reality rollup for the summary bar.
  function rollup(countedItems) {
    let est = 0, eff = 0, locked = 0, open = 0, nLocked = 0, nOpen = 0;
    for (const it of countedItems) {
      est += it.cost || 0;
      eff += effCost(it);
      if (hasActual(it)) { locked += it.actual; nLocked++; }
      else { open += it.cost || 0; nOpen++; }
    }
    return { est, eff, locked, open, nLocked, nOpen, variance: eff - est };
  }

  return {
    STATUS, STATUS_ORDER, statusOf,
    hasActual, effCost, variance,
    households, householdById, householdName, totalPeople,
    sharersFor, splitItem, ledger, unfunded, settle, rollup,
    SPLIT_BASES, SPLIT_ORDER, splitBasis, weightOf,
    adultsOf, kidsOf, headsOf, totalAdults, totalKids, shareOf,
  };
})();
