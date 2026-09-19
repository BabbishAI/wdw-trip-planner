// WDW Trip Planner — shared, view-only itinerary for non-planners.
// The whole plan travels in the URL hash (base64url-encoded JSON) so no server is
// needed. Choice groups render as dropdowns; picking "None" drops the group.

const $ = (sel) => document.querySelector(sel);

const SUPABASE = window.SUPABASE || {};

// Fetch a plan by id via the get_plan() function (reads are limited to exact-id lookups).
async function cloudFetch(id) {
  const res = await fetch(SUPABASE.url + "/rpc/get_plan", {
    method: "POST",
    headers: {
      "apikey": SUPABASE.anon,
      "Authorization": "Bearer " + SUPABASE.anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pid: id }),
  });
  if (!res.ok) throw new Error("load failed: " + res.status);
  return res.json(); // the stored plan object, or null if the id isn't found
}

function fmtUSD(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function parseISO(s) { return new Date(s + "T00:00:00"); }
function fmtDate(iso) {
  if (!iso) return "";
  return parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtDateRange(start, end) {
  if (!start) return "";
  if (end && end > start) return `${fmtDate(start)} → ${fmtDate(end)}`;
  return fmtDate(start);
}
function perPersonText(cost, people) {
  if (!people || people <= 1 || !cost) return "";
  return `${fmtUSD(Math.round(cost / people))}/person`;
}
function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

const TYPES = {
  flight:      { icon: "✈️", label: "Flight" },
  stay:        { icon: "🏨", label: "Stay" },
  car:         { icon: "🚗", label: "Car rental" },
  reservation: { icon: "🍽️", label: "Reservation" },
  ticket:      { icon: "🎟️", label: "Ticket" },
  other:       { icon: "📌", label: "Other" },
};

// --- URL payload decoding -------------------------------------------------
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}
function readPayload() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return null;
  try {
    return JSON.parse(b64urlDecode(hash));
  } catch (e) {
    return null;
  }
}

// --- State ----------------------------------------------------------------
let plan = null;      // decoded payload: { title, items, households, splitBasis, groupSel, groupOff }
let planId = "";      // the ?id= of a cloud plan, used to scope this viewer's own settings
let vSel = {};        // group name -> chosen item id, or "" for none
let vInc = {};        // optional item id -> included (bool)

function groupNames() {
  const seen = [];
  for (const it of plan.items) {
    if (it.group && !seen.includes(it.group)) seen.push(it.group);
  }
  return seen;
}
function groupMembers(name) { return plan.items.filter((it) => it.group === name); }
function groupDates(name) {
  const first = groupMembers(name)[0];
  return first ? { date: first.date || "", endDate: first.endDate || "" } : { date: "", endDate: "" };
}

function initSelections() {
  const sel = plan.groupSel || {};
  const off = plan.groupOff || {};
  for (const name of groupNames()) {
    const members = groupMembers(name);
    if (off[name]) {
      vSel[name] = ""; // planner had this group skipped by default
    } else {
      const planned = sel[name];
      vSel[name] = members.some((m) => m.id === planned) ? planned : members[0].id;
    }
  }
  for (const it of plan.items) {
    if (!it.group && it.optional) vInc[it.id] = it.included !== false;
  }
}

// --- Totals ---------------------------------------------------------------
function costOf(id) {
  const it = plan.items.find((x) => x.id === id);
  return it ? Booking.effCost(it) : 0;
}
function computeTotal() {
  let total = 0;
  for (const it of plan.items) {
    if (it.group) continue; // groups handled below
    if (it.optional) { if (vInc[it.id]) total += Booking.effCost(it); }
    else total += Booking.effCost(it);
  }
  for (const name of groupNames()) {
    if (vSel[name]) total += costOf(vSel[name]);
  }
  return total;
}

// --- Rendering ------------------------------------------------------------
function isRange(item) { return !!(item.endDate && item.endDate > item.date); }

