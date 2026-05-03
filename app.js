// WDW Rack Rate Calculator — vanilla JS, no build step.

let DATA = null;

const $ = (id) => document.getElementById(id);

function fmtUSD(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function parseISO(s) { return new Date(s + "T00:00:00"); }
function toISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fmtDate(d) { return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }

// Map a JS day-of-week (0=Sun..6=Sat) to the mousesavers tier key.
//   Mon, Tue, Wed   → monWed
//   Sun, Thu        → sunThu
//   Fri, Sat        → friSat
function dayOfWeekTier(dow) {
  if (dow === 0 || dow === 4) return "sunThu";
  if (dow >= 1 && dow <= 3) return "monWed";
  return "friSat";
}

const TIER_LABEL = { monWed: "Mon–Wed", sunThu: "Sun/Thu", friSat: "Fri/Sat" };

function rateForNight(date, room, season) {
  const tiers = room.rates[season.id];
  if (!tiers) return null;
  const tier = dayOfWeekTier(date.getDay());
  const rate = tiers[tier];
  return typeof rate === "number" ? { tier, rate } : null;
}

// DVC points tier: chart is 5/1/1 (Sun-Thu / Fri / Sat), different from cash 3/2/2.
function pointsTier(dow) {
  if (dow === 5) return "fri";
  if (dow === 6) return "sat";
  return "sunThu";
}

function findDvcSeason(date, dvcSeasons) {
  const iso = typeof date === "string" ? date : toISO(date);
  for (const season of dvcSeasons) {
    for (const [start, end] of season.ranges) {
      if (iso >= start && iso <= end) return season;
    }
  }
  return null;
}

function pointsForNight(date, room, dvcSeason) {
  const tiers = room.dvcPoints?.[dvcSeason.id];
  if (!tiers) return null;
  const t = pointsTier(date.getDay());
  return typeof tiers[t] === "number" ? tiers[t] : null;
}

// Returns { points, dollars, exact } for the stay, or null if the resort isn't DVC.
// `exact` is true when computed from a real points chart; false when using the heuristic.
// Caller passes cashTotal for the heuristic fallback.
function dvcEquivalentForStay(resort, room, checkInISO, checkOutISO, cashTotal) {
  if (resort.tier !== "dvc") return null;

  // Try exact calculation first (requires points chart data).
  if (resort.dvcSeasons && resort.dvcPerPointRate && room.dvcPoints) {
    let totalPoints = 0, ok = true;
    const start = parseISO(checkInISO);
    const end = parseISO(checkOutISO);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const season = findDvcSeason(d, resort.dvcSeasons);
      if (!season) { ok = false; break; }
      const pts = pointsForNight(d, room, season);
      if (pts == null) { ok = false; break; }
      totalPoints += pts;
    }
    if (ok) {
      return {
        points: totalPoints,
        dollars: totalPoints * resort.dvcPerPointRate,
        exact: true,
      };
    }
  }

  // Heuristic fallback for DVC resorts without a loaded points chart.
  if (typeof cashTotal === "number" && cashTotal > 0) {
    return {
      points: null,
      dollars: cashTotal * (1 - DVC_ESTIMATE_DISCOUNT),
      exact: false,
    };
  }
  return null;
}

function eachNight(checkIn, checkOut) {
  const nights = [];
  const start = parseISO(checkIn);
  const end = parseISO(checkOut);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    nights.push(new Date(d));
  }
  return nights;
}

function findSeason(date, seasons) {
  const iso = typeof date === "string" ? date : toISO(date);
  for (const season of seasons) {
    for (const [start, end] of season.ranges) {
      if (iso >= start && iso <= end) return season;
    }
  }
  return null;
}

function currentResort() { return DATA.resorts.find((r) => r.id === $("resort").value); }
function currentRoom() {
  const r = currentResort();
  return r?.roomTypes.find((rt) => rt.id === $("roomType").value);
}

