// WDW Trip Planner — Itinerary Builder. Vanilla JS, no build step.
// State is user-entered and persisted to localStorage so it survives a refresh.

const STORAGE_KEY = "wdw-itinerary-v1";

const $ = (id) => document.getElementById(id);

function fmtUSD(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function parseISO(s) { return new Date(s + "T00:00:00"); }
function fmtDate(iso) {
  if (!iso) return "";
  return parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
// Display a start/end pair. Collapses to a single date when there's no valid range.
function fmtDateRange(start, end) {
  if (!start) return "";
  if (end && end > start) return `${fmtDate(start)} → ${fmtDate(end)}`;
  return fmtDate(start);
}
// Per-person amount string, or "" when it wouldn't add information (0/1 person, or free).
function perPersonText(cost, people) {
  if (!people || people <= 1 || !cost) return "";
  return `${fmtUSD(Math.round(cost / people))}/person`;
}

// type key -> { icon, label } for display and grouping.
const TYPES = {
  flight:      { icon: "✈️", label: "Flight" },
  stay:        { icon: "🏨", label: "Stay" },
  car:         { icon: "🚗", label: "Car rental" },
  reservation: { icon: "🍽️", label: "Reservation" },
  ticket:      { icon: "🎟️", label: "Ticket" },
  other:       { icon: "📌", label: "Other" },
};
const TYPE_ORDER = ["flight", "stay", "car", "reservation", "ticket", "other"];

// state = { title, sort, items:[{id,type,title,cost,date,endDate,optional,included,group}],
//           groupSel:{name:itemId}, groupOff:{name:bool}, lastDate, lastEndDate }
// groupSel always holds a valid chosen option; groupOff marks a group as skipped
// (contributes $0) while remembering the selection for when it's turned back on.
// lastDate/lastEndDate remember the most recently entered range so new items default
// to the same timeframe — this keeps the calendar opening on the trip's months.
let state = { title: "", sort: "type", items: [], groupSel: {}, groupOff: {}, lastDate: "", lastEndDate: "", lastPeople: "", cloudId: "", published: false };

const SUPABASE = window.SUPABASE || {};

// Id of the item currently being edited inline (null when none).
let editingId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const defaults = { title: "", sort: "type", items: [], groupSel: {}, groupOff: {}, lastDate: "", lastEndDate: "", lastPeople: "", cloudId: "", published: false };
    if (Array.isArray(parsed)) {
      // Migrate v1 format (bare items array) into the state object.
      state = Object.assign(defaults, { items: parsed });
    } else {
      state = Object.assign(defaults, parsed);
    }
    // Backfill fields that may be missing on older items.
    for (const it of state.items) {
      if (typeof it.date !== "string") it.date = "";
      if (typeof it.endDate !== "string") it.endDate = "";
      if (typeof it.people !== "number") it.people = 0; // 0 = unspecified
      if (typeof it.group !== "string") it.group = "";
      if (typeof it.optional !== "boolean") it.optional = false;
      if (typeof it.included !== "boolean") it.included = true;
    }
  } catch (e) {
    state = { title: "", sort: "type", items: [], groupSel: {} };
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Storage full or blocked (e.g. private mode) — the app still works this session.
  }
  scheduleCloudSync();
}

// --- Cloud sync (Supabase) ------------------------------------------------
let syncTimer = null;

function sbHeaders(extra) {
  return Object.assign({
    "apikey": SUPABASE.anon,
    "Authorization": "Bearer " + SUPABASE.anon,
    "Content-Type": "application/json",
  }, extra || {});
}

// Short, hard-to-guess id so a link reveals only that one plan.
function newId() {
  const bytes = new Uint8Array(8);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(36);
  s = s.replace(/[^a-z0-9]/g, "");
  return (s + "0000000000").slice(0, 10);
}

// Save via the save_plan() function (insert-or-update, runs with elevated rights so
// it isn't blocked by the table's locked-down policies).
async function cloudSave(id, payload) {
  const res = await fetch(SUPABASE.url + "/rpc/save_plan", {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify({ pid: id, payload: payload }),
  });
  if (!res.ok) throw new Error("cloud save failed: " + res.status);
}