// Everything the group needs to reference about one booking: where it stands, its
// confirmation code, who it's with, the notes, and each family's share of it.
function buildItemDetail(item) {
  const wrap = document.createElement("div");
  wrap.className = "v-detail";

  const chips = document.createElement("div");
  chips.className = "v-chips";

  const st = Booking.STATUS[Booking.statusOf(item)];
  const badge = document.createElement("span");
  badge.className = "v-badge " + st.cls;
  badge.textContent = st.label;
  chips.appendChild(badge);

  if (item.vendor) {
    const v = document.createElement("span");
    v.className = "v-chip";
    v.textContent = item.vendor;
    chips.appendChild(v);
  }

  // The confirmation code, with a copy button — these get typed into airline and
  // rental apps on a phone, often one-handed at a counter.
  if (item.conf) {
    const box = document.createElement("span");
    box.className = "v-confbox";
    const code = document.createElement("span");
    code.className = "v-conf";
    code.textContent = item.conf;
    const copy = document.createElement("button");
    copy.className = "v-copy";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      const text = item.conf;
      const done = () => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    });
    box.append(code, copy);
    chips.appendChild(box);
  }

  if (item.payer) {
    const who = Booking.householdName(plan, item.payer);
    if (who) {
      const p = document.createElement("span");
      p.className = "v-chip";
      p.textContent = "paid by " + who;
      chips.appendChild(p);
    }
  }
  if (chips.children.length) wrap.appendChild(chips);

  if (item.url) {
    const a = document.createElement("a");
    a.className = "v-link";
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open booking \u2197";
    wrap.appendChild(a);
  }

  if (item.notes) {
    const n = document.createElement("div");
    n.className = "v-notes";
    n.textContent = item.notes;
    wrap.appendChild(n);
  }

  // What this one booking costs each household.
  const houses = Booking.households(plan);
  if (houses.length > 1) {
    const split = Booking.splitItem(plan, item);
    const parts = houses
      .filter((h) => split[h.id] >= 0.5)
      .map((h) => `<span class="v-shr"><span class="n">${escapeHTML(h.name)}</span> ${fmtUSD(Math.round(split[h.id]))}</span>`);
    if (parts.length) {
      const d = document.createElement("div");
      d.className = "v-split";
      d.innerHTML = parts.join("");
      wrap.appendChild(d);
    }
  }

  return wrap;
}

// Clipboard fallback for browsers that block the async clipboard API.
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) {}
  ta.remove();
}

function buildItemRow(item) {
  const meta = TYPES[item.type] || TYPES.other;
  const included = !item.optional || vInc[item.id];
  const row = document.createElement("div");
  row.className = "v-row" + (included ? "" : " excluded");

  let control;
  if (item.optional) {
    control = document.createElement("input");
    control.type = "checkbox";
    control.className = "v-check";
    control.checked = !!vInc[item.id];
    control.title = "Include this in your total";
    control.addEventListener("change", () => { vInc[item.id] = control.checked; render(); });
  } else {
    control = document.createElement("span");
    control.className = "v-fixed";
    control.textContent = "•";
  }

  const main = document.createElement("div");
  const dateText = fmtDateRange(item.date, item.endDate);
  const sub = [meta.label];
  if (dateText) sub.push(dateText);
  if (item.people) sub.push(`for ${item.people}`);
  if (item.optional) sub.push("optional");
  main.innerHTML =
    `<span class="v-title"><span class="v-icon">${meta.icon}</span>${escapeHTML(item.title)}</span>` +
    `<span class="v-sub">${sub.join(" · ")}</span>`;

  const cost = document.createElement("div");
  cost.className = "v-cost";
  const eff = Booking.effCost(item);
  const perPerson = perPersonText(eff, item.people);
  let costHTML = fmtUSD(eff);
  if (Booking.hasActual(item)) {
    const v = Booking.variance(item);
    if (Math.abs(v) >= 1) {
      costHTML += `<span class="v-var ${v > 0 ? "over" : "under"}">${v > 0 ? "+" : "\u2212"}${fmtUSD(Math.abs(v))} vs est</span>`;
    }
  }
  cost.innerHTML = costHTML + (perPerson ? `<span class="v-perperson">${perPerson}</span>` : "");

  main.appendChild(buildItemDetail(item));

  row.append(control, main, cost);
  return row;
}