function dvcNoteHTML(rate, exact) {
  const rateDisplay = typeof rate === "number" ? `$${rate}/pt` : "$20–24/pt";
  const body = exact === false
    ? `<strong>DVC estimate.</strong> This resort doesn't have a points chart loaded yet, so the
       DVC equivalent is approximated as <strong>${Math.round(DVC_ESTIMATE_DISCOUNT * 100)}% off the cash rate</strong>
       (industry-typical savings via David's DVC Rental Store). Real savings range 30–50% depending on resort and dates.
       Get the exact quote at <a href="https://dvcrequest.com/" target="_blank" rel="noopener">dvcrequest.com</a>.`
    : `<strong>DVC equivalent.</strong> Computed from the published 2026 DVC points chart
       multiplied by an estimated David's DVC Rental Store renter rate (${rateDisplay}).
       Dave's actual rate varies per booking — get the exact quote at
       <a href="https://dvcrequest.com/" target="_blank" rel="noopener">dvcrequest.com</a>.`;
  return `<div class="dvc-note">${body}</div>`;
}

function tierTag(tier) {
  const cls = { value: "tag-value", moderate: "tag-value", deluxe: "tag-deluxe", dvc: "tag-dvc" }[tier] || "";
  return `<span class="tag ${cls}">${tier}</span>`;
}