function setSyncStatus(kind) {
  const el = $("syncStatus");
  if (!el) return;
  const map = {
    saving: ["Saving…", "muted"],
    synced: ["Shared link updated ✓", "ok"],
    error: ["Couldn't sync — will retry on your next change", "err"],
    "": ["", ""],
  };
  const [txt, cls] = map[kind] || ["", ""];
  el.textContent = txt;
  el.className = "sync-status " + cls;
}

// Once a plan is published, push edits to the cloud (debounced) so its link stays current.
function scheduleCloudSync() {
  if (!(state.published && state.cloudId && SUPABASE.url)) return;
  setSyncStatus("saving");
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    cloudSave(state.cloudId, currentPayload())
      .then(() => setSyncStatus("synced"))
      .catch(() => setSyncStatus("error"));
  }, 1200);
}

// Ordered list of distinct group names, by first appearance.
function groupNames() {
  const seen = [];
  for (const it of state.items) {
    if (it.group && !seen.includes(it.group)) seen.push(it.group);
  }
  return seen;
}

// Make sure every group has exactly one valid selection (defaults to first member).
function ensureGroupSelections() {
  const names = groupNames();
  // Drop selection / on-off state for groups that no longer exist.
  for (const key of Object.keys(state.groupSel)) {
    if (!names.includes(key)) delete state.groupSel[key];
  }
  for (const key of Object.keys(state.groupOff)) {
    if (!names.includes(key)) delete state.groupOff[key];
  }
  for (const name of names) {
    const members = state.items.filter((it) => it.group === name);
    const sel = state.groupSel[name];
    if (!sel || !members.some((m) => m.id === sel)) {
      state.groupSel[name] = members[0].id;
    }
  }
}

function isGroupOn(name) { return !state.groupOff[name]; }

function toggleGroupOn(name) {
  state.groupOff[name] = isGroupOn(name); // flip: on -> true(off), off -> false(on)
  save();
  render();
}

// The shared date range for a group (taken from its first member), or null if empty.
function groupDatesFor(name) {
  const first = state.items.find((it) => it.group === name);
  return first ? { date: first.date, endDate: first.endDate } : null;
}

// Apply a date range to every member of a group so they always stay in sync.
function setGroupDates(name, date, endDate) {
  for (const it of state.items) {
    if (it.group === name) { it.date = date; it.endDate = endDate; }
  }
}

// An item is counted if: it's the selected option in its group, or (no group) it's
// fixed, or it's optional-and-included.
function isCounted(item) {
  if (item.group) {
    if (!isGroupOn(item.group)) return false; // whole group skipped
    return state.groupSel[item.group] === item.id;
  }
  if (item.optional) return item.included;
  return true;
}

function currentMode() {
  return (document.querySelector('input[name="countMode"]:checked') || {}).value || "always";
}

function syncGroupNameVisibility() {
  $("groupNameWrap").classList.toggle("show", currentMode() === "group");
  fillFormDatesFromGroup();
}

// Keep the end-date picker from opening on today: anchor it to the chosen start.
function syncEndMin() {
  $("itemEndDate").min = $("itemDate").value || "";
}

// When the add form targets an existing group, show that group's shared dates so
// the user doesn't re-enter them (grouped items always share one range).
function fillFormDatesFromGroup() {
  if (currentMode() !== "group") return;
  const name = $("groupName").value.trim();
  if (!name) return;
  const dates = groupDatesFor(name);
  if (dates) {
    $("itemDate").value = dates.date || "";
    $("itemEndDate").value = dates.endDate || "";
    syncEndMin();
  }
}

function refreshGroupDatalist() {
  const dl = $("groupList");
  dl.innerHTML = "";
  for (const name of groupNames()) {
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  }
}