function buildGroupCard(name) {
  const members = groupMembers(name);
  const chosen = vSel[name];
  const card = document.createElement("div");
  card.className = "v-group" + (chosen ? "" : " none");

  const dates = groupDates(name);
  const dateText = fmtDateRange(dates.date, dates.endDate);
  const meta = TYPES[(members[0] || {}).type] || TYPES.other;

  const head = document.createElement("div");
  head.className = "v-group-head";
  const metaBits = ["choose one"];
  if (dateText) metaBits.push(dateText);
  head.innerHTML =
    `<span class="v-group-title"><span class="v-icon">${meta.icon}</span>${escapeHTML(name)}` +
    `<span class="v-group-meta">${metaBits.join(" · ")}</span></span>`;

  const rowEl = document.createElement("div");
  rowEl.className = "v-group-row";

  const select = document.createElement("select");
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "— None (skip) —";
  select.appendChild(noneOpt);
  for (const m of members) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.title} — ${fmtUSD(m.cost)}` + (m.people ? ` (for ${m.people})` : "");
    select.appendChild(opt);
  }
  select.value = chosen || "";
  select.addEventListener("change", () => { vSel[name] = select.value; render(); });

  const costEl = document.createElement("div");
  if (chosen) {
    const m = plan.items.find((x) => x.id === chosen);
    const perPerson = m ? perPersonText(m.cost, m.people) : "";
    costEl.className = "v-group-cost";
    costEl.innerHTML = fmtUSD(costOf(chosen)) + (perPerson ? `<span class="v-perperson">${perPerson}</span>` : "");
  } else {
    costEl.className = "v-group-cost none";
    costEl.textContent = "Not included";
  }

  rowEl.append(select, costEl);
  card.append(head, rowEl);
  return card;
}

// Build one chronological timeline of items + group cards.
function buildTimeline() {
  const frag = document.createDocumentFragment();
  const entries = [];
  for (const name of groupNames()) {
    const d = groupDates(name);
    entries.push({
      date: d.date || "9999-12-31",
      range: !!(d.endDate && d.endDate > d.date),
      title: name,
      node: buildGroupCard(name),
    });
  }
  for (const item of plan.items) {
    if (item.group) continue;
    entries.push({
      date: item.date || "9999-12-31",
      range: isRange(item),
      title: item.title,
      node: buildItemRow(item),
    });
  }
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ar = a.range ? 1 : 0, br = b.range ? 1 : 0;
    if (ar !== br) return ar - br;
    return a.title.localeCompare(b.title);
  });
  for (const e of entries) frag.appendChild(e.node);
  return frag;
}

// Which household this viewer says they are. Stored per plan, in this browser only.
function meKey() { return "wdw-me-" + (planId || "hash"); }
function getMe() {
  try { return localStorage.getItem(meKey()) || ""; } catch (e) { return ""; }
}
function setMe(id) {
  try { id ? localStorage.setItem(meKey(), id) : localStorage.removeItem(meKey()); } catch (e) {}
  render();
}

// Only the items this viewer's selections actually count toward the trip.
function countedItems() {
  const out = [];
  for (const it of plan.items) {
    if (it.group) { if (vSel[it.group] === it.id) out.push(it); }
    else if (it.optional) { if (vInc[it.id]) out.push(it); }
    else out.push(it);
  }
  return out;
}

// One place the whole group can find every confirmation code, without scrolling
// the itinerary. This is the thing people open at a check-in desk.
function buildConfirmationPanel() {
  const booked = plan.items.filter((it) => it.conf);
  if (booked.length === 0) return null;

  const panel = document.createElement("div");
  panel.className = "panel";
  const det = document.createElement("details");
  det.className = "v-refs";
  det.open = true;

  let html = `<summary>All confirmation numbers <span class="v-count">${booked.length}</span></summary><table class="v-reftable"><tbody>`;
  for (const it of booked) {
    const meta = TYPES[it.type] || TYPES.other;
    const when = fmtDateRange(it.date, it.endDate);
    html += `<tr><td class="w"><span class="v-icon">${meta.icon}</span>${escapeHTML(it.title)}` +
      (when ? `<span class="v-refwhen">${when}</span>` : "") +
      `</td><td class="c"><span class="v-conf">${escapeHTML(it.conf)}</span></td></tr>`;
  }
  html += "</tbody></table>";
  det.innerHTML = html;
  panel.appendChild(det);
  return panel;
}

// "Which family are you?" — plus, once answered, that family's own bottom line.
function buildYouPanel() {
  const houses = Booking.households(plan);
  if (houses.length === 0) return null;

  const panel = document.createElement("div");
  panel.className = "panel";
  const me = getMe();

  const head = document.createElement("div");
  head.className = "you-head";
  head.textContent = me ? "Your share" : "Which family are you?";
  panel.appendChild(head);

  const pick = document.createElement("select");
  pick.className = "you-pick";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— choose your family —";
  none.selected = !me;
  pick.appendChild(none);
  for (const h of houses) {
    const o = document.createElement("option");
    o.value = h.id;
    const kids = Booking.kidsOf(h);
    o.textContent = h.name + " (" + Booking.adultsOf(h) + " adult" + (Booking.adultsOf(h) === 1 ? "" : "s") +
      (kids ? ", " + kids + " kid" + (kids === 1 ? "" : "s") : "") + ")";
    o.selected = me === h.id;
    pick.appendChild(o);
  }
  pick.addEventListener("change", () => setMe(pick.value));
  panel.appendChild(pick);

  if (!me) {
    const hint = document.createElement("div");
    hint.className = "you-note";
    hint.textContent = "Pick your family and this page will show what your household owes, and what you've already paid. It's remembered on this device only — nobody else sees your choice.";
    panel.appendChild(hint);
    return panel;
  }

  const counted = countedItems();
  const rows = Booking.ledger(plan, counted);
  const mine = rows.find((r) => r.id === me);
  if (!mine) return panel;

  const net = Math.round(mine.net);
  const netText = net === 0
    ? "You're square with the group."
    : net > 0
      ? `The group owes you ${fmtUSD(net)}.`
      : `You owe the group ${fmtUSD(-net)}.`;

  const body = document.createElement("div");
  body.className = "you-body";
  body.innerHTML =
    `<div class="you-big ${net < 0 ? "neg" : net > 0 ? "pos" : ""}">${netText}</div>` +
    `<div class="total-row"><span class="label">Your share of the trip</span><span class="val">${fmtUSD(Math.round(mine.owes))}</span></div>` +
    `<div class="total-row"><span class="label">You've already paid</span><span class="val">${fmtUSD(Math.round(mine.paid))}</span></div>`;
  panel.appendChild(body);

  // Line-by-line, so the number above is never a black box.
  const lines = counted
    .map((it) => ({ it, amt: Booking.splitItem(plan, it)[me] || 0 }))
    .filter((r) => r.amt >= 0.5);
  if (lines.length) {
    let html = '<table class="you-lines"><tbody>';
    for (const r of lines) {
      html += `<tr><td>${escapeHTML(r.it.title)}</td><td class="amt">${fmtUSD(Math.round(r.amt))}</td></tr>`;
    }
    html += "</tbody></table>";
    const det = document.createElement("details");
    det.className = "you-detail";
    det.innerHTML = "<summary>How your share breaks down</summary>" + html;
    panel.appendChild(det);
  }

  const basis = Booking.SPLIT_BASES[Booking.splitBasis(plan)];
  if (basis) {
    const note = document.createElement("div");
    note.className = "you-note";
    note.textContent = "Shared costs are split " + basis.label.toLowerCase() + ".";
    panel.appendChild(note);
  }
  return panel;
}