function populateResorts() {
  const sel = $("resort");
  sel.innerHTML = "";
  for (const r of DATA.resorts) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${r.name} (${r.tier})`;
    sel.appendChild(opt);
  }
}

function populateRoomTypes() {
  const resort = currentResort();
  const sel = $("roomType");
  sel.innerHTML = "";
  for (const rt of resort.roomTypes) {
    const opt = document.createElement("option");
    opt.value = rt.id;
    opt.textContent = rt.name;
    sel.appendChild(opt);
  }
}

function unionSeasons() {
  const seen = new Map();
  for (const r of DATA.resorts) {
    for (const s of r.seasons) {
      if (!seen.has(s.id)) seen.set(s.id, s.name);
    }
  }
  return [...seen.entries()];
}

function populateSeasonFilter() {
  const sel = $("seasonFilter");
  const prev = sel.value;
  sel.innerHTML = '<option value="">Any season (all of 2026)</option>';
  for (const [id, name] of unionSeasons()) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function populateCheapestResort() {
  const tier = $("cheapestTier").value;
  const sel = $("cheapestResort");
  const prev = sel.value;
  const matches = tier ? DATA.resorts.filter((r) => r.tier === tier) : DATA.resorts;
  sel.innerHTML = '<option value="">Any resort</option>';
  for (const r of matches) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name;
    sel.appendChild(opt);
  }
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : "";
}

function findCheapest() {
  const tier = $("cheapestTier").value;
  const resortId = $("cheapestResort").value;
  const nights = parseInt($("nights").value, 10);
  const seasonId = $("seasonFilter").value;
  const topN = parseInt($("topN").value, 10);
  const out = $("cheapestResults");

  if (!nights || nights < 1) {
    out.innerHTML = '<span class="empty">Pick a number of nights.</span>';
    $("cheapestDvcNote").innerHTML = "";
    return;
  }

  let resorts = DATA.resorts;
  if (tier) resorts = resorts.filter((r) => r.tier === tier);
  if (resortId) resorts = resorts.filter((r) => r.id === resortId);

  if (resorts.length === 0) {
    out.innerHTML = '<span class="empty">No resorts match those filters.</span>';
    $("cheapestDvcNote").innerHTML = "";
    return;
  }

  const results = [];

  for (const resort of resorts) {
    const seasonsInScope = seasonId
      ? resort.seasons.filter((s) => s.id === seasonId)
      : resort.seasons;
    if (seasonsInScope.length === 0) continue;

    const validDates = new Set();
    for (const season of seasonsInScope) {
      for (const [a, b] of season.ranges) {
        const s = parseISO(a), e = parseISO(b);
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          validDates.add(toISO(d));
        }
      }
    }
    const sortedStarts = [...validDates].sort();

    const dvcAvailable = !!(resort.dvcSeasons && resort.dvcPerPointRate);
    const isDvc = resort.tier === "dvc";

    for (const room of resort.roomTypes) {
      const roomHasExactDvc = dvcAvailable && !!room.dvcPoints;
      for (const startISO of sortedStarts) {
        const start = parseISO(startISO);
        let total = 0, ok = true;
        let dvcPointsTotal = 0, dvcExactOk = roomHasExactDvc;
        const seasonsHit = new Set();
        for (let i = 0; i < nights; i++) {
          const d = new Date(start);
          d.setDate(d.getDate() + i);
          const iso = toISO(d);
          if (!validDates.has(iso)) { ok = false; break; }
          const season = findSeason(iso, resort.seasons);
          const r = season ? rateForNight(d, room, season) : null;
          if (!r) { ok = false; break; }
          total += r.rate;
          seasonsHit.add(season.name);
          if (dvcExactOk) {
            const dvcSeason = findDvcSeason(iso, resort.dvcSeasons);
            const pts = dvcSeason ? pointsForNight(d, room, dvcSeason) : null;
            if (pts == null) dvcExactOk = false;
            else dvcPointsTotal += pts;
          }
        }
        if (!ok) continue;
        const checkOut = new Date(start);
        checkOut.setDate(checkOut.getDate() + nights);

        // Resolve DVC dollars: exact when points data exists, heuristic otherwise.
        let dvcDollars = null, dvcPointsOut = null, dvcExactOut = null;
        if (dvcExactOk) {
          dvcDollars = dvcPointsTotal * resort.dvcPerPointRate;
          dvcPointsOut = dvcPointsTotal;
          dvcExactOut = true;
        } else if (isDvc) {
          dvcDollars = total * (1 - DVC_ESTIMATE_DISCOUNT);
          dvcExactOut = false;
        }

        results.push({
          resortName: resort.name,
          tier: resort.tier,
          roomName: room.name,
          checkIn: start,
          checkOut,
          total,
          seasons: [...seasonsHit].join(", "),
          dvcDollars,
          dvcPoints: dvcPointsOut,
          dvcExact: dvcExactOut,
        });
      }
    }
  }

  results.sort((a, b) => a.total - b.total);
  const top = results.slice(0, topN);

  if (top.length === 0) {
    out.innerHTML = `<span class="empty">No ${nights}-night windows found for that combination.</span>`;
    $("cheapestDvcNote").innerHTML = "";
    return;
  }

  const rows = top.map((r) => {
    let dvcCell;
    if (r.dvcDollars == null) {
      dvcCell = '<span class="empty">—</span>';
    } else if (r.dvcExact) {
      dvcCell = `<span class="dvc-cell">${fmtUSD(r.dvcDollars)}<small> (${r.dvcPoints}pt)</small></span>`;
    } else {
      dvcCell = `<span class="dvc-cell">${fmtUSD(r.dvcDollars)}<small> (~40% est.)</small></span>`;
    }
    return `<tr class="cheapest-row">
      <td>${r.resortName} ${tierTag(r.tier)}</td>
      <td>${r.roomName}</td>
      <td>${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}</td>
      <td>${r.seasons}</td>
      <td class="right total">${fmtUSD(r.total)}</td>
      <td class="right">${dvcCell}</td>
    </tr>`;
  }).join("");

  const seasonLabel = seasonId
    ? (unionSeasons().find(([id]) => id === seasonId)?.[1] || seasonId)
    : "any season";
  const scopeLabel = resortId
    ? resorts[0].name
    : (tier ? `${resorts.length} ${tier} resort${resorts.length === 1 ? "" : "s"}` : `all ${resorts.length} resorts`);
  out.innerHTML = `
    <p style="margin: 0 0 12px; color: var(--muted); font-size: 0.9rem;">
      Showing ${top.length} cheapest ${nights}-night stays at <strong>${scopeLabel}</strong> in <strong>${seasonLabel}</strong>
      (${results.length.toLocaleString()} total window${results.length === 1 ? "" : "s"} considered).
      Totals are exact rack rates summed by day-of-week.
    </p>
    <table>
      <thead>
        <tr><th>Resort</th><th>Room</th><th>Dates</th><th>Season(s)</th><th class="right">Cash total</th><th class="right">DVC equiv. (Dave's)</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // UCT compare row — always show below cheapest results.
  const uctCompareRow = `
    <div class="uct-compare-row" style="margin-top: 14px;">
      <span>Want exact quotes for these stays?</span>
      <a href="https://www.undercovertourist.com/orlando/walt-disney-world-resort/" target="_blank" rel="noopener">Compare on Undercover Tourist ↗</a>
      ${top.some((r) => r.tier === "dvc") ? '<a href="https://dvcrequest.com/" target="_blank" rel="noopener">DVC rental on David\'s ↗</a>' : ""}
    </div>`;
  out.innerHTML += uctCompareRow;

  // Show a DVC note if any rendered row has a DVC value. Prefer the exact-style note when at least
  // one row was computed from a real points chart; fall back to estimate-style otherwise.
  const anyExact = top.some((r) => r.dvcExact === true);
  const anyDvc = top.some((r) => r.dvcDollars != null);
  if (anyDvc) {
    const exactResort = anyExact ? top.find((r) => r.dvcExact === true) : null;
    const dvcRate = exactResort
      ? resorts.find((res) => res.name === exactResort.resortName)?.dvcPerPointRate
      : null;
    $("cheapestDvcNote").innerHTML = dvcNoteHTML(dvcRate, anyExact);
  } else {
    $("cheapestDvcNote").innerHTML = "";
  }
}

function recalc() {
  const resort = currentResort();
  const room = currentRoom();
  const checkIn = $("checkIn").value;
  const checkOut = $("checkOut").value;
  const summary = $("summary");
  const breakdown = $("breakdown");
  const footnote = $("footnote");

  if (!resort || !room || !checkIn || !checkOut || checkIn >= checkOut) {
    summary.className = "empty";
    summary.textContent = "Pick a resort, room type, and a valid date range.";
    breakdown.innerHTML = "";
    footnote.textContent = "";
    TRIP.hotel = { cash: 0, dvc: 0, label: null, checkIn: null };
    if (typeof recalcTickets === "function") recalcTickets();
    recalcTripTotal();
    return;
  }

  const nights = eachNight(checkIn, checkOut);
  const rows = [];
  let total = 0, missing = 0;

  for (const date of nights) {
    const season = findSeason(date, resort.seasons);
    if (!season) {
      missing++;
      rows.push(`<tr><td>${fmtDate(date)}</td><td colspan="3" class="empty">No 2026 season data for this date</td></tr>`);
      continue;
    }
    const r = rateForNight(date, room, season);
    if (!r) {
      missing++;
      rows.push(`<tr><td>${fmtDate(date)}</td><td>${season.name}</td><td colspan="2" class="empty">No rate</td></tr>`);
      continue;
    }
    total += r.rate;
    rows.push(`<tr>
      <td>${fmtDate(date)}</td>
      <td>${season.name}</td>
      <td>${TIER_LABEL[r.tier]}</td>
      <td class="right">${fmtUSD(r.rate)}</td>
    </tr>`);
  }

  const dvc = dvcEquivalentForStay(resort, room, checkIn, checkOut, total);
  let dvcBlock = "";
  if (dvc) {
    const meta = dvc.exact
      ? `${dvc.points} pts × $${resort.dvcPerPointRate}/pt · saves ${fmtUSD(total - dvc.dollars)} (${Math.round((1 - dvc.dollars / total) * 100)}%)`
      : `~${Math.round(DVC_ESTIMATE_DISCOUNT * 100)}% est. off cash · saves ~${fmtUSD(total - dvc.dollars)} · click UCT-style link below for exact`;
    const label = dvc.exact ? "DVC equivalent (Dave's, exact)" : "DVC equivalent (~40% est.)";
    dvcBlock = `<div class="dvc-summary">
      <div class="dvc-label">${label}</div>
      <div class="dvc-amount">${fmtUSD(dvc.dollars)}</div>
      <div class="dvc-meta">${meta}</div>
    </div>`;
  }

  summary.className = "summary";
  summary.innerHTML = `
    <div>
      <div class="big">${fmtUSD(total)}</div>
      <div class="range">${nights.length} night${nights.length === 1 ? "" : "s"} · exact rack rate total</div>
    </div>
    ${dvcBlock}
    <div class="meta">${resort.name} ${tierTag(resort.tier)}<br>${room.name}</div>
  `;

  breakdown.innerHTML = `
    <table>
      <thead><tr><th>Night</th><th>Season</th><th>Day-of-week tier</th><th class="right">Rate</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;

  const missingNote = missing > 0 ? `${missing} night(s) had no rate data.` : "";
  footnote.innerHTML = `${missingNote}
    <div class="uct-compare-row">
      <span>Want a real quote for this stay?</span>
      <a href="https://www.undercovertourist.com/orlando/walt-disney-world-resort/" target="_blank" rel="noopener">Compare hotel pricing on Undercover Tourist ↗</a>
      ${resort.tier === "dvc" ? '<a href="https://dvcrequest.com/" target="_blank" rel="noopener">Get DVC rental quote on David\'s ↗</a>' : ""}
    </div>`;

  TRIP.hotel = {
    cash: total,
    dvc: dvc ? dvc.dollars : 0,
    label: `${resort.name}, ${room.name} · ${nights.length} night${nights.length === 1 ? "" : "s"} (${checkIn} → ${checkOut})`,
    checkIn,
  };

  // Auto-sync ticket days to the hotel night count (capped at 10 — Disney's longest ticket).
  const ticketDaysEl = $("ticketDays");
  const daysHint = $("ticketDaysHint");
  if (ticketDaysEl && nights.length >= 1) {
    const clamped = Math.min(Math.max(nights.length, 1), 10);
    if (parseInt(ticketDaysEl.value, 10) !== clamped) {
      ticketDaysEl.value = clamped;
    }
    if (daysHint) {
      daysHint.textContent = nights.length > 10
        ? `Synced to your hotel: ${nights.length} nights (capped at 10 — Disney's longest ticket)`
        : `Synced to your hotel: ${nights.length} nights`;
    }
  }

  if (typeof recalcTickets === "function") recalcTickets();
  recalcTripTotal();
}

