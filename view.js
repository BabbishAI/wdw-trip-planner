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
let plan = null;      // decoded payload: { title, items, groupSel, groupOff }
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
  return it ? it.cost : 0;
}
function computeTotal() {
  let total = 0;
  for (const it of plan.items) {
    if (it.group) continue; // groups handled below
    if (it.optional) { if (vInc[it.id]) total += it.cost; }
    else total += it.cost;
  }
  for (const name of groupNames()) {
    if (vSel[name]) total += costOf(vSel[name]);
  }
  return total;
}

// --- Rendering ------------------------------------------------------------
function isRange(item) { return !!(item.endDate && item.endDate > item.date); }

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
  const perPerson = perPersonText(item.cost, item.people);
  cost.innerHTML = fmtUSD(item.cost) + (perPerson ? `<span class="v-perperson">${perPerson}</span>` : "");

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
  if (id) {
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
