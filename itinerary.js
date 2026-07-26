// WDW Trip Planner — Itinerary Builder. Vanilla JS, no build step.
// Items are user-entered and persisted to localStorage so they survive a refresh.

const STORAGE_KEY = "wdw-itinerary-v1";

const $ = (id) => document.getElementById(id);

function fmtUSD(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
// Display order for the grouped list.
const TYPE_ORDER = ["flight", "stay", "car", "reservation", "ticket", "other"];

// In-memory list of items: { id, type, title, cost, optional, included }.
let items = [];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) items = JSON.parse(raw);
  } catch (e) {
    items = [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    // Storage full or blocked (e.g. private mode) — the app still works this session.
  }
}

// An item counts toward the total if it's fixed, or optional-and-included.
function isCounted(item) {
  return !item.optional || item.included;
}

function addItem() {
  const type = $("itemType").value;
  const title = $("itemTitle").value.trim();
  const cost = Math.max(0, parseFloat($("itemCost").value) || 0);
  const optional = $("itemOptional").checked;

  if (!title) {
    $("itemTitle").focus();
    return;
  }

  items.push({
    id: "i" + Date.now() + Math.floor(Math.random() * 1000),
    type,
    title,
    cost,
    optional,
    included: true, // optional items start included
  });
  save();
  render();

  // Reset the form for the next entry, keeping the type selected for fast repeat adds.
  $("itemTitle").value = "";
  $("itemCost").value = "";
  $("itemOptional").checked = false;
  $("itemTitle").focus();
}

function deleteItem(id) {
  items = items.filter((it) => it.id !== id);
  save();
  render();
}

function toggleIncluded(id) {
  const item = items.find((it) => it.id === id);
  if (item) {
    item.included = !item.included;
    save();
    render();
  }
}

function editItem(id) {
  const item = items.find((it) => it.id === id);
  if (!item) return;
  const newTitle = prompt("Edit title:", item.title);
  if (newTitle === null) return; // cancelled
  const trimmed = newTitle.trim();
  if (trimmed) item.title = trimmed;

  const newCost = prompt("Edit cost ($):", item.cost);
  if (newCost !== null) {
    const parsed = Math.max(0, parseFloat(newCost) || 0);
    item.cost = parsed;
  }
  save();
  render();
}

function buildRow(item) {
  const row = document.createElement("div");
  row.className = "item-row" + (item.optional && !item.included ? " excluded" : "");

  // First cell: checkbox for optional items, a lock indicator for fixed ones.
  let control;
  if (item.optional) {
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
    control.title = "Always counted (not optional)";
  }

  const meta = TYPES[item.type] || TYPES.other;
  const titleCell = document.createElement("div");
  titleCell.innerHTML =
    `<span class="item-title"><span class="item-icon">${meta.icon}</span>${escapeHTML(item.title)}</span>` +
    `<span class="item-type-label">${meta.label}${item.optional ? " · optional" : ""}</span>`;

  const costCell = document.createElement("div");
  costCell.className = "item-cost";
  costCell.textContent = fmtUSD(item.cost);

  const actions = document.createElement("div");
  actions.className = "item-actions";
  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => editItem(item.id));
  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => deleteItem(item.id));
  actions.append(editBtn, delBtn);

  row.append(control, titleCell, costCell, actions);
  return row;
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function render() {
  const list = $("itineraryList");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = '<div class="empty">Nothing added yet. Use the form above to add your first activity.</div>';
  } else {
    // Group by type, in TYPE_ORDER.
    for (const type of TYPE_ORDER) {
      const group = items.filter((it) => it.type === type);
      if (group.length === 0) continue;
      const heading = document.createElement("div");
      heading.className = "area-heading";
      heading.textContent = (TYPES[type] || TYPES.other).label;
      list.appendChild(heading);
      for (const item of group) list.appendChild(buildRow(item));
    }
  }

  renderTotals();
}

function renderTotals() {
  let fixed = 0, optionalIncluded = 0, optionalCount = 0, optionalOn = 0;
  for (const item of items) {
    if (!item.optional) {
      fixed += item.cost;
    } else {
      optionalCount++;
      if (item.included) { optionalIncluded += item.cost; optionalOn++; }
    }
  }
  const grand = fixed + optionalIncluded;

  $("fixedTotal").textContent = fmtUSD(fixed);
  $("optionalTotal").textContent = fmtUSD(optionalIncluded);
  $("grandTotal").textContent = fmtUSD(grand);

  const counted = items.filter(isCounted).length;
  let note = "";
  if (items.length > 0) {
    note = `${counted} of ${items.length} item${items.length === 1 ? "" : "s"} counted`;
    if (optionalCount > 0) {
      note += ` · ${optionalOn} of ${optionalCount} optional item${optionalCount === 1 ? "" : "s"} on`;
    }
  }
  $("totalNote").textContent = note;
}

function init() {
  load();
  render();
  $("addBtn").addEventListener("click", addItem);
  // Enter in the title or cost field adds the item.
  for (const id of ["itemTitle", "itemCost"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    });
  }
}

init();