// Returns the tier index (0-5) for a given ISO date, based on the hand-built 2026 calendar.
// Tier 0 = lowest published price, Tier 5 = highest.
function getTicketTier(iso) {
  const cal = window.TICKETS && window.TICKETS.tierCalendar;
  if (!cal) return 0;
  for (const [a, b, tier] of cal) {
    if (iso >= a && iso <= b) return tier;
  }
  return 0;
}

// Linearly interpolate between low and high using the tier multiplier (0..1).
function interpolateTierPrice(cell, tierIdx, isAdult) {
  const mults = window.TICKETS.tierMultipliers;
  const m = mults[tierIdx] != null ? mults[tierIdx] : 0;
  const lowKey = isAdult ? "adultLow" : "childLow";
  const highKey = isAdult ? "adultHigh" : "childHigh";
  return cell[lowKey] + m * (cell[highKey] - cell[lowKey]);
}

function groupBy(arr, fn) {
  const map = new Map();
  for (const item of arr) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function buildDiningRow(r) {
  const row = document.createElement("div");
  row.className = "dining-row";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = `r-${r.id}`;
  cb.addEventListener("change", () => {
    row.classList.toggle("checked", cb.checked);
    recalcDining();
  });

  const label = document.createElement("label");
  label.htmlFor = cb.id;
  label.innerHTML = `<span class="dining-name">${r.name}</span><span class="dining-area">${r.area}</span><span class="dining-type">${r.type}</span>`;

  const sel = document.createElement("select");
  sel.id = `m-${r.id}`;
  for (const mealKey of Object.keys(r.meals)) {
    const opt = document.createElement("option");
    opt.value = mealKey;
    const m = r.meals[mealKey];
    opt.textContent = `${cap(mealKey)} — $${m.adult} / $${m.child}`;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", recalcDining);

  const totalCell = document.createElement("span");
  totalCell.id = `t-${r.id}`;
  totalCell.className = "dining-rowTotal muted";
  totalCell.textContent = "—";

  row.append(cb, label, sel, totalCell);
  return row;
}

function populateDiningList() {
  const list = $("diningList");
  list.innerHTML = "";
  const grouped = groupBy(window.DINING.restaurants, (r) => r.area);
  for (const [area, items] of grouped) {
    const heading = document.createElement("div");
    heading.className = "area-heading";
    heading.textContent = area;
    list.appendChild(heading);
    for (const r of items) list.appendChild(buildDiningRow(r));
  }
}

const TAX_RATE = 0.065;
const GRATUITY_RATE = 0.20;
const UCT_DISCOUNT = 0.04;
// DVC heuristic: when a DVC resort doesn't have a per-room points chart loaded,
// estimate the rental-via-Dave's cost as cash × (1 - 0.40). Real savings range 30-50%
// depending on resort tier and dates; 40% is the midpoint used by industry guides.
const DVC_ESTIMATE_DISCOUNT = 0.40;

// Module-level state shared with the Trip Total panel.
const TRIP = {
  hotel: { cash: 0, dvc: 0, label: null, checkIn: null },
  tickets: { total: 0, label: null },
  dining: { total: 0, count: 0, label: null },
};

function recalcTripTotal() {
  if (!$("tripGrandAmount")) return;

  // Hotel line
  const hotelChoice = $("tripHotelChoice").value;
  let hotelAmount = 0, hotelDetail = '<span class="empty-line">— pick resort, room, and dates above</span>';
  if (TRIP.hotel.label) {
    if (hotelChoice === "cash") {
      hotelAmount = TRIP.hotel.cash;
      hotelDetail = `${TRIP.hotel.label} (cash rack rate)`;
    } else if (hotelChoice === "dvc") {
      if (TRIP.hotel.dvc > 0) {
        hotelAmount = TRIP.hotel.dvc;
        hotelDetail = `${TRIP.hotel.label} (DVC equivalent)`;
      } else {
        hotelDetail = `<span class="empty-line">— current room isn't DVC-bookable; switch to cash or pick a DVC resort</span>`;
      }
    } else {
      hotelDetail = `<span class="empty-line">— hotel excluded from total</span>`;
    }
  }
  $("tripHotelDetail").innerHTML = hotelDetail;
  $("tripHotelAmount").textContent = fmtUSDc(hotelAmount);

  // Tickets line — sourced directly from the ticket panel selection
  const ticketAmount = TRIP.tickets.total || 0;
  const ticketDetail = TRIP.tickets.label || '<span class="empty-line">— pick days &amp; party size above</span>';
  $("tripTicketDetail").innerHTML = ticketDetail;
  $("tripTicketAmount").textContent = fmtUSDc(ticketAmount);

  // Dining line
  let diningAmount = 0, diningDetail = '<span class="empty-line">— check restaurants above</span>';
  if (TRIP.dining.count > 0) {
    diningAmount = TRIP.dining.total;
    diningDetail = TRIP.dining.label;
  }
  $("tripDiningDetail").innerHTML = diningDetail;
  $("tripDiningAmount").textContent = fmtUSDc(diningAmount);

  // Grand total
  $("tripGrandAmount").textContent = fmtUSDc(hotelAmount + ticketAmount + diningAmount);
}

function recalcTickets() {
  const days = parseInt($("ticketDays").value, 10);
  const adults = Math.max(0, parseInt($("adults").value, 10) || 0);
  const children = Math.max(0, parseInt($("children").value, 10) || 0);

  // Tier is derived from the hotel check-in date — no manual override.
  const checkIn = TRIP.hotel.checkIn;
  const tierIdx = checkIn ? getTicketTier(checkIn) : 0;
  const tierName = window.TICKETS.tierNames[tierIdx] || `Tier ${tierIdx}`;

  const tierStatus = $("ticketTierStatus");
  if (tierStatus) {
    tierStatus.textContent = checkIn
      ? `${tierName} (Tier ${tierIdx + 1} of 6) — auto-detected from hotel check-in ${checkIn}`
      : `${tierName} (Tier ${tierIdx + 1} of 6) — no hotel check-in selected yet, defaulting to lowest`;
  }

  const row = window.TICKETS.prices.find((p) => p.days === days);
  if (!row) return;

  const partyAt = (cell) =>
    adults * interpolateTierPrice(cell, tierIdx, true) +
    children * interpolateTierPrice(cell, tierIdx, false);

  const baseTotal = partyAt(row.base);
  const hopperTotal = partyAt(row.hopper);
  const hopperPlusTotal = partyAt(row.hopperPlus);

  $("priceBase").textContent = fmtUSDc(baseTotal);
  $("priceHopper").textContent = fmtUSDc(hopperTotal);
  $("priceHopperPlus").textContent = fmtUSDc(hopperPlusTotal);
  $("deltaHopper").textContent = `+${fmtUSDc(hopperTotal - baseTotal)} vs Base`;
  $("deltaHopperPlus").textContent = `+${fmtUSDc(hopperPlusTotal - baseTotal)} vs Base`;

  // UCT estimate (typical ~4% off Disney direct via authorized reseller)
  const uctBaseEst = baseTotal * (1 - UCT_DISCOUNT);
  const uctHopperEst = hopperTotal * (1 - UCT_DISCOUNT);
  const uctHopperPlusEst = hopperPlusTotal * (1 - UCT_DISCOUNT);
  $("uctBase").innerHTML = `≈ ${fmtUSDc(uctBaseEst)} via UCT &mdash; save ~${fmtUSDc(baseTotal - uctBaseEst)}`;
  $("uctHopper").innerHTML = `≈ ${fmtUSDc(uctHopperEst)} via UCT &mdash; save ~${fmtUSDc(hopperTotal - uctHopperEst)}`;
  $("uctHopperPlus").innerHTML = `≈ ${fmtUSDc(uctHopperPlusEst)} via UCT &mdash; save ~${fmtUSDc(hopperPlusTotal - uctHopperPlusEst)}`;

  const selectedType = document.querySelector('input[name="ticketType"]:checked')?.value || "base";
  const totals = { base: baseTotal, hopper: hopperTotal, hopperPlus: hopperPlusTotal };
  const typeLabels = { base: "Base", hopper: "+ Park Hopper", hopperPlus: "+ Park Hopper Plus" };
  TRIP.tickets = {
    total: totals[selectedType],
    label: `${days}-day ${typeLabels[selectedType]}, ${tierName} tier (${adults}A + ${children}C)`,
  };
  recalcTripTotal();
}

function fmtUSDc(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function recalcDining() {
  const adults = Math.max(0, parseInt($("adults").value, 10) || 0);
  const children = Math.max(0, parseInt($("children").value, 10) || 0);
  const includeTax = $("includeTax").checked;
  const includeGratuity = $("includeGratuity").checked;
  const taxMult = includeTax ? TAX_RATE : 0;
  const gratMult = includeGratuity ? GRATUITY_RATE : 0;
  const allInMult = 1 + taxMult + gratMult;
  let subtotal = 0, adultsCost = 0, childrenCost = 0, count = 0;

  for (const r of window.DINING.restaurants) {
    const cb = $(`r-${r.id}`);
    const sel = $(`m-${r.id}`);
    const totalCell = $(`t-${r.id}`);
    if (cb && cb.checked) {
      const meal = r.meals[sel.value];
      const cost = adults * meal.adult + children * meal.child;
      const rowAllIn = cost * allInMult;
      subtotal += cost;
      adultsCost += adults * meal.adult;
      childrenCost += children * meal.child;
      count++;
      totalCell.textContent = fmtUSD(rowAllIn);
      totalCell.classList.remove("muted");
    } else if (totalCell) {
      totalCell.textContent = "—";
      totalCell.classList.add("muted");
    }
  }

  const out = $("diningTotal");
  if (count === 0) {
    out.innerHTML = '<div class="dining-total"><div class="label">No reservations selected — check a restaurant above to see the total.</div><div class="amount">$0</div></div>';
    TRIP.dining = { total: 0, count: 0, label: null };
    recalcTripTotal();
    return;
  }

  const taxAmt = subtotal * taxMult;
  const gratuityAmt = subtotal * gratMult;
  const grandTotal = subtotal + taxAmt + gratuityAmt;

  // Build ledger rows
  const ledgerRows = [
    `<div class="name">Subtotal (${count} res. · ${adults}A + ${children}C)</div><div class="val">${fmtUSD(subtotal)}</div>`,
  ];
  if (includeTax) {
    ledgerRows.push(`<div class="name">+ Sales tax (${(TAX_RATE * 100).toFixed(1)}%)</div><div class="val">${fmtUSD(taxAmt)}</div>`);
  }
  if (includeGratuity) {
    ledgerRows.push(`<div class="name">+ Gratuity (${(GRATUITY_RATE * 100).toFixed(0)}%)</div><div class="val">${fmtUSD(gratuityAmt)}</div>`);
  }

  const headLabel = (includeTax || includeGratuity)
    ? `Estimated total (incl. ${[includeTax && "tax", includeGratuity && "tip"].filter(Boolean).join(" & ")})`
    : `Subtotal (excludes tax & gratuity)`;

  out.innerHTML = `
    <div class="dining-total">
      <div>
        <div class="label">${headLabel}</div>
        <div class="breakdown">Adults: ${fmtUSD(adultsCost)} &middot; Children: ${fmtUSD(childrenCost)}</div>
        <div class="ledger">${ledgerRows.join("")}</div>
      </div>
      <div class="amount">${fmtUSD(grandTotal)}</div>
    </div>
  `;

  const extras = [includeTax && "tax", includeGratuity && "20% tip"].filter(Boolean);
  const extrasNote = extras.length ? ` (incl. ${extras.join(" & ")})` : " (excl. tax & tip)";
  TRIP.dining = {
    total: grandTotal,
    count,
    label: `${count} reservation${count === 1 ? "" : "s"} · ${adults}A + ${children}C${extrasNote}`,
  };
  recalcTripTotal();
}

function init() {
  if (!window.RATES) {
    document.body.innerHTML = `<div class="container"><h1>Could not load rates.js</h1><p>The rates data file appears to be missing. Make sure rates.js is in the same folder as index.html.</p></div>`;
    return;
  }
  DATA = window.RATES;

  populateResorts();
  populateRoomTypes();
  populateSeasonFilter();
  populateCheapestResort();
  recalc();
  findCheapest();

  $("resort").addEventListener("change", () => {
    populateRoomTypes();
    recalc();
  });
  $("roomType").addEventListener("change", recalc);
  $("checkIn").addEventListener("change", recalc);
  $("checkOut").addEventListener("change", recalc);

  $("cheapestTier").addEventListener("change", () => { populateCheapestResort(); findCheapest(); });
  $("cheapestResort").addEventListener("change", findCheapest);
  $("nights").addEventListener("input", findCheapest);
  $("seasonFilter").addEventListener("change", findCheapest);
  $("topN").addEventListener("change", findCheapest);

  if (window.TICKETS) {
    recalcTickets();
    $("ticketDays").addEventListener("change", recalcTickets);
    for (const r of document.querySelectorAll('input[name="ticketType"]')) {
      r.addEventListener("change", recalcTickets);
    }
  }

  $("tripHotelChoice").addEventListener("change", recalcTripTotal);
  recalcTripTotal();

  if (window.DINING) {
    populateDiningList();
    recalcDining();
    $("includeTax").addEventListener("change", recalcDining);
    $("includeGratuity").addEventListener("change", recalcDining);
  }

  // Shared party-size inputs (Trip basics) drive both tickets and dining.
  const onPartyChange = () => {
    if (typeof recalcTickets === "function") recalcTickets();
    if (typeof recalcDining === "function") recalcDining();
  };
  $("adults").addEventListener("input", onPartyChange);
  $("children").addEventListener("input", onPartyChange);
}

init();

// Build and download a single-file shareable copy of the app.
// Strategy: try dynamic bundling (works when served via http/https or browsers
// that allow local file:// fetches). If that fails, fall back to downloading
// the pre-built static bundle. If both fail, show clear instructions.
async function downloadShare() {
  const triggerDownload = (content, filename) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  // Try 1: dynamic build — needs to fetch app.js source
  try {
    const res = await fetch("app.js");
    if (res.ok) {
      const appSrc = await res.text();
      let html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
      html = html.replace(
        /<script\s+src="rates\.js[^"]*"><\/script>/g,
        "<script>window.RATES = " + JSON.stringify(window.RATES) + ";</script>"
      );
      html = html.replace(
        /<script\s+src="dining\.js[^"]*"><\/script>/g,
        "<script>window.DINING = " + JSON.stringify(window.DINING) + ";</script>"
      );
      html = html.replace(
        /<script\s+src="tickets\.js[^"]*"><\/script>/g,
        "<script>window.TICKETS = " + JSON.stringify(window.TICKETS) + ";</script>"
      );
      html = html.replace(
        /<script\s+src="app\.js[^"]*"><\/script>/g,
        "<script>\n" + appSrc + "\n</script>"
      );
      triggerDownload(html, "wdw-trip-planner.html");
      return;
    }
  } catch (e) {
    // fetch blocked or app.js not reachable — fall through
  }

  // Try 2: download the pre-built static bundle
  try {
    const res = await fetch("wdw-trip-planner-share.html");
    if (res.ok) {
      const blob = await res.blob();
      triggerDownload(blob, "wdw-trip-planner.html");
      return;
    }
  } catch (e) {
    // not available either
  }

  // Both failed — give the user a clear path forward
  alert(
    "Couldn't build a share copy automatically.\n\n" +
    "Your browser is blocking fetches from this local file. To create the share copy:\n\n" +
    "1. Open Command Prompt or PowerShell in the project folder\n" +
    "   (C:\\Users\\slrog\\projects\\wdw-trip-planner)\n" +
    "2. Run: node build-share.js\n" +
    "3. The file 'wdw-trip-planner-share.html' will appear in the folder\n" +
    "4. Email or share that file with anyone — they double-click to use it\n\n" +
    "Re-run step 2 whenever you update the app to refresh the share copy."
  );
}
