const UTILS = [
  { key: 'electricity', name: 'Electricity', unit: 'kWh' },
  { key: 'water', name: 'Water', unit: 'm³' },
  { key: 'gas', name: 'Gas', unit: 'm³' },
];
const MAX_EMAILS = 3;
const STORE_KEY = 'utilitypulse.v1';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

const view = document.getElementById('view');
const ui = { tab: 'home', utility: 'electricity', period: 'months', message: '' };
let state = load();

// ---------- storage ----------

function defaults() {
  return {
    readings: [], // { id, utility, date: 'YYYY-MM-DD', value, reset }
    settings: {
      emails: [],
      units: Object.fromEntries(UTILS.map((u) => [u.key, u.unit])),
    },
  };
}

function normalise(data) {
  const base = defaults();
  if (!data || !Array.isArray(data.readings)) return base;
  base.readings = data.readings
    .filter((r) => UTILS.some((u) => u.key === r.utility) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value))
    .map((r) => ({ id: `${r.utility}-${r.date}`, utility: r.utility, date: r.date, value: r.value, reset: !!r.reset }));
  const s = data.settings || {};
  if (Array.isArray(s.emails)) base.settings.emails = s.emails.filter((e) => EMAIL_RE.test(e)).slice(0, MAX_EMAILS);
  for (const u of UTILS) if (s.units && s.units[u.key]) base.settings.units[u.key] = String(s.units[u.key]);
  return base;
}