// The whole group's books, so nobody has to take the organiser's word for it.
function buildLedgerPanel() {
  const houses = Booking.households(plan);
  if (houses.length === 0) return null;
  const counted = countedItems();
  const rows = Booking.ledger(plan, counted);
  const owedToVendors = Booking.unfunded(plan, counted);
  const me = getMe();

  const panel = document.createElement("div");
  panel.className = "panel";
  let html = '<div class="you-head">Everyone\u2019s share</div>';
  html += '<table class="v-ledger"><thead><tr><th>Household</th><th>Share of trip</th><th>Paid so far</th><th>Owes the group</th></tr></thead><tbody>';
  for (const r of rows) {
    const net = Math.round(r.net);
    const cls = net > 0 ? "pos" : net < 0 ? "neg" : "";
    const netText = net === 0 ? "even" : net > 0 ? `owed ${fmtUSD(net)}` : `owes ${fmtUSD(-net)}`;
    html += `<tr${r.id === me ? ' class="is-me"' : ""}><td>${escapeHTML(r.name)}</td>` +
      `<td>${fmtUSD(Math.round(r.owes))}</td><td>${fmtUSD(Math.round(r.paid))}</td>` +
      `<td class="net ${cls}">${netText}</td></tr>`;
  }
  html += "</tbody></table>";

  const transfers = Booking.settle(rows);
  if (transfers.length) {
    html += '<div class="you-head" style="margin-top:14px;">Settling up</div><ul class="settle">';
    for (const t of transfers) {
      const mineFlag = t.fromId === me || t.toId === me;
      html += `<li${mineFlag ? ' class="is-me"' : ""}><strong>${escapeHTML(t.from)}</strong> pays <strong>${escapeHTML(t.to)}</strong> <span class="amt">${fmtUSD(Math.round(t.amount))}</span></li>`;
    }
    html += "</ul>";
  }
  if (owedToVendors >= 1) {
    html += `<div class="you-note"><strong>${fmtUSD(Math.round(owedToVendors))}</strong> of the trip hasn\u2019t been paid by anyone yet, so it isn\u2019t in the settling-up above \u2014 that money is still owed to airlines, hosts and parks.</div>`;
  }
  panel.innerHTML = html;
  return panel;
}

