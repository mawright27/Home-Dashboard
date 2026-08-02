/* ══════════════════════════════════════════════════════════════
   app.js — rendering, interaction, and the boot sequence

   Two modes, same code:
     kiosk       no cursor, no controls, nothing clickable
     interactive mouse + keyboard editing of everything

   Mode is auto-detected from the pointer, and can be forced with
   ?mode=edit or ?mode=kiosk, or toggled with the K key.
   ══════════════════════════════════════════════════════════════ */

import { DEFAULTS, SENSORS, usingFirebase, CALENDAR, GROCERY } from './config.js';
import {
  auth, onAuth, initAuth, makeStore, signInWithGoogle, signOutNow,
  startPairing, claimPairing, watchHousehold, listDevices, unpairDevice,
  fetchWeather, fallbackWeather, fetchSheetGrocery, geocodePlace,
  createInvite, listInvites, revokeInvite, listMembers, removeMember,
  leaveHousehold, setPendingJoin, householdName
} from './store.js';
import {
  calendarConfigured, calendarState, syncCalendar, disconnectCalendar
} from './calendar.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

const ui = {
  store: null,
  data: { events: [], grocery: [], sensors: {}, settings: { ...DEFAULTS } },
  weather: null,
  lastOk: null,
  interactive: false,
  readonly: false,
  timers: []
};


/* ══════════════════════════════════════════════════════════════
   Small helpers
   ══════════════════════════════════════════════════════════════ */

/* Which Google calendars are showing, and in what color. Both are read
   at render time rather than baked into the mirror, so a toggle takes
   effect immediately instead of waiting for the next sync. */
function calendarPrefs(){ return ui.data.settings?.calendars || {}; }

function calendarOn(key){
  const pref = calendarPrefs()[key];
  if (pref) return pref.on !== false;
  // Nothing chosen yet: show the primary calendar, leave the rest off so a
  // holidays feed can't bury a real schedule on first run.
  return Boolean(ui.data.meta?.calendars?.[key]?.primary);
}

const calendarTone = (key, fallback) =>
  calendarPrefs()[key]?.tone || fallback || 'cool';

// Manual entries plus whatever the last Google Calendar sync mirrored.
const allEvents = () => [
  ...(ui.data.events || []),
  ...(ui.data.gcal || [])
    .filter(e => !e.cal || calendarOn(e.cal))
    .map(e => e.cal ? { ...e, tone: calendarTone(e.cal, e.tone) } : e)
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };

function gridStart(today, weekStartsOn){
  const s = startOfDay(today);
  return addDays(s, -((s.getDay() - weekStartsOn + 7) % 7));
}

function fmtTime12(h, m){
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2,'0')} ${ap}`;
}

function shortTime(hhmm){
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  const suf = h >= 12 ? 'p' : 'a';
  return m === 0 ? `${hh}${suf}` : `${hh}:${String(m).padStart(2,'0')}${suf}`;
}

function ago(ts){
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

let toastTimer;
function toast(msg, bad = false){
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('toast--bad', bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}


/* ══════════════════════════════════════════════════════════════
   Weather icons
   ══════════════════════════════════════════════════════════════ */

const ICONS = {
  clear: `<svg viewBox="0 0 48 48" fill="none" stroke="#FFB020" stroke-width="2.6" stroke-linecap="round">
    <circle cx="24" cy="24" r="8.5" fill="rgba(255,176,32,.18)"/>
    <path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M36.7 11.3l-3.5 3.5M14.8 33.2l-3.5 3.5"/>
  </svg>`,
  partly: `<svg viewBox="0 0 48 48" fill="none" stroke-width="2.6" stroke-linecap="round">
    <g stroke="#FFB020"><circle cx="18" cy="17" r="6.5" fill="rgba(255,176,32,.18)"/>
    <path d="M18 4v4M5 17h4M8.8 7.8l2.8 2.8M27.2 7.8l-2.8 2.8"/></g>
    <path d="M18.5 38h16a6.5 6.5 0 0 0 .6-13 9 9 0 0 0-17.2 1.6A5.7 5.7 0 0 0 18.5 38z"
      fill="rgba(242,245,249,.10)" stroke="#F2F5F9"/>
  </svg>`,
  cloud: `<svg viewBox="0 0 48 48" fill="none" stroke="#F2F5F9" stroke-width="2.6" stroke-linecap="round">
    <path d="M15 37h17a7 7 0 0 0 .6-14 10 10 0 0 0-19-1.8A6.2 6.2 0 0 0 15 37z" fill="rgba(242,245,249,.10)"/>
  </svg>`,
  rain: `<svg viewBox="0 0 48 48" fill="none" stroke-width="2.6" stroke-linecap="round">
    <path d="M15 30h17a7 7 0 0 0 .6-14 10 10 0 0 0-19-1.8A6.2 6.2 0 0 0 15 30z"
      fill="rgba(242,245,249,.10)" stroke="#F2F5F9"/>
    <g stroke="#48D6E4"><path d="M17 36l-2 6M25 36l-2 6M33 36l-2 6"/></g>
  </svg>`,
  storm: `<svg viewBox="0 0 48 48" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 28h17a7 7 0 0 0 .6-14 10 10 0 0 0-19-1.8A6.2 6.2 0 0 0 15 28z"
      fill="rgba(242,245,249,.10)" stroke="#F2F5F9"/>
    <path d="M25 31l-6 8h6l-3 7" stroke="#FFB020"/>
  </svg>`
};
const icon = n => ICONS[n] || ICONS.cloud;

const GOOGLE_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#4285F4" d="M45 24.5c0-1.6-.1-2.8-.4-4H24v7.5h12c-.3 2-1.6 5-4.6 7l7 5.4C42.6 36.6 45 31 45 24.5z"/>
  <path fill="#34A853" d="M24 46c6 0 11-2 14.7-5.4l-7-5.4c-1.9 1.3-4.5 2.2-7.7 2.2-5.9 0-10.9-3.9-12.7-9.3l-7.3 5.6C7.6 41 15.2 46 24 46z"/>
  <path fill="#FBBC05" d="M11.3 28.1c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.3-5.6C2.5 16.3 1.7 20 1.7 23.5S2.5 30.7 4 33.7l7.3-5.6z"/>
  <path fill="#EA4335" d="M24 9.5c3.3 0 6.2 1.2 8.5 3.3l6.3-6.3C34.9 2.9 30 1 24 1 15.2 1 7.6 6 4 13.3l7.3 5.6C13.1 13.4 18.1 9.5 24 9.5z"/>
</svg>`;