function addItem() {
  const type = $("itemType").value;
  const title = $("itemTitle").value.trim();
  const cost = Math.max(0, parseFloat($("itemCost").value) || 0);
  const people = Math.max(0, parseInt($("itemPeople").value, 10) || 0);
  let date = $("itemDate").value || "";
  let endDate = $("itemEndDate").value || "";
  const mode = currentMode();

  if (!title) { $("itemTitle").focus(); return; }

  let group = "";
  if (mode === "group") {
    group = $("groupName").value.trim();
    if (!group) { $("groupName").focus(); return; }
    // Joining an existing group? Inherit its shared dates rather than the typed ones.
    const shared = groupDatesFor(group);
    if (shared) { date = shared.date; endDate = shared.endDate; }
  }

  const item = {
    id: "i" + Date.now() + Math.floor(Math.random() * 1000),
    type, title, cost, people, date, endDate,
    optional: mode === "optional",
    included: true,
    group,
  };
  state.items.push(item);
  // Remember these so the next item defaults to the same timeframe and party size.
  state.lastDate = date;
  state.lastEndDate = endDate;
  state.lastPeople = people ? String(people) : "";
  ensureGroupSelections();
  save();
  render();

  // Reset for the next entry; keep type + mode + group name AND the dates, so entering
  // several activities around the same days doesn't mean re-navigating the calendar.
  $("itemTitle").value = "";
  $("itemCost").value = "";
  $("itemPeople").value = people ? String(people) : "";
  $("itemDate").value = date;
  $("itemEndDate").value = endDate;
  syncEndMin();
  $("itemTitle").focus();
}

function deleteItem(id) {
  state.items = state.items.filter((it) => it.id !== id);
  ensureGroupSelections();
  save();
  render();
}

function toggleIncluded(id) {
  const item = state.items.find((it) => it.id === id);
  if (item) { item.included = !item.included; save(); render(); }
}

function selectGroup(name, id) {
  state.groupSel[name] = id;
  save();
  render();
}

function startEdit(id) {
  editingId = id;
  render();
  const titleInput = document.querySelector(".edit-row .edit-title");
  if (titleInput) titleInput.focus();
}

function cancelEdit() {
  editingId = null;
  render();
}

function saveEdit(id) {
  const item = state.items.find((it) => it.id === id);
  if (!item) { editingId = null; render(); return; }
  const title = document.querySelector(".edit-row .edit-title").value.trim();
  const cost = document.querySelector(".edit-row .edit-cost").value;
  const people = document.querySelector(".edit-row .edit-people").value;
  const date = document.querySelector(".edit-row .edit-start").value;
  const endDate = document.querySelector(".edit-row .edit-end").value;
  if (title) item.title = title;
  item.cost = Math.max(0, parseFloat(cost) || 0);
  item.people = Math.max(0, parseInt(people, 10) || 0);
  if (item.group) {
    // Grouped items share one range — apply the edit to every member.
    setGroupDates(item.group, date || "", endDate || "");
  } else {
    item.date = date || "";
    item.endDate = endDate || "";
  }
  editingId = null;
  save();
  render();
}

function buildEditRow(item) {
  const row = document.createElement("div");
  row.className = "item-row edit-row";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "edit-title";
  titleInput.value = item.title;
  titleInput.placeholder = "Title";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "edit-date edit-start";
  dateInput.value = item.date || "";
  dateInput.title = "Start date";

  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.textContent = "→";

  const endInput = document.createElement("input");
  endInput.type = "date";
  endInput.className = "edit-date edit-end";
  endInput.value = item.endDate || "";
  endInput.title = "End date (optional)";

  const costInput = document.createElement("input");
  costInput.type = "number";
  costInput.className = "edit-cost";
  costInput.min = "0";
  costInput.step = "1";
  costInput.value = item.cost;

  const peopleInput = document.createElement("input");
  peopleInput.type = "number";
  peopleInput.className = "edit-people";
  peopleInput.min = "0";
  peopleInput.step = "1";
  peopleInput.placeholder = "# ppl";
  peopleInput.title = "How many people this is for";
  peopleInput.value = item.people ? String(item.people) : "";

  const saveBtn = document.createElement("button");
  saveBtn.className = "edit-save";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => saveEdit(item.id));

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "icon-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", cancelEdit);

  // Enter saves, Escape cancels, from any field.
  for (const inp of [titleInput, dateInput, endInput, costInput, peopleInput]) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveEdit(item.id); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    });
  }

  row.append(titleInput, dateInput, arrow, endInput, costInput, peopleInput, saveBtn, cancelBtn);
  return row;
}