function render() {
  const root = $("#viewRoot");
  const title = plan.title || "Trip Itinerary";
  document.title = title;

  const total = computeTotal();
  const chosenGroups = groupNames().filter((n) => vSel[n]).length;
  const totalGroups = groupNames().length;

  root.innerHTML = "";

  const h1 = document.createElement("h1");
  h1.textContent = title;
  const sub = document.createElement("p");
  sub.className = "sub";
  sub.textContent = "Shared plan — pick your options below to see the estimated total. Nothing you change here affects the planner's copy.";
  root.append(h1, sub);

  const listPanel = document.createElement("div");
  listPanel.className = "panel";
  if (plan.items.length === 0) {
    listPanel.innerHTML = '<div class="empty">This itinerary is empty.</div>';
  } else {
    listPanel.appendChild(buildTimeline());
  }
  root.appendChild(listPanel);

  const totalPanel = document.createElement("div");
  totalPanel.className = "panel total-panel";
  let note = "";
  if (totalGroups > 0) note = `${chosenGroups} of ${totalGroups} choice group${totalGroups === 1 ? "" : "s"} selected`;
  totalPanel.innerHTML =
    `<div class="total-row grand"><span class="label">Estimated trip total</span>` +
    `<span class="val">${fmtUSD(total)}</span></div>` +
    (note ? `<div class="total-note">${note}</div>` : "");
  root.appendChild(totalPanel);

  const refs = buildConfirmationPanel();
  if (refs) root.appendChild(refs);

  const you = buildYouPanel();
  if (you) root.appendChild(you);
  const ledger = buildLedgerPanel();
  if (ledger) root.appendChild(ledger);
}

function renderEmpty() {
  $("#viewRoot").innerHTML =
    '<div class="empty"><h1 style="font-size:1.3rem;">No itinerary found</h1>' +
    "<p>This link doesn't point to a shared plan. Ask whoever sent it to share the link again, " +
    'or <a href="itinerary.html">build your own itinerary</a>.</p></div>';
}

function renderMessage(html) {
  $("#viewRoot").innerHTML = '<div class="empty">' + html + "</div>";
}

function startPlan() {
  if (!plan || !Array.isArray(plan.items)) { renderEmpty(); return; }
  for (const it of plan.items) {
    it.date = it.date || "";
    it.endDate = it.endDate || "";
    it.people = it.people || 0;
    it.group = it.group || "";
  }
  initSelections();
  render();
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  planId = id || "";
  if (id) {
    // Baked-in plans are served instantly and never depend on the cloud DB.
    const local = (window.LOCAL_PLANS || {})[id];
    if (local) { plan = local; startPlan(); return; }

    renderMessage("Loading itinerary…");
    try {
      plan = await cloudFetch(id);
    } catch (e) {
      renderMessage(
        '<h1 style="font-size:1.3rem;">Couldn\'t load this itinerary</h1>' +
        "<p>The plan couldn't be reached right now. It may be waking up — wait a moment and refresh. " +
        "If it keeps failing, ask the planner to re-share the link.</p>"
      );
      return;
    }
    startPlan();
  } else {
    // Legacy links that carry the whole plan in the hash.
    plan = readPayload();
    startPlan();
  }
}

init();