/* ══════════════════════════════════════════════════════════════
   Rendering
   ══════════════════════════════════════════════════════════════ */

function renderClock(){
  const now = new Date();
  const h = now.getHours();
  $('clock').textContent = `${h % 12 === 0 ? 12 : h % 12}:${String(now.getMinutes()).padStart(2,'0')}`;
  $('ampm').textContent  = h >= 12 ? 'PM' : 'AM';
  $('date').textContent  = now.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
}

function renderCalendar(){
  const s = ui.data.settings;
  const today = new Date();
  const start = gridStart(today, s.weekStartsOn);
  const total = s.weeks * 7;
  const todayKey = iso(today);
  const thisMonth = today.getMonth();

  const byDate = {};
  for (const e of allEvents()) (byDate[e.date] ||= []).push(e);
  for (const k in byDate)
    byDate[k].sort((a,b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  let html = '';
  for (let i = 0; i < 7; i++)
    html += `<div class="cal__dow">${addDays(start, i).toLocaleDateString(undefined,{weekday:'short'})}</div>`;

  for (let i = 0; i < total; i++){
    const d = addDays(start, i);
    const key = iso(d);
    const evs = byDate[key] || [];
    const cls = ['day'];
    if (key === todayKey) cls.push('day--today');
    else if (d.getMonth() !== thisMonth) cls.push('day--out');

    const shown = evs.slice(0, s.maxEventsPerDay);
    const extra = evs.length - shown.length;

    const evHtml = shown.map(e => {
      const tone = e.tone === 'warm' ? ' ev--warm' : e.tone === 'plain' ? ' ev--plain' : '';
      const t = e.time ? `<span class="ev__t">${shortTime(e.time)}</span>` : '';
      return `<div class="ev${tone}">${t}<span class="ev__n">${esc(e.title)}</span></div>`;
    }).join('');

    const monLabel = (d.getDate() === 1 || i === 0)
      ? `<span class="day__mon">${d.toLocaleDateString(undefined,{month:'short'})}</span>` : '';

    html += `<div class="${cls.join(' ')}" data-date="${key}"${ui.interactive ? ' tabindex="0" role="button"' : ''}>
        <div class="day__top"><span class="day__num">${d.getDate()}</span>${monLabel}</div>
        <div class="day__events">${evHtml}</div>
        ${extra > 0 ? `<div class="day__more">+${extra} more</div>` : ''}
      </div>`;
  }

  $('cal').innerHTML = html;
  const fmt = d => d.toLocaleDateString(undefined,{ month:'short', day:'numeric' });
  $('calRange').textContent = `${fmt(start)} – ${fmt(addDays(start, total - 1))}`;
}

function renderWeather(){
  const w = ui.weather;
  if (!w) return;
  const deg = ui.data.settings.units === 'C' ? '°C' : '°F';
  $('wxPlace').textContent = ui.data.settings.place + (ui.interactive ? ' ✎' : '');
  $('wxNowIcon').innerHTML = icon(w.now.icon);
  $('wxNowTemp').innerHTML = `${Math.round(w.now.temp)}&deg;`;
  $('wxNowCond').textContent = w.now.cond;
  $('wxNowFeels').textContent = `Feels ${Math.round(w.now.feels)}${deg}`;

  $('wxDays').innerHTML = w.days.map(d => `
    <div class="wxd">
      <div class="wxd__day">${esc(d.day)}</div>
      <div class="wxd__icon">${icon(d.icon)}</div>
      <div class="wxd__hi">${Math.round(d.hi)}&deg;</div>
      <div class="wxd__lo">${Math.round(d.lo)}&deg;</div>
    </div>`).join('');
}

function renderGrocery(){
  const sheetMode = GROCERY.source === 'sheet';
  const source = sheetMode ? (ui.sheetGrocery || []) : ui.data.grocery;
  const items = [...source].sort((a,b) =>
    (a.done === b.done) ? (a.addedAt || 0) - (b.addedAt || 0) : (a.done ? 1 : -1));

  $('grocTools').hidden = !(ui.interactive && !ui.readonly && !sheetMode);
  $('grocSheetNote').hidden = !(sheetMode && ui.interactive);

  if (!items.length){
    $('groc').innerHTML = `<div class="empty">List is clear.</div>`;
    $('grocCount').textContent = '0 items';
    return;
  }

  $('grocCount').textContent = `${items.filter(i => !i.done).length} to get`;
  const shown = items.slice(0, ui.data.settings.maxGroceryItems);
  const extra = items.length - shown.length;

  $('groc').innerHTML = shown.map(i => `
    <div class="gi${i.done ? ' gi--done' : ''}" data-id="${i.id}"${ui.interactive ? ' tabindex="0" role="button"' : ''}>
      <span class="gi__box"></span>
      <span class="gi__name">${esc(i.name)}</span>
      ${i.qty ? `<span class="gi__qty">${esc(i.qty)}</span>` : ''}
      ${ui.interactive && !ui.readonly && !sheetMode
        ? `<button class="gi__del" data-del="${i.id}" aria-label="Remove ${esc(i.name)}">&times;</button>` : ''}
    </div>`).join('')
    + (extra > 0 ? `<div class="groc__more">+${extra} more on the list</div>` : '');
}

function renderSensors(){
  const now = Date.now();
  const labels = ui.data.settings.sensorLabels || {};

  $('tiles').innerHTML = SENSORS.map(def => {
    const s = ui.data.sensors[def.id] || {};
    const has = s.value !== undefined && s.value !== null;
    const stale = !s.updated || (now - s.updated) > ui.data.settings.staleMinutes * 60000;
    const isOpen = def.kind === 'state' &&
      String(s.value).toUpperCase() === (def.openWord || 'OPEN');

    const cls = ['tile'];
    if (isOpen) cls.push('tile--alert');
    if (!has || stale) cls.push('tile--stale');

    const val = !has
      ? `<div class="tile__value tile__value--word">—</div>`
      : def.kind === 'state'
        ? `<div class="tile__value tile__value--word${isOpen ? ' tile__value--alert' : ''}">${esc(String(s.value))}</div>`
        : `<div class="tile__value">${typeof s.value === 'number' ? s.value.toFixed(1) : esc(s.value)}<span class="tile__unit">${esc(s.unit || def.unit || '')}</span></div>`;

    return `<div class="${cls.join(' ')}" data-sensor="${def.id}"${ui.interactive ? ' tabindex="0" role="button"' : ''}>
        <div class="tile__label">${esc(labels[def.id] || def.label)}</div>
        ${val}
        <div class="tile__foot"><span class="tile__pip"></span>${!has ? 'No data' : stale ? 'No signal' : ago(s.updated)}</div>
      </div>`;
  }).join('');
}

function setStatus(kind, sub){
  $('status').dataset.state = kind;
  $('statusLabel').textContent = { live:'Live', syncing:'Syncing', offline:'Offline', local:'Local' }[kind] || kind;
  if (sub !== undefined) $('statusSub').textContent = sub;
}

function renderAll(){
  renderClock(); renderCalendar(); renderWeather(); renderGrocery(); renderSensors();
}


/* ══════════════════════════════════════════════════════════════
   Modal plumbing
   ══════════════════════════════════════════════════════════════ */

let modalOnClose = null;

function openModal(title, bodyHtml, wire){
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modal').hidden = false;
  if (wire) wire($('modalBody'));

  // Only auto-focus if wire() didn't already put the cursor somewhere.
  const box = $('modalBody');
  if (!box.contains(document.activeElement)){
    const first = box.querySelector('input, select, button');
    if (first) first.focus();
  }
}

function closeModal(){
  $('modal').hidden = true;
  $('modalBody').innerHTML = '';
  if (modalOnClose){ modalOnClose(); modalOnClose = null; }
}

$('modalClose').addEventListener('click', closeModal);
$('modalScrim').addEventListener('click', closeModal);


/* ══════════════════════════════════════════════════════════════
   Interactions
   ══════════════════════════════════════════════════════════════ */

function dayModal(dateKey, opts = {}){
  const d = new Date(dateKey + 'T12:00:00');
  const evs = allEvents().filter(e => e.date === dateKey)
    .sort((a,b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  const keepTone = opts.tone || 'cool';

  const list = evs.length
    ? evs.map(e => `
        <div class="mev${e.tone === 'warm' ? ' mev--warm' : e.tone === 'plain' ? ' mev--plain' : ''}">
          <span class="mev__t">${e.time ? shortTime(e.time) : 'All day'}</span>
          <span class="mev__n">${esc(e.title)}</span>
          ${ui.readonly ? ''
            : e.src === 'gcal'
              ? `<span class="mev__src">Google</span>`
              : `<button class="btn btn--ghost btn--danger" data-rm="${e.id}">Remove</button>`}
        </div>`).join('')
    : `<p class="note">Nothing scheduled.</p>`;

  const form = ui.readonly ? '' : `
    <div class="divider"></div>
    <div class="row">
      <div class="field" style="flex:0 0 130px">
        <label class="field__label" for="evTime">Time</label>
        <input type="time" id="evTime">
      </div>
      <div class="field">
        <label class="field__label" for="evTitle">Event</label>
        <input type="text" id="evTitle" placeholder="Clinic, dinner, trash out…" autocomplete="off">
      </div>
      <div class="field" style="flex:0 0 120px">
        <label class="field__label" for="evTone">Accent</label>
        <select id="evTone">
          <option value="cool"${keepTone === 'cool' ? ' selected' : ''}>Cyan</option>
          <option value="warm"${keepTone === 'warm' ? ' selected' : ''}>Amber</option>
          <option value="plain"${keepTone === 'plain' ? ' selected' : ''}>Grey</option>
        </select>
      </div>
    </div>
    <div class="row row--split">
      <button class="btn btn--icon" id="evAddStay" type="button"
              title="Add and keep this open for another" aria-label="Add and keep this open">+</button>
      <button class="btn btn--primary" id="evAdd" type="button">Add event</button>
    </div>
    <p class="note">
      Leave the time blank for an all-day entry.
      <strong style="color:var(--fg)">+</strong> adds one and stays here for the next;
      <strong style="color:var(--fg)">Add event</strong> adds and closes, same as pressing Enter.
    </p>`;

  openModal(
    d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' }),
    `<div class="modal__list">${list}</div>${form}`,
    body => {
      body.querySelectorAll('[data-rm]').forEach(b =>
        b.addEventListener('click', async () => {
          try { await ui.store.removeEvent(b.dataset.rm); }
          catch (err){ return toast(err.message, true); }
          dayModal(dateKey);
        }));

      const add = async keepOpen => {
        const title = $('evTitle').value.trim();
        if (!title){
          $('evTitle').focus();
          return toast('Give the event a name.', true);
        }

        const tone = $('evTone').value;
        try {
          await ui.store.addEvent({
            date: dateKey,
            time: $('evTime').value || null,
            title,
            tone
          });
        } catch (err){ return toast(err.message, true); }

        if (keepOpen){
          // Reopen with the accent kept and the cursor back in the title,
          // so a run of entries needs no mouse.
          dayModal(dateKey, { focusTitle: true, tone });
        } else {
          closeModal();
          toast('Event added.');
        }
      };

      body.querySelector('#evAddStay')?.addEventListener('click', () => add(true));
      body.querySelector('#evAdd')?.addEventListener('click', () => add(false));
      body.querySelector('#evTitle')?.addEventListener('keydown', e => {
        if (e.key === 'Enter'){ e.preventDefault(); add(false); }
      });

      if (opts.focusTitle) body.querySelector('#evTitle')?.focus();
    });
}

function sensorModal(id){
  const def = SENSORS.find(s => s.id === id);
  const s = ui.data.sensors[id] || {};
  const labels = ui.data.settings.sensorLabels || {};
  const hid = auth.householdId || '<your-uid>';

  openModal(labels[id] || def.label, `
    <div class="field">
      <label class="field__label" for="snLabel">Tile label</label>
      <input type="text" id="snLabel" value="${esc(labels[id] || def.label)}" ${ui.readonly ? 'disabled' : ''}>
    </div>
    <div class="note">
      Last value: <code>${esc(String(s.value ?? '—'))}${esc(s.unit || '')}</code><br>
      Last write: <code>${s.updated ? new Date(s.updated).toLocaleString() : 'never'}</code>
    </div>
    <div class="divider"></div>
    <p class="note">
      Point this board's Firebase write at:<br>
      <code>households/${esc(hid)}/sensors/${esc(id)}</code><br><br>
      with a payload of<br>
      <code>{ "value": ${def.kind === 'state' ? '"OPEN"' : '84.6'}${def.kind === 'temp' ? ', "unit": "°F"' : ''}, "updated": 1730000000000 }</code><br><br>
      The tile dims and reads "No signal" if <code>updated</code> is older than
      ${ui.data.settings.staleMinutes} minutes, so a dead board is obvious instead of frozen on a stale number.
    </p>
    ${ui.readonly ? '' : `<div class="row row--end"><button class="btn btn--primary" id="snSave">Save label</button></div>`}
  `, body => {
    body.querySelector('#snSave')?.addEventListener('click', async () => {
      await ui.store.renameSensor(id, $('snLabel').value.trim() || def.label);
      closeModal();
      toast('Label saved.');
    });
  });
}

const fmtCoords = (lat, lon) =>
  `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;

function settingsModal(){
  const s = ui.data.settings;

  // Held here until Save, so a stray search doesn't change anything.
  let pending = { lat: s.lat, lon: s.lon, place: s.place };
  const manualCount = (ui.data.events || []).length;

  const calList = Object.entries(ui.data.meta?.calendars || {})
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) ||
                    String(a.name).localeCompare(String(b.name)));

  openModal('Settings', `
    <div class="field">
      <label class="field__label" for="stPlace">Location</label>
      <div class="row">
        <input type="text" id="stPlace" value="${esc(s.place)}"
               placeholder="City, state or country" autocomplete="off">
        <button class="btn" id="stFind">Search</button>
      </div>
      <div class="geo" id="stResults"></div>
      <p class="note" id="stCoords">Forecasting for ${fmtCoords(s.lat, s.lon)}</p>
    </div>

    <div class="row">
      <div class="field" style="flex:0 0 110px">
        <label class="field__label" for="stUnits">Units</label>
        <select id="stUnits">
          <option value="F"${s.units === 'F' ? ' selected' : ''}>&deg;F</option>
          <option value="C"${s.units === 'C' ? ' selected' : ''}>&deg;C</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="stWeek">Week starts</label>
        <select id="stWeek">
          <option value="0"${s.weekStartsOn === 0 ? ' selected' : ''}>Sunday</option>
          <option value="1"${s.weekStartsOn === 1 ? ' selected' : ''}>Monday</option>
        </select>
      </div>
      <div class="field" style="flex:0 0 140px">
        <label class="field__label" for="stEvents">Events per day</label>
        <input type="number" min="1" max="6" id="stEvents" value="${s.maxEventsPerDay}">
      </div>
    </div>

    ${calList.length ? `
      <div class="divider"></div>
      <div class="field">
        <label class="field__label">Google calendars</label>
        <div class="cals" id="stCals">
          ${calList.map(c => `
            <label class="cal-row">
              <input type="checkbox" class="cal-row__on" data-key="${esc(c.key)}"
                     ${calendarOn(c.key) ? 'checked' : ''}>
              <span class="cal-row__name">${esc(c.name)}${c.primary ? ' <span class="cal-row__tag">main</span>' : ''}</span>
              <select class="cal-row__tone" data-key="${esc(c.key)}">
                <option value="cool"${calendarTone(c.key) === 'cool' ? ' selected' : ''}>Cyan</option>
                <option value="warm"${calendarTone(c.key) === 'warm' ? ' selected' : ''}>Amber</option>
                <option value="plain"${calendarTone(c.key) === 'plain' ? ' selected' : ''}>Grey</option>
              </select>
            </label>`).join('')}
        </div>
        <p class="note">Unchecking hides a calendar here without touching it in Google.</p>
      </div>` : `
      <div class="divider"></div>
      <p class="note">
        No Google calendars discovered yet. They appear here after the next sync
        &mdash; run <code>node scripts/sync-calendar.mjs</code> or let the GitHub Action fire.
      </p>`}

    ${manualCount ? `
      <div class="divider"></div>
      <div class="field">
        <label class="field__label">Events added by hand</label>
        <p class="note">
          ${manualCount} event${manualCount === 1 ? '' : 's'} not from Google Calendar &mdash;
          the sample entries the dashboard started with, plus anything you typed in yourself.
          Google events are untouched by this.
        </p>
        <div id="stWipe"><button class="btn btn--danger" id="stWipeGo">Remove all ${manualCount}</button></div>
      </div>` : ''}

    <div class="divider"></div>
    <div class="row row--end">
      <button class="btn" id="stKiosk">Switch to kiosk mode</button>
      <button class="btn btn--primary" id="stSave">Save</button>
    </div>
  `, body => {

    const setCoords = (lat, lon) => {
      $('stCoords').textContent = `Forecasting for ${fmtCoords(lat, lon)}`;
    };

    const search = async () => {
      const q = $('stPlace').value.trim();
      if (!q) return;

      $('stResults').innerHTML = `<p class="note">Searching\u2026</p>`;
      try {
        const hits = await geocodePlace(q);
        if (!hits.length){
          $('stResults').innerHTML =
            `<p class="note">Nothing found. Try adding a state or country &mdash; "Chico, CA" rather than "Chico".</p>`;
          return;
        }

        $('stResults').innerHTML = hits.map((h, i) => `
          <button class="geo__hit" data-i="${i}" type="button">
            <span class="geo__name">${esc(h.label)}</span>
            <span class="geo__co">${fmtCoords(h.latitude, h.longitude)}</span>
          </button>`).join('');

        $('stResults').querySelectorAll('[data-i]').forEach(btn =>
          btn.addEventListener('click', () => {
            const h = hits[Number(btn.dataset.i)];
            pending = { lat: h.latitude, lon: h.longitude, place: h.label };
            $('stPlace').value = h.label;
            setCoords(h.latitude, h.longitude);
            $('stResults').innerHTML = '';
          }));
      } catch (err){
        $('stResults').innerHTML =
          `<p class="note" style="color:var(--amber)">${esc(err.message)}</p>`;
      }
    };

    body.querySelector('#stFind').addEventListener('click', search);
    body.querySelector('#stPlace').addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); search(); }
    });

    // Two-step, so a mis-click can't wipe the calendar.
    body.querySelector('#stWipeGo')?.addEventListener('click', () => {
      $('stWipe').innerHTML = `
        <p class="note">Remove all ${manualCount}? This cannot be undone.</p>
        <div class="row row--end">
          <button class="btn btn--quiet" id="stWipeNo">Keep them</button>
          <button class="btn btn--danger" id="stWipeYes">Yes, remove</button>
        </div>`;

      $('stWipeNo').addEventListener('click', () => settingsModal());
      $('stWipeYes').addEventListener('click', async () => {
        try {
          await ui.store.clearEvents();
          closeModal();
          toast(`${manualCount} event${manualCount === 1 ? '' : 's'} removed.`);
        } catch (err){ toast(err.message, true); }
      });
    });

    const save = async () => {
      const typed = $('stPlace').value.trim() || DEFAULTS.place;

      // Renamed but never searched — resolve it now so the forecast follows.
      if (typed !== pending.place){
        try {
          const hits = await geocodePlace(typed);
          if (hits.length) pending = { lat: hits[0].latitude, lon: hits[0].longitude, place: typed };
        } catch { /* keep the previous coordinates */ }
      }

      const calendars = {};
      body.querySelectorAll('.cal-row__on').forEach(cb => {
        const key = cb.dataset.key;
        const tone = body.querySelector(`.cal-row__tone[data-key="${key}"]`)?.value || 'cool';
        calendars[key] = { on: cb.checked, tone };
      });

      await ui.store.saveSettings({
        place: typed,
        lat:   pending.lat,
        lon:   pending.lon,
        units: $('stUnits').value,
        weekStartsOn:    parseInt($('stWeek').value, 10),
        maxEventsPerDay: parseInt($('stEvents').value, 10),
        ...(calList.length ? { calendars } : {})
      });

      closeModal();
      refreshWeather();
      toast('Settings saved.');
    };

    body.querySelector('#stSave').addEventListener('click', save);
    body.querySelector('#stKiosk').addEventListener('click', () => { closeModal(); setMode(false); });
  });
}

async function accountModal(){
  if (!usingFirebase()){
    return openModal('Local mode', `
      <p class="note">
        No Firebase project is configured yet, so this dashboard is saving to this browser only.
        Everything you click and type still works — it just doesn't leave this machine.
      </p>
      <p class="note">
        Add your project's keys to <code>config.js</code> and reload. Google Sign-In, live sync,
        and display pairing all switch on automatically.
      </p>
      <div class="divider"></div>
      ${calendarConfigured() ? `
        <div class="divider"></div>
        <p class="note">Google Calendar can still sync in local mode — the events just stay in this browser.</p>
        <div class="row row--end"><button class="btn" id="acCalLocal">${calendarState.connected ? 'Sync now' : 'Connect calendar'}</button></div>` : ''}
      <div class="divider"></div>
      <div class="row row--end">
        <button class="btn btn--danger" id="acReset">Reset demo data</button>
      </div>
    `, body => {
      body.querySelector('#acCalLocal')?.addEventListener('click', async () => {
        await runCalendarSync({ interactive: !calendarState.connected });
        accountModal();
      });
      body.querySelector('#acReset').addEventListener('click', () => {
        ui.store.resetAll(); closeModal(); toast('Demo data reset.');
      });
    });
  }

  if (!auth.user){
    return openModal('Sign in', `
      <p class="note">Sign in with the Google account that owns your calendar and household data.</p>
      <button class="btn btn--primary btn--wide gsi" id="acSignIn">${GOOGLE_MARK} Continue with Google</button>
    `, body => body.querySelector('#acSignIn').addEventListener('click', () => signInWithGoogle().catch(e => toast(e.message, true))));
  }

  const devices = auth.role === 'owner' ? await listDevices() : [];
  const members = auth.role === 'owner' ? await listMembers() : [];
  const invites = auth.role === 'owner' ? await listInvites() : [];
  const houseOwner = auth.role === 'member' ? await householdName() : null;
  const autoSync = ui.data.meta?.calendarSync || null;
  // The Action runs every 15 min; an hour of silence means something broke.
  const autoStale = autoSync && (Date.now() - autoSync.at) > 60 * 60 * 1000;
  const devHtml = devices.length
    ? devices.map(d => `
        <div class="mev mev--plain">
          <span class="mev__n">${esc(d.name || 'Display')}</span>
          <span class="mev__t">${d.pairedAt ? new Date(d.pairedAt).toLocaleDateString() : ''}</span>
          <button class="btn btn--ghost btn--danger" data-unpair="${d.uid}">Unpair</button>
        </div>`).join('')
    : `<p class="note">No displays paired yet.</p>`;

  openModal('Account', `
    <div class="note">
      Signed in as <strong style="color:var(--fg)">${esc(auth.user.displayName || auth.user.email)}</strong>
      ${auth.role === 'display' ? ' (paired display)' : ''}
      ${auth.role === 'member' ? `<br>Sharing ${esc(houseOwner)}'s list.` : ''}
    </div>

    ${auth.role === 'member' ? `
      <div class="divider"></div>
      <p class="note">You can add to and check off the grocery list and add calendar events. Settings, sensors, and the Google Calendar sync stay with the owner.</p>
      <div class="row row--end"><button class="btn btn--danger" id="acLeave">Leave this household</button></div>` : ''}

    ${auth.role === 'owner' ? `
      <div class="divider"></div>
      <div class="field">
        <label class="field__label">People sharing this list</label>
        <div class="modal__list">
          <div class="mev mev--warm">
            <span class="mev__n">${esc(auth.user.displayName || auth.user.email)}</span>
            <span class="mev__src">You</span>
          </div>
          ${members.map(m => `
            <div class="mev mev--plain">
              <span class="mev__n">${esc(m.name || 'Member')}</span>
              <button class="btn btn--ghost btn--danger" data-rmmember="${esc(m.uid)}">Remove</button>
            </div>`).join('')}
        </div>
      </div>

      ${invites.length ? `
        <div class="field">
          <label class="field__label">Open invites</label>
          <div class="modal__list">
            ${invites.map(i => `
              <div class="mev mev--plain">
                <span class="mev__n" style="font-family:'IBM Plex Mono',monospace;letter-spacing:.14em">${esc(i.code)}</span>
                <span class="mev__t">${Math.max(0, Math.round((i.expiresAt - Date.now()) / 864e5))}d left</span>
                <button class="btn btn--ghost btn--danger" data-revoke="${esc(i.code)}">Revoke</button>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <div class="row row--end">
        <button class="btn btn--primary" id="acInvite">Invite someone</button>
      </div>` : ''}
    ${auth.role === 'owner' ? `
      <div class="divider"></div>
      <div class="field">
        <label class="field__label">Paired displays</label>
        <div class="modal__list">${devHtml}</div>
      </div>
      <div class="divider"></div>
      <div class="field">
        <label class="field__label" for="acCode">Pair a new display</label>
        <div class="row">
          <input type="text" id="acCode" placeholder="Code shown on the screen" style="text-transform:uppercase">
          <button class="btn btn--primary" id="acPair">Pair</button>
        </div>
      </div>
      <p class="note">
        Open this dashboard on the kitchen or bathroom screen. It shows a six-character code —
        type it here and that display is authorized for good, no keyboard needed on its end.
      </p>` : ''}
    ${auth.role === 'owner' && (autoSync || calendarConfigured()) ? `
      <div class="divider"></div>
      <div class="field">
        <label class="field__label">Google Calendar</label>
        ${autoSync ? `
          <p class="note">
            Synced automatically ${autoStale ? '' : 'by GitHub Actions'} — last run ${ago(autoSync.at)}, ${autoSync.count} event${autoSync.count === 1 ? '' : 's'}.
            ${autoStale ? `<br><span style="color:var(--amber)">That is older than expected. Check the Actions tab for a failed run.</span>` : ''}
          </p>` : `
          <p class="note">
            No automatic sync has run yet. Events appear here once the GitHub Action runs, or
            after <code>node scripts/sync-calendar.mjs</code> from your computer.
            ${calendarState.error ? `<pre class="gate__err" style="margin-top:10px">${esc(calendarState.error)}</pre>` : ''}
          </p>`}
        ${calendarConfigured() ? `
          <div class="row row--end">
            ${calendarState.connected ? `<button class="btn btn--ghost" id="acCalOff">Disconnect</button>` : ''}
            <button class="btn ${autoSync ? '' : 'btn--primary'}" id="acCal">${calendarState.connected ? 'Sync now' : 'Pull from this browser'}</button>
          </div>` : ''}
      </div>` : ''}
    <div class="divider"></div>
    <div class="row row--end"><button class="btn btn--danger" id="acOut">Sign out</button></div>
  `, body => {
    body.querySelector('#acOut').addEventListener('click', () => signOutNow().then(() => location.reload()));

    body.querySelector('#acLeave')?.addEventListener('click', async () => {
      await leaveHousehold();
      location.reload();
    });

    body.querySelector('#acInvite')?.addEventListener('click', () => inviteModal());

    body.querySelectorAll('[data-rmmember]').forEach(b =>
      b.addEventListener('click', async () => {
        await removeMember(b.dataset.rmmember);
        toast('Removed. They lose access on their next load.');
        accountModal();
      }));

    body.querySelectorAll('[data-revoke]').forEach(b =>
      b.addEventListener('click', async () => {
        await revokeInvite(b.dataset.revoke);
        accountModal();
      }));

    body.querySelector('#acCal')?.addEventListener('click', async () => {
      await runCalendarSync({ interactive: !calendarState.connected });
      accountModal();
    });
    body.querySelector('#acCalOff')?.addEventListener('click', () => {
      disconnectCalendar(); accountModal();
    });

    body.querySelector('#acPair')?.addEventListener('click', async () => {
      try {
        const { name } = await claimPairing($('acCode').value);
        closeModal();
        toast(`${name || 'Display'} paired.`);
      } catch (e){ toast(e.message, true); }
    });
    body.querySelector('#acCode')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') body.querySelector('#acPair').click();
    });

    body.querySelectorAll('[data-unpair]').forEach(b =>
      b.addEventListener('click', async () => {
        await unpairDevice(b.dataset.unpair);
        toast('Display unpaired.');
        accountModal();
      }));
  });
}

async function inviteModal(){
  openModal('Invite someone', `<div class="gate__spinner" style="margin:20px auto"></div>`);
  try {
    const inv = await createInvite(14);
    const listUrl  = new URL('./list.html', location.href);
    listUrl.searchParams.set('join', inv.code);

    openModal('Invite someone', `
      <p class="note">Send them this link. They sign in with their own Google account and land straight in the shopping list.</p>
      <div class="field">
        <label class="field__label">Shopping list link</label>
        <input type="text" id="ivLink" value="${esc(listUrl.href)}" readonly>
      </div>
      <div class="field">
        <label class="field__label">Or read them the code</label>
        <input type="text" id="ivCode" value="${esc(inv.code)}" readonly
               style="font-family:'IBM Plex Mono',monospace;font-size:26px;letter-spacing:.2em;text-align:center;color:var(--amber)">
      </div>
      <p class="note">
        Good for 14 days, and reusable — one code works for the whole family.
        Everyone who joins can add to the list, check things off, and clear it,
        from their phone or any browser. Revoke it any time from the account panel.
      </p>
      <div class="row row--end">
        <button class="btn" id="ivCopy">Copy link</button>
        <button class="btn btn--primary" id="ivDone">Done</button>
      </div>
    `, body => {
      body.querySelector('#ivCopy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(listUrl.href);
          toast('Link copied.');
        } catch {
          $('ivLink').select();
          toast('Press Ctrl+C to copy.');
        }
      });
      body.querySelector('#ivDone').addEventListener('click', () => { closeModal(); accountModal(); });
    });
  } catch (err){
    openModal('Invite someone', `<p class="note" style="color:var(--amber)">${esc(err.message)}</p>`);
  }
}

/* ── Inline grocery add ─────────────────────────────────────── */
function startGroceryAdd(){
  if (!ui.interactive || ui.readonly) return;
  if (document.querySelector('.groc__new')) return document.querySelector('.groc__new input').focus();

  const row = document.createElement('div');
  row.className = 'groc__new';
  row.innerHTML = `
    <input type="text" name="name" placeholder="Add an item…" autocomplete="off">
    <input type="text" name="qty" placeholder="Qty" autocomplete="off">`;
  $('groc').appendChild(row);

  const [nameEl, qtyEl] = row.querySelectorAll('input');
  nameEl.focus();

  const commit = async keepOpen => {
    const name = nameEl.value.trim();
    if (name) await ui.store.addGrocery({ name, qty: qtyEl.value.trim() });
    if (keepOpen && name){
      nameEl.value = ''; qtyEl.value = '';
      setTimeout(() => { startGroceryAdd(); }, 0);
    } else {
      row.remove();
    }
  };

  row.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape'){ row.remove(); }
  });
  row.addEventListener('focusout', () => {
    setTimeout(() => { if (!row.contains(document.activeElement)) commit(false); }, 100);
  });
}


/* ══════════════════════════════════════════════════════════════
   Event wiring
   ══════════════════════════════════════════════════════════════ */

$('cal').addEventListener('click', e => {
  if (!ui.interactive) return;
  const day = e.target.closest('.day');
  if (day) dayModal(day.dataset.date);
});

$('groc').addEventListener('click', async e => {
  if (!ui.interactive) return;
  const del = e.target.closest('[data-del]');
  if (del){ e.stopPropagation(); await ui.store.removeGrocery(del.dataset.del); return; }
  if (GROCERY.source === 'sheet') return;
  const item = e.target.closest('.gi');
  if (item && !ui.readonly) await ui.store.toggleGrocery(item.dataset.id);
});

$('tiles').addEventListener('click', e => {
  if (!ui.interactive) return;
  const tile = e.target.closest('[data-sensor]');
  if (tile) sensorModal(tile.dataset.sensor);
});

$('grocAdd').addEventListener('click', startGroceryAdd);
$('grocClear').addEventListener('click', async () => { await ui.store.clearDone(); toast('Checked items cleared.'); });
$('wxPlace').addEventListener('click', () => { if (ui.interactive) settingsModal(); });
$('account').addEventListener('click', accountModal);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('modal').hidden) return closeModal();

  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  const k = e.key.toLowerCase();
  if (k === 'k'){ setMode(!ui.interactive); return; }
  if (!ui.interactive) return;

  if (k === 'a'){ e.preventDefault(); startGroceryAdd(); }
  if (k === 'e'){ e.preventDefault(); dayModal(iso(new Date())); }
  if (k === 's'){ e.preventDefault(); settingsModal(); }
  if (k === 'f'){ document.documentElement.requestFullscreen?.().catch(() => {}); }
});

// Enter/Space activate the focused day, item, or tile
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = document.activeElement;
  if (el?.matches?.('.day, .gi, .tile')){ e.preventDefault(); el.click(); }
});


/* ══════════════════════════════════════════════════════════════
   Mode switching
   ══════════════════════════════════════════════════════════════ */

/* The chip always read "Sign in", signed in or not — so there was no way
   to tell your session had lapsed short of clicking it. */
function renderAccount(){
  const nameEl = $('accountName');
  const avEl   = $('accountAvatar');
  if (!nameEl) return;

  if (!usingFirebase()){
    nameEl.textContent = 'Local mode';
    avEl.style.backgroundImage = '';
    avEl.textContent = '\u2022';
    return;
  }

  if (!auth.user){
    nameEl.textContent = 'Sign in';
    avEl.style.backgroundImage = '';
    avEl.textContent = '?';
    return;
  }

  const who = auth.user.displayName || auth.user.email || 'Signed in';
  nameEl.textContent = who.split(' ')[0] || who;

  if (auth.user.photoURL){
    avEl.style.backgroundImage = `url("${auth.user.photoURL}")`;
    avEl.textContent = '';
  } else {
    avEl.style.backgroundImage = '';
    avEl.textContent = who.slice(0, 1).toUpperCase();
  }
}

function setMode(interactive){
  ui.interactive = interactive;
  document.body.classList.toggle('is-interactive', interactive);
  document.body.classList.toggle('is-readonly', ui.readonly);
  $('account').hidden = !interactive;
  $('hint').hidden = !interactive || ui.readonly;
  renderAccount();
  try { localStorage.setItem('homedash.mode', interactive ? 'edit' : 'kiosk'); } catch {}
  renderAll();
}

function detectMode(){
  const forced = params.get('mode');
  if (forced) return forced === 'edit';
  let saved = null;
  try { saved = localStorage.getItem('homedash.mode'); } catch {}
  if (saved) return saved === 'edit';
  // Anything that isn't a paired wall panel is a device someone is
  // holding — phone included. Those get to edit.
  return true;
}


/* ══════════════════════════════════════════════════════════════
   Gate screens
   ══════════════════════════════════════════════════════════════ */

function showGate(html){
  $('gateCard').innerHTML = html;
  $('gate').hidden = false;
  $('frame').hidden = true;
}

function showDashboard(){
  $('gate').hidden = true;
  $('frame').hidden = false;
}

function gateSignIn(){
  showGate(`
    <h1 class="gate__title">Home Dashboard</h1>
    <p class="gate__msg">Sign in with the Google account that owns this household's data.</p>
    <button class="btn btn--primary gsi" id="gSignIn">${GOOGLE_MARK} Continue with Google</button>
    <button class="gate__link" id="gPair">This is a wall display — pair it instead</button>
  `);
  $('gSignIn').addEventListener('click', () => signInWithGoogle().catch(e => toast(e.message, true)));
  $('gPair').addEventListener('click', gatePair);
}

async function gatePair(){
  showGate(`<div class="gate__spinner"></div><p class="gate__msg">Requesting a pairing code…</p>`);
  try {
    const { code, deviceUid } = await startPairing();
    showGate(`
      <h1 class="gate__title">Pair this display</h1>
      <div class="gate__code">${code}</div>
      <p class="gate__msg">
        On a computer where you're already signed in, open this dashboard,
        click your account chip, and enter this code. This screen will take over on its own —
        you won't need to touch it again.
      </p>
      <p class="gate__msg" style="font-size:14px">This display: ${esc(location.host)}</p>
    `);
    watchHousehold(deviceUid, async hid => {
      auth.householdId = hid;
      auth.role = 'display';
      await boot();
    });
  } catch (e){
    showGate(`<h1 class="gate__title">Pairing failed</h1><p class="gate__msg">${esc(e.message)}</p>`);
  }
}


/* ══════════════════════════════════════════════════════════════
   Data refresh
   ══════════════════════════════════════════════════════════════ */

async function refreshSheetGrocery(){
  if (GROCERY.source !== 'sheet') return;
  try {
    ui.sheetGrocery = await fetchSheetGrocery();
  } catch (err){
    console.warn('Grocery sheet unavailable:', err.message);
    if (!ui.sheetGrocery) ui.sheetGrocery = [];
  }
  renderGrocery();
}

async function runCalendarSync({ interactive = false } = {}){
  if (!calendarConfigured() || auth.role !== 'owner') return;
  try {
    const n = await syncCalendar(ui.store, { interactive });
    if (interactive) toast(`${n} events pulled from Google Calendar.`);
  } catch (err){
    if (interactive) toast(err.message, true);
    else console.warn('Calendar sync:', err.message);
  }
}

async function refreshWeather(){
  try {
    ui.weather = await fetchWeather(ui.data.settings);
    ui.lastOk = Date.now();
  } catch (err){
    console.warn('Weather unavailable:', err);
    if (!ui.weather) ui.weather = fallbackWeather();
  }
  renderWeather();
  stampStatus();
}

function stampStatus(){
  const t = new Date();
  if (!navigator.onLine) return setStatus('offline', 'Network unreachable');
  if (!usingFirebase()) return setStatus('local', `Local data · ${fmtTime12(t.getHours(), t.getMinutes())}`);
  setStatus('live', `Updated ${fmtTime12(t.getHours(), t.getMinutes())}`);
}

function tick(){
  renderClock();
  renderSensors();
  const key = iso(new Date());
  if (key !== tick.lastDay){ tick.lastDay = key; renderCalendar(); }
}
tick.lastDay = iso(new Date());

function burnInNudge(){
  const r = () => (Math.floor(Math.random() * 5) - 2) + 'px';
  document.documentElement.style.setProperty('--sx', r());
  document.documentElement.style.setProperty('--sy', r());
}


/* ══════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════ */

async function boot(){
  ui.timers.forEach(clearInterval);
  ui.timers = [];

  ui.readonly = auth.role === 'display';
  ui.store = await makeStore();

  ui.store.subscribe(state => {
    ui.data = state;
    renderAll();
  });

  setMode(ui.readonly ? false : detectMode());
  renderAccount();
  showDashboard();

  await refreshWeather();

  await refreshSheetGrocery();
  // Browser calendar sync is never automatic — it can pop a Google window,
  // and a wall panel must never be blocked by one.

  ui.timers.push(setInterval(tick, 1000));
  ui.timers.push(setInterval(refreshWeather, ui.data.settings.refreshMs || DEFAULTS.refreshMs));
  ui.timers.push(setInterval(refreshSheetGrocery, GROCERY.refreshMs));
  ui.timers.push(setInterval(burnInNudge, DEFAULTS.burnInMs));
}

async function start(){
  const joinCode = params.get('join');
  if (joinCode) setPendingJoin(joinCode);

  showGate(`<div class="gate__spinner"></div><p class="gate__msg">Starting up</p>`);
  renderClock();

  await initAuth();

  if (auth.error){
    showGate(`
      <h1 class="gate__title" style="color:var(--amber)">Could not reach the database</h1>
      <pre class="gate__err">${esc(auth.error)}</pre>
      <button class="btn" id="gRetry">Try again</button>
    `);
    $('gRetry').addEventListener('click', () => location.reload());
    return;
  }

  if (!usingFirebase()) return boot();

  // Skip the immediate replay — we only care about later transitions,
  // like a display flipping to paired while it sits on the code screen.
  let firstCall = true;
  onAuth(a => {
    if (firstCall){ firstCall = false; return; }
    if (a.ready && a.user && a.householdId && $('frame').hidden) boot();
  });

  if (!auth.user){
    if (joinCode) return gateSignIn();      // invited: always a person, never a panel
    // No session. A pointer means a person; otherwise assume it's a panel.
    if (params.get('pair') === '1') return gatePair();
    if (matchMedia('(hover: hover) and (pointer: fine)').matches && params.get('mode') !== 'kiosk')
      return gateSignIn();
    return gatePair();
  }

  if (auth.role === 'display' && !auth.householdId) return gatePair();
  if (auth.joinError) toast(auth.joinError, true);
  return boot();
}

window.addEventListener('online',  () => { stampStatus(); refreshWeather(); });
window.addEventListener('offline', () => setStatus('offline', 'Network unreachable'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWeather(); });

// The service worker is great on the wall and infuriating while developing.
const isLocal = ['localhost','127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || params.get('sw') === '1')){
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./service-worker.js').catch(e =>
      console.warn('Service worker not registered:', e)));
}

start().catch(err => {
  console.error(err);
  showGate(`<h1 class="gate__title">Something went wrong</h1><p class="gate__msg">${esc(err.message)}</p>`);
});