function buildRow(item) {
  if (editingId === item.id) return buildEditRow(item);

  const row = document.createElement("div");
  const excluded = !isCounted(item);
  row.className = "item-row" + (excluded ? " excluded" : "");

  // First cell: group radio / optional checkbox / fixed lock.
  let control;
  if (item.group) {
    control = document.createElement("input");
    control.type = "radio";
    control.className = "item-check";
    control.name = "grp-" + item.group;
    control.checked = state.groupSel[item.group] === item.id;
    control.disabled = !isGroupOn(item.group); // can't pick within a skipped group
    control.title = `Choose this option for "${item.group}"`;
    control.addEventListener("change", () => selectGroup(item.group, item.id));
  } else if (item.optional) {
    control = document.createElement("input");
    control.type = "checkbox";
    control.className = "item-check";
    control.checked = item.included;
    control.title = "Include this in the total";
    control.addEventListener("change", () => toggleIncluded(item.id));
  } else {
    control = document.createElement("span");
    control.className = "fixed-dot";
    control.textContent = "🔒";
    control.title = "Always counted";
  }

  const meta = TYPES[item.type] || TYPES.other;
  const main = document.createElement("div");
  main.className = "item-main";
  // Grouped members live inside a card whose header already shows the group name and
  // shared dates, so we omit the badge and date here to avoid repeating them.
  const subParts = [meta.label];
  if (!item.group) {
    const dateText = fmtDateRange(item.date, item.endDate);
    if (dateText) subParts.push(`<span class="item-date">${dateText}</span>`);
  }
  if (item.people) subParts.push(`for ${item.people}`);
  main.innerHTML =
    `<span class="item-title"><span class="item-icon">${meta.icon}</span>${escapeHTML(item.title)}</span>` +
    `<span class="item-sub">${subParts.join(" · ")}</span>`;

  const costCell = document.createElement("div");
  costCell.className = "item-cost";
  const perPerson = perPersonText(item.cost, item.people);
  costCell.innerHTML = fmtUSD(item.cost) + (perPerson ? `<span class="per-person">${perPerson}</span>` : "");

  const actions = document.createElement("div");
  actions.className = "item-actions";
  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => startEdit(item.id));
  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => deleteItem(item.id));
  actions.append(editBtn, delBtn);

  row.append(control, main, costCell, actions);
  return row;
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// True when an item spans more than one day (a real end date after its start).
function isRange(item) {
  return !!(item.endDate && item.endDate > item.date);
}

// Order by start date (undated last); on the same day, single-day activities come
// before multi-day ranges that begin that day; then by title.
function byDateThenTitle(a, b) {
  const ak = a.date || "9999-12-31";
  const bk = b.date || "9999-12-31";
  if (ak !== bk) return ak < bk ? -1 : 1;
  const ar = isRange(a) ? 1 : 0;
  const br = isRange(b) ? 1 : 0;
  if (ar !== br) return ar - br;
  return a.title.localeCompare(b.title);
}

function buildGroupCard(name) {
  const members = state.items.filter((it) => it.group === name);
  const on = isGroupOn(name);

  const card = document.createElement("div");
  card.className = "group-card" + (on ? "" : " off");

  const header = document.createElement("div");
  header.className = "gc-header";

  const dates = groupDatesFor(name);
  const dateText = dates ? fmtDateRange(dates.date, dates.endDate) : "";
  const metaBits = [`pick one of ${members.length}`];
  if (dateText) metaBits.push(dateText);
  const titleEl = document.createElement("div");
  titleEl.className = "gc-title";
  titleEl.innerHTML =
    `<span class="gc-icon">🔀</span>${escapeHTML(name)}` +
    `<span class="gc-meta">${metaBits.join(" · ")}</span>`;

  const includeLabel = document.createElement("label");
  includeLabel.className = "gc-include";
  const includeCb = document.createElement("input");
  includeCb.type = "checkbox";
  includeCb.checked = on;
  includeCb.title = "Uncheck to skip this whole group (counts as $0)";
  includeCb.addEventListener("change", () => toggleGroupOn(name));
  includeLabel.append(includeCb, document.createTextNode("Include this group"));

  header.append(titleEl, includeLabel);
  card.append(header);

  for (const m of members) card.append(buildRow(m));
  return card;
}