function load() {
  try {
    return normalise(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch {
    return defaults();
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const unit = (key) => state.settings.units[key];
const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 1 });
const monthLabel = (key) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
const dateLabel = (d) => `${Number(d.slice(8))} ${monthLabel(d.slice(0, 7))}`;

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function prevMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const perDay = (p) => (p && p.days ? p.usage / p.days : 0);

// Change in average daily usage between two periods, as text like "▲ 12%".
function change(cur, prev) {
  if (!cur || !prev || !perDay(prev)) return '';
  const pct = Math.round((perDay(cur) / perDay(prev) - 1) * 100);
  return pct === 0 ? '=' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
}

function trend(cur, prev, prevLabel) {
  const c = change(cur, prev);
  return c && `${c === '=' ? 'same as' : `${c} vs`} ${prevLabel}`;
}

function alerts() {
  const out = [];
  for (const u of UTILS) {
    const last = Calc.intervals(state.readings, u.key).at(-1);
    if (last && last.anomaly) {
      out.push(`${u.name}: ${fmt(last.rate)} ${unit(u.key)}/day between ${dateLabel(last.from)} and ${dateLabel(last.to)} — ${last.anomaly.toFixed(1)}× your usual rate.`);
    }
  }
  return out;
}

// ---------- views ----------

function utilityPicker() {
  return `<div class="seg">${UTILS.map((u) =>
    `<button type="button" data-utility="${u.key}" aria-pressed="${ui.utility === u.key}">${u.name}</button>`).join('')}</div>`;
}

function homeView() {
  const month = today().slice(0, 7);
  const fields = UTILS.map((u) => {
    const last = Calc.sorted(state.readings, u.key).at(-1);
    const hint = last ? `Last: ${fmt(last.value)} on ${dateLabel(last.date)}` : 'No readings yet';
    return `<div class="field">
      <label for="in-${u.key}"><span class="name"><i class="dot" style="background:var(--c-${u.key})"></i>${u.name}</span>${hint}</label>
      <div class="with-unit"><input id="in-${u.key}" name="${u.key}" inputmode="decimal" autocomplete="off" placeholder="Meter reading"><span>${esc(unit(u.key))}</span></div>
    </div>`;
  }).join('');

  const tiles = UTILS.map((u) => {
    const { months } = Calc.totals(state.readings, u.key);
    const cur = months[month];
    const prevKey = prevMonth(month);
    return `<div class="tile">
      <div><i class="dot" style="background:var(--c-${u.key})"></i>${u.name}</div>
      <div class="right">${cur
        ? `<span class="big">${fmt(cur.usage)}</span> ${esc(unit(u.key))}
           <div class="muted">${fmt(perDay(cur))}/day ${trend(cur, months[prevKey], monthLabel(prevKey))}</div>`
        : '<span class="muted">No usage recorded yet</span>'}</div>
    </div>`;
  }).join('');

  const warn = alerts().map((a) => `<p class="alert">⚠ Unusually high — ${esc(a)}</p>`).join('');

  return `${warn}
    <form class="card" id="reading-form">
      <h2>Enter meter readings</h2>
      <div class="field"><label for="in-date">Date</label><input id="in-date" name="date" type="date" value="${today()}" max="${today()}" required></div>
      ${fields}
      <button class="btn block">Save readings</button>
      <p class="muted" role="status" style="margin-top:10px">${esc(ui.message) || 'Fill in any of the three; leave the others blank.'}</p>
    </form>
    <section class="card">
      <h2>${monthLabel(month)} so far</h2>
      ${tiles}
    </section>`;
}

function periodRows(utility) {
  const t = Calc.totals(state.readings, utility)[ui.period];
  return Object.keys(t).sort().map((key) => {
    const full = ui.period === 'months' ? Calc.daysInMonth(key) : Calc.daysInYear(key);
    return { key, label: ui.period === 'months' ? monthLabel(key) : key, ...t[key], full, partial: t[key].days < full };
  });
}

function barChart(rows, utility) {
  const W = 340, H = 190, L = 34, R = 6, T = 8, B = 30;
  const top = Math.max(...rows.map((r) => r.usage), 0) || 1;
  const step = 10 ** Math.floor(Math.log10(top));
  const max = [1, 2, 2.5, 5, 10].map((k) => k * step).find((v) => v >= top);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const slot = (W - L - R) / rows.length;
  const bw = Math.min(28, slot - 2); // keeps at least a 2px gap between neighbouring bars

  const grid = [0, max / 2, max].map((v) =>
    `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');

  const bars = rows.map((r, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    const h = H - B - y(r.usage);
    const rad = Math.min(4, h, bw / 2);
    const path = `M${x},${H - B}V${y(r.usage) + rad}q0,${-rad} ${rad},${-rad}h${bw - 2 * rad}q${rad},0 ${rad},${rad}V${H - B}z`;
    const name = ui.period === 'months' ? MONTHS[Number(r.key.slice(5)) - 1] : r.key;
    const year = ui.period === 'months' && (i === 0 || r.key.endsWith('-01')) ? r.key.slice(0, 4) : '';
    return `<g data-bar="${i}">
      ${h > 0 ? `<path class="bar${r.partial ? ' partial' : ''}" d="${path}" fill="var(--c-${utility})"/>` : ''}
      <text x="${x + bw / 2}" y="${H - B + 12}" text-anchor="middle">${name}</text>
      <text x="${x + bw / 2}" y="${H - B + 24}" text-anchor="middle">${year}</text>
      <rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T}"/>
    </g>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Usage per period; the same figures are in the table below">${grid}${bars}</svg>`;
}

let chartRows = [];

function statsView() {
  const u = UTILS.find((x) => x.key === ui.utility);
  const rows = periodRows(u.key);
  const periodPicker = `<div class="seg" style="margin-top:8px">
    <button type="button" data-period="months" aria-pressed="${ui.period === 'months'}">Monthly</button>
    <button type="button" data-period="years" aria-pressed="${ui.period === 'years'}">Yearly</button></div>`;

  if (!rows.length) {
    return `<section class="card">${utilityPicker()}${periodPicker}
      <p class="muted" style="margin-top:16px">Usage appears once ${u.name.toLowerCase()} has at least two readings.</p></section>`;
  }

  // Chart: the most recent 12 months (gaps filled with empty months) or every year.
  if (ui.period === 'months') {
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    let key = rows.at(-1).key;
    chartRows = [];
    for (let i = 0; i < 12; i++, key = prevMonth(key)) {
      chartRows.unshift(byKey[key] || { key, label: monthLabel(key), usage: 0, days: 0, full: Calc.daysInMonth(key), partial: false });
    }
  } else {
    chartRows = rows;
  }

  const table = [...rows].reverse().map((r, i, all) =>
    `<tr><td>${r.label}</td><td>${fmt(r.usage)}</td><td>${fmt(perDay(r))}</td>
      <td>${r.partial ? `${r.days} of ${r.full}` : r.days}</td>
      <td>${change(r, all[i + 1])}</td></tr>`).join('');

  return `<section class="card">
      ${utilityPicker()}${periodPicker}
      <div class="readout" id="readout"></div>
      ${barChart(chartRows, u.key)}
      <p class="muted">Tap a bar for its figures. Faded bars are periods only partly covered by readings.</p>
    </section>
    <section class="card">
      <table>
        <tr><th>${ui.period === 'months' ? 'Month' : 'Year'}</th><th>${esc(unit(u.key))}</th><th>Per day</th><th>Days</th><th>Per day change</th></tr>
        ${table}
      </table>
    </section>
    <button type="button" class="btn block" data-action="email">Email report</button>`;
}

function selectBar(i) {
  const r = chartRows[i];
  if (!r) return;
  view.querySelectorAll('[data-bar]').forEach((g) => g.classList.toggle('sel', Number(g.dataset.bar) === i));
  document.getElementById('readout').innerHTML =
    `<span><b>${fmt(r.usage)}</b> ${esc(unit(ui.utility))}</span>
     <span class="muted">${r.label} · ${r.days ? `${fmt(perDay(r))}/day${r.partial ? ` · ${r.days} of ${r.full} days` : ''}` : 'no readings'}</span>`;
}

function historyView() {
  const u = UTILS.find((x) => x.key === ui.utility);
  const byId = Object.fromEntries(Calc.intervals(state.readings, u.key).map((iv) => [iv.id, iv]));
  const rows = Calc.sorted(state.readings, u.key).reverse().map((r) => {
    const iv = byId[r.id];
    return `<tr><td>${dateLabel(r.date)}${r.reset ? '<div class="muted">new meter</div>' : ''}</td>
      <td>${fmt(r.value)}</td>
      <td>${iv ? `+${fmt(iv.usage)}` : '–'}</td>
      <td>${iv ? `${fmt(iv.rate)}${iv.anomaly ? ' ⚠' : ''}` : '–'}</td>
      <td><button type="button" class="del" data-delete="${r.id}" aria-label="Delete reading of ${dateLabel(r.date)}">✕</button></td></tr>`;
  }).join('');

  return `<section class="card">
    ${utilityPicker()}
    ${rows
      ? `<table style="margin-top:12px"><tr><th>Date</th><th>Reading</th><th>Used</th><th>Per day</th><th></th></tr>${rows}</table>
         <p class="muted" style="margin-top:8px">⚠ marks a daily rate more than 1.5× the recent norm. To correct a reading, save it again for the same date.</p>`
      : '<p class="muted" style="margin-top:16px">No readings yet.</p>'}
  </section>`;
}

function settingsView() {
  const emails = Array.from({ length: MAX_EMAILS }, (_, i) =>
    `<div class="field"><label for="em-${i}">Email ${i + 1}</label>
     <input id="em-${i}" name="email" type="email" autocomplete="off" value="${esc(state.settings.emails[i] || '')}"></div>`).join('');
  const units = UTILS.map((u) =>
    `<div class="field"><label for="un-${u.key}">${u.name} unit</label>
     <input id="un-${u.key}" name="unit-${u.key}" maxlength="8" required value="${esc(unit(u.key))}"></div>`).join('');

  return `<form class="card" id="settings-form">
      <h2>Report recipients</h2>
      ${emails}
      <h2>Units</h2>
      ${units}
      <button class="btn block">Save settings</button>
      <p class="muted" role="status" style="margin-top:10px">${esc(ui.message)}</p>
    </form>
    <section class="card">
      <h2>Backup</h2>
      <p class="muted" style="margin-bottom:12px">Readings are stored only on this device. Export a backup now and then, and before changing phone or clearing browser data.</p>
      <div class="row">
        <button type="button" class="btn plain" data-action="export">Export backup</button>
        <button type="button" class="btn plain" data-action="import">Import backup</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </section>`;
}

const VIEWS = { home: homeView, stats: statsView, history: historyView, settings: settingsView };

function render() {
  view.innerHTML = VIEWS[ui.tab]();
  ui.message = '';
  document.querySelectorAll('[data-tab]').forEach((b) => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (ui.tab === 'stats' && document.getElementById('readout')) selectBar(chartRows.length - 1);
}

// ---------- actions ----------

function saveReadings(form) {
  const date = form.elements.date.value;
  const fail = (msg) => {
    form.querySelector('[role=status]').innerHTML = `<span class="error">${esc(msg)}</span>`;
  };
  if (!date || date > today()) return fail('Pick a date that is not in the future.');

  const pending = [];
  for (const u of UTILS) {
    const raw = form.elements[u.key].value.trim();
    if (!raw) continue;
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) return fail(`${u.name}: "${raw}" is not a valid reading.`);

    const others = Calc.sorted(state.readings, u.key).filter((r) => r.date !== date);
    const prev = others.filter((r) => r.date < date).at(-1);
    const next = others.find((r) => r.date > date);
    let reset = false;
    if (prev && value < prev.value) {
      // A later reading that carries on from the old one means this is a typo, not a new meter.
      if (next && !next.reset && next.value >= prev.value) {
        return fail(`${u.name}: ${value} is lower than the earlier reading (${prev.value} on ${dateLabel(prev.date)}).`);
      }
      const ok = confirm(`${u.name}: ${value} is lower than the previous reading (${prev.value} on ${dateLabel(prev.date)}).\n\n` +
        'Was the meter replaced or reset?\nOK – save it as the start of a new meter.\nCancel – go back and correct it.');
      if (!ok) return;
      reset = true;
    }
    if (next && !next.reset && value > next.value) {
      return fail(`${u.name}: ${value} is higher than the later reading (${next.value} on ${dateLabel(next.date)}).`);
    }
    pending.push({ id: `${u.key}-${date}`, utility: u.key, date, value, reset });
  }
  if (!pending.length) return fail('Enter at least one reading.');

  const ids = new Set(pending.map((r) => r.id));
  state.readings = state.readings.filter((r) => !ids.has(r.id)).concat(pending);
  save();
  ui.message = `Saved ${pending.length} reading${pending.length > 1 ? 's' : ''} for ${dateLabel(date)}.`;
  render();
}

function saveSettings(form) {
  const emails = [...form.querySelectorAll('[name=email]')].map((i) => i.value.trim()).filter(Boolean);
  const bad = emails.find((e) => !EMAIL_RE.test(e));
  if (bad) {
    form.querySelector('[role=status]').innerHTML = `<span class="error">"${esc(bad)}" is not a valid email address.</span>`;
    return;
  }
  state.settings.emails = emails;
  for (const u of UTILS) state.settings.units[u.key] = form.elements[`unit-${u.key}`].value.trim() || u.unit;
  save();
  ui.message = 'Settings saved.';
  render();
}

function buildReport() {
  const now = today();
  const month = now.slice(0, 7);
  const year = now.slice(0, 4);
  const lines = [`UtilityPulse report – ${dateLabel(now)}`, ''];

  for (const u of UTILS) {
    const un = unit(u.key);
    const last = Calc.sorted(state.readings, u.key).at(-1);
    const { months, years } = Calc.totals(state.readings, u.key);
    const line = (label, p) => `${label}: ${p ? `${fmt(p.usage)} ${un} (${fmt(perDay(p))}/day over ${p.days} days)` : 'no data'}`;

    lines.push(`${u.name.toUpperCase()} (${un})`);
    if (!last) {
      lines.push('No readings yet.', '');
      continue;
    }
    lines.push(`Latest reading: ${fmt(last.value)} on ${dateLabel(last.date)}`);
    lines.push(line(`This month (${monthLabel(month)})`, months[month]));
    lines.push(line(`Last month (${monthLabel(prevMonth(month))})`, months[prevMonth(month)]));
    lines.push(line(`This year (${year})`, years[year]));
    lines.push(line(`Last year (${year - 1})`, years[year - 1]));
    const recent = Object.keys(months).sort().slice(-12);
    if (recent.length) {
      lines.push('Monthly usage:');
      for (const key of recent) lines.push(`  ${monthLabel(key)}: ${fmt(months[key].usage)} ${un}`);
    }
    lines.push('');
  }

  const warn = alerts();
  if (warn.length) lines.push('UNUSUALLY HIGH USAGE', ...warn, '');
  return lines.join('\r\n');
}

function emailReport() {
  const to = state.settings.emails;
  if (!to.length) {
    ui.tab = 'settings';
    ui.message = 'Add at least one email address first, then tap Email report.';
    return render();
  }
  const subject = `Utility usage report – ${dateLabel(today())}`;
  location.href = `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildReport())}`;
}

function exportBackup() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = `utilitypulse-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.readings)) return alert('That file is not a UtilityPulse backup.');
  const next = normalise(data);
  if (!confirm(`Replace everything on this device with the backup (${next.readings.length} readings)?`)) return;
  state = next;
  save();
  ui.message = 'Backup imported.';
  render();
}

// ---------- events ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-utility],[data-period],[data-action],[data-delete],[data-bar]');
  if (!t) return;
  const d = t.dataset;
  if (d.bar !== undefined) return selectBar(Number(d.bar));
  if (d.action === 'email') return emailReport();
  if (d.action === 'export') return exportBackup();
  if (d.action === 'import') return document.getElementById('import-file').click();
  if (d.delete) {
    const r = state.readings.find((x) => x.id === d.delete);
    if (!r || !confirm(`Delete the reading of ${fmt(r.value)} on ${dateLabel(r.date)}?`)) return;
    state.readings = state.readings.filter((x) => x !== r);
    save();
  }
  if (d.tab) ui.tab = d.tab;
  if (d.utility) ui.utility = d.utility;
  if (d.period) ui.period = d.period;
  render();
});

view.addEventListener('pointerover', (e) => {
  const g = e.target.closest('[data-bar]');
  if (g) selectBar(Number(g.dataset.bar));
});

view.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'reading-form') saveReadings(e.target);
  if (e.target.id === 'settings-form') saveSettings(e.target);
});

view.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

render();