// Shared start date + whether the group's range spans multiple days, for sorting.
function groupSortInfo(name) {
  const d = groupDatesFor(name) || { date: "", endDate: "" };
  return { date: d.date || "9999-12-31", range: !!(d.endDate && d.endDate > d.date) };
}

// Order groups by their shared start date, keeping creation order as the tiebreak.
function orderedGroupNames() {
  return groupNames()
    .map((name, i) => ({ name, i, key: (groupDatesFor(name)?.date) || "9999-12-31" }))
    .sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : a.i - b.i))
    .map((o) => o.name);
}

function render() {
  ensureGroupSelections();
  refreshGroupDatalist();
  const list = $("itineraryList");
  list.innerHTML = "";

  if (state.items.length === 0) {
    list.innerHTML = '<div class="empty">Nothing added yet. Use the form above to add your first activity.</div>';
    renderTotals();
    return;
  }

  const ungrouped = state.items.filter((it) => !it.group);

  if (state.sort === "date") {
    // One timeline: group cards and individual items interleaved by date, with
    // single-day activities ahead of ranges that begin the same day.
    const entries = [];
    for (const name of groupNames()) {
      const info = groupSortInfo(name);
      entries.push({ date: info.date, range: info.range, title: name, node: buildGroupCard(name) });
    }
    for (const item of ungrouped) {
      entries.push({ date: item.date || "9999-12-31", range: isRange(item), title: item.title, node: buildRow(item) });
    }
    entries.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ar = a.range ? 1 : 0, br = b.range ? 1 : 0;
      if (ar !== br) return ar - br;
      return a.title.localeCompare(b.title);
    });
    for (const e of entries) list.appendChild(e.node);
  } else {
    // Group-by-type: choice groups first, then a section per activity type.
    const groups = orderedGroupNames();
    if (groups.length) {
      const heading = document.createElement("div");
      heading.className = "area-heading";
      heading.textContent = "Choice groups";
      list.appendChild(heading);
      for (const name of groups) list.appendChild(buildGroupCard(name));
    }
    for (const type of TYPE_ORDER) {
      const inType = ungrouped.filter((it) => it.type === type).sort(byDateThenTitle);
      if (inType.length === 0) continue;
      const heading = document.createElement("div");
      heading.className = "area-heading";
      heading.textContent = (TYPES[type] || TYPES.other).label;
      list.appendChild(heading);
      for (const item of inType) list.appendChild(buildRow(item));
    }
  }

  renderTotals();
}

function renderTotals() {
  let fixed = 0, choices = 0, optionalInc = 0;
  let optionalCount = 0, optionalOn = 0;
  for (const item of state.items) {
    if (item.group) {
      if (isCounted(item)) choices += item.cost;
    } else if (item.optional) {
      optionalCount++;
      if (item.included) { optionalInc += item.cost; optionalOn++; }
    } else {
      fixed += item.cost;
    }
  }
  const grand = fixed + choices + optionalInc;

  const lines = [];
  const hasFixed = state.items.some((it) => !it.group && !it.optional);
  const hasGroups = groupNames().length > 0;
  if (hasFixed) lines.push(["Committed (always counted)", fixed]);
  if (hasGroups) lines.push(["Selected choices", choices]);
  if (optionalCount > 0) lines.push(["Optional items included", optionalInc]);

  $("totalLines").innerHTML = lines.map(
    ([label, val]) => `<div class="total-row"><span class="label">${label}</span><span class="val">${fmtUSD(val)}</span></div>`
  ).join("");
  $("grandTotal").textContent = fmtUSD(grand);

  const counted = state.items.filter(isCounted).length;
  let note = "";
  if (state.items.length > 0) {
    note = `${counted} of ${state.items.length} item${state.items.length === 1 ? "" : "s"} counted`;
    if (optionalCount > 0) note += ` · ${optionalOn}/${optionalCount} optional on`;
    if (hasGroups) note += ` · ${groupNames().length} choice group${groupNames().length === 1 ? "" : "s"}`;
  }
  $("totalNote").textContent = note;
}

// --- Sharing --------------------------------------------------------------
// Encode the plan into the URL of a view-only page so it can be sent as a link.
function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}

// The published pages. Used when the planner is opened from a local file so links
// still point at URLs that work on other people's devices.
const LIVE_VIEW_URL = "https://babbishai.github.io/wdw-trip-planner/view.html";
const LIVE_BUILDER_URL = "https://babbishai.github.io/wdw-trip-planner/itinerary.html";

function currentPayload() {
  return {
    title: state.title,
    items: state.items,
    groupSel: state.groupSel,
    groupOff: state.groupOff,
  };
}

// Resolve a published page URL: relative on the live site, absolute from a local file.
function publishedBase(fileName, liveUrl) {
  const isWeb = location.protocol === "http:" || location.protocol === "https:";
  return isWeb ? new URL(fileName, location.href).href : liveUrl;
}

// Short, STABLE view link backed by the cloud id (contents live in Supabase).
function viewLinkFor(id) {
  return publishedBase("view.html", LIVE_VIEW_URL) + "?id=" + encodeURIComponent(id);
}

// The "editable link" still carries the whole plan in its hash — used to move an
// editable copy into another builder/device, independent of cloud publishing.
function buildMoveLink() {
  return publishedBase("itinerary.html", LIVE_BUILDER_URL) + "#" + b64urlEncode(JSON.stringify(currentPayload()));
}

function presentLink(link, label, copiedMsg) {
  $("shareBoxLabel").textContent = label;
  $("shareBox").hidden = false;
  if (state.items.length === 0) {
    $("shareLink").value = "";
    $("copyMsg").textContent = "Add at least one activity first.";
    return;
  }
  $("shareLink").value = link;
  $("shareLink").select();
  $("copyMsg").textContent = "";
  // Try to copy automatically; fall back to manual selection if blocked.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link)
      .then(() => { $("copyMsg").textContent = copiedMsg; })
      .catch(() => { $("copyMsg").textContent = "Select the link above and copy it (Ctrl+C)."; });
  } else {
    $("copyMsg").textContent = "Select the link above and copy it (Ctrl+C).";
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject();
}

// Publish the plan to the cloud under a stable id and show its short, permanent link.
async function publishShare() {
  $("shareBoxLabel").textContent = "Anyone with this link can view your itinerary. It stays the same and updates automatically as you edit:";
  $("shareBox").hidden = false;
  if (state.items.length === 0) {
    $("shareLink").value = "";
    $("copyMsg").textContent = "Add at least one activity first.";
    return;
  }
  if (!SUPABASE.url) {
    $("copyMsg").textContent = "Cloud storage isn't configured.";
    return;
  }
  if (!state.cloudId) state.cloudId = newId();
  const link = viewLinkFor(state.cloudId);
  $("shareLink").value = link;
  $("copyMsg").textContent = "Publishing…";
  try {
    await cloudSave(state.cloudId, currentPayload());
    state.published = true;
    save(); // persist cloudId + published
    setSyncStatus("synced");
    $("shareLink").select();
    copyToClipboard(link)
      .then(() => { $("copyMsg").textContent = "Published & link copied — it stays the same and always shows your latest changes."; })
      .catch(() => { $("copyMsg").textContent = "Published! Select the link above and copy it (Ctrl+C)."; });
  } catch (e) {
    $("copyMsg").textContent = "Couldn't publish — check your connection and try again.";
  }
}

function showMoveLink() {
  presentLink(
    buildMoveLink(),
    "Open this link on the published site (or any device) to load this plan into that builder, where you can keep editing it:",
    "Editable link copied — open it on the published site to load your plan there."
  );
}

function copyShareLink() {
  const el = $("shareLink");
  if (!el.value) return;
  el.select();
  const done = () => { $("copyMsg").textContent = "Copied!"; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(el.value).then(done).catch(() => { try { document.execCommand("copy"); done(); } catch (e) {} });
  } else {
    try { document.execCommand("copy"); done(); } catch (e) {}
  }
}

// If the page was opened with a plan in the URL hash (an "editable link"), offer to
// load it into this builder. Runs after load() so we can warn about overwriting.
function maybeImportFromHash() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return;
  let payload;
  try { payload = JSON.parse(b64urlDecode(hash)); } catch (e) { return; }
  if (!payload || !Array.isArray(payload.items)) return;

  // Always clear the hash so a later refresh doesn't re-prompt.
  const clearHash = () => history.replaceState(null, "", location.pathname + location.search);

  const incoming = payload.title ? `"${payload.title}"` : "this shared plan";
  const question = state.items.length > 0
    ? `Load ${incoming} into this builder?\n\nThis REPLACES the ${state.items.length} item(s) currently here. (Tip: use "Copy editable link" first if you want to keep the current one.)`
    : `Load ${incoming} into this builder?`;

  if (!window.confirm(question)) { clearHash(); return; }

  state = Object.assign(
    { title: "", sort: "type", items: [], groupSel: {}, groupOff: {}, lastDate: "", lastEndDate: "", lastPeople: "", cloudId: "", published: false },
    {
      title: payload.title || "",
      items: payload.items || [],
      groupSel: payload.groupSel || {},
      groupOff: payload.groupOff || {},
    }
  );
  // Backfill any per-item fields the payload might not carry.
  for (const it of state.items) {
    if (typeof it.date !== "string") it.date = "";
    if (typeof it.endDate !== "string") it.endDate = "";
    if (typeof it.people !== "number") it.people = 0;
    if (typeof it.group !== "string") it.group = "";
    if (typeof it.optional !== "boolean") it.optional = false;
    if (typeof it.included !== "boolean") it.included = true;
  }
  save();
  clearHash();
}

function init() {
  load();
  maybeImportFromHash();

  $("itineraryTitle").value = state.title || "";
  if (state.title) document.title = state.title + " — Itinerary";
  $("sortMode").value = state.sort || "type";

  // Seed the calendar to a relevant month: last entered range, else the earliest
  // date already in the itinerary. Keeps the picker off today's month for a future trip.
  const datedStarts = state.items.map((it) => it.date).filter(Boolean).sort();
  const anchor = state.lastDate || datedStarts[0] || "";
  if (anchor) $("itemDate").value = anchor;
  if (state.lastEndDate) $("itemEndDate").value = state.lastEndDate;
  if (state.lastPeople) $("itemPeople").value = state.lastPeople;
  syncEndMin();

  render();

  $("addBtn").addEventListener("click", addItem);
  for (const id of ["itemTitle", "itemCost", "itemPeople", "groupName"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    });
  }
  for (const r of document.querySelectorAll('input[name="countMode"]')) {
    r.addEventListener("change", syncGroupNameVisibility);
  }
  $("itemDate").addEventListener("change", syncEndMin);
  $("groupName").addEventListener("input", fillFormDatesFromGroup);
  syncGroupNameVisibility();

  $("itineraryTitle").addEventListener("input", () => {
    state.title = $("itineraryTitle").value;
    document.title = state.title ? state.title + " — Itinerary" : "WDW Trip Planner — Itinerary Builder";
    save();
  });
  $("sortMode").addEventListener("change", () => {
    state.sort = $("sortMode").value;
    save();
    render();
  });

  $("shareBtn").addEventListener("click", publishShare);
  $("moveBtn").addEventListener("click", showMoveLink);
  $("copyLink").addEventListener("click", copyShareLink);

  // If this plan was already published, keep its link current from the moment it loads.
  if (state.published && state.cloudId) setSyncStatus("synced");
}

init();
