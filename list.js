/* ══════════════════════════════════════════════════════════════
   list.js — the phone shopping list

   Same Firebase node as the wall dashboard's grocery panel
   (households/<uid>/grocery), so a tap here shows up in the
   bathroom within a couple of seconds and the other way round.

   Nothing destructive happens on a single tap. Clearing always
   goes through a confirmation sheet, and a clear can be undone
   for a few seconds afterwards.
   ══════════════════════════════════════════════════════════════ */

import { GROCERY, usingFirebase } from './config.js';
import {
  auth, onAuth, initAuth, makeStore,
  signInWithGoogle, signOutNow, fetchSheetGrocery,
  setPendingJoin, peekInvite, householdName, leaveHousehold
} from './store.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const sheetMode = GROCERY.source === 'sheet';
const joinCode = new URLSearchParams(location.search).get('join');

const ui = { store: null, items: [], readonly: sheetMode, busy: 0 };

const buzz = ms => { try { navigator.vibrate?.(ms); } catch {} };

const CHECK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#06232A"
  stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>`;

const GOOGLE_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#4285F4" d="M45 24.5c0-1.6-.1-2.8-.4-4H24v7.5h12c-.3 2-1.6 5-4.6 7l7 5.4C42.6 36.6 45 31 45 24.5z"/>
  <path fill="#34A853" d="M24 46c6 0 11-2 14.7-5.4l-7-5.4c-1.9 1.3-4.5 2.2-7.7 2.2-5.9 0-10.9-3.9-12.7-9.3l-7.3 5.6C7.6 41 15.2 46 24 46z"/>
  <path fill="#FBBC05" d="M11.3 28.1c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.3-5.6C2.5 16.3 1.7 20 1.7 23.5S2.5 30.7 4 33.7l7.3-5.6z"/>
  <path fill="#EA4335" d="M24 9.5c3.3 0 6.2 1.2 8.5 3.3l6.3-6.3C34.9 2.9 30 1 24 1 15.2 1 7.6 6 4 13.3l7.3 5.6C13.1 13.4 18.1 9.5 24 9.5z"/>
</svg>`;


/* ══════════════════════════════════════════════════════════════
   Toast, with an optional undo
   ══════════════════════════════════════════════════════════════ */

let toastTimer;
function toast(msg, { bad = false, undo = null, ms = 5000 } = {}){
  const t = $('toast');
  t.className = 'toast' + (bad ? ' toast--bad' : '');
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? `<button class="toast__undo" id="undoBtn">Undo</button>` : '');
  t.hidden = false;

  if (undo){
    $('undoBtn').addEventListener('click', async () => {
      t.hidden = true;
      clearTimeout(toastTimer);
      await undo();
    });
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}


/* ══════════════════════════════════════════════════════════════
   Sync indicator
   ══════════════════════════════════════════════════════════════ */

function setSync(state, label){
  $('syncChip').dataset.state = state;
  $('syncLabel').textContent = label;
}

async function withBusy(fn){
  ui.busy++;
  setSync('saving', 'Saving');
  try {
    await fn();
  } catch (err){
    toast(err.message || 'That did not save.', { bad: true });
  } finally {
    ui.busy--;
    if (!ui.busy) setSync(navigator.onLine ? 'ok' : 'offline', navigator.onLine ? label() : 'Offline');
  }
}

const label = () => usingFirebase() ? 'Synced' : 'On device';


/* ══════════════════════════════════════════════════════════════
   Render
   ══════════════════════════════════════════════════════════════ */

function render(){
  const items = [...ui.items].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);

  const who = ui.houseLabel ? ` · ${ui.houseLabel}` : '';
  $('count').textContent = (items.length
    ? `${open.length} to get · ${done.length} in the cart`
    : 'Nothing on the list') + who;

  if (!items.length){
    $('list').innerHTML = `
      <div class="empty">
        <div class="empty__big">List is clear</div>
        <p>${sheetMode ? 'Add rows in your Google Sheet and they show up here.'
                       : 'Add the first thing below.'}</p>
      </div>`;
    return;
  }

  const row = i => `
    <div class="item${i.done ? ' item--done' : ''}" data-id="${esc(i.id)}">
      <button class="item__hit" data-toggle="${esc(i.id)}" aria-pressed="${i.done}">
        <span class="box">${CHECK}</span>
        <span class="name">${esc(i.name)}</span>
        ${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ''}
      </button>
      ${ui.readonly ? '' : `<button class="del" data-del="${esc(i.id)}" aria-label="Delete ${esc(i.name)}">&times;</button>`}
    </div>`;

  $('list').innerHTML =
    (ui.readonly ? `<p class="readonly-note">This list is published from a Google Sheet, so it's read-only here. Edit it in the Sheets app.</p>` : '')
    + open.map(row).join('')
    + (done.length ? `<div class="group">In the cart</div>` + done.map(row).join('') : '');
}


/* ══════════════════════════════════════════════════════════════
   Bottom sheet
   ══════════════════════════════════════════════════════════════ */

function openSheet(title, bodyHtml, wire){
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = bodyHtml;
  $('sheet').hidden = false;
  if (wire) wire($('sheetBody'));
}

function closeSheet(){ $('sheet').hidden = true; $('sheetBody').innerHTML = ''; }

$('sheetScrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function menuSheet(){
  const done = ui.items.filter(i => i.done).length;
  const all  = ui.items.length;

  openSheet('List options', `
    ${ui.readonly ? '' : `
      <button class="btn btn--danger" id="mClearDone" ${done ? '' : 'disabled'}>
        Clear checked items<span class="btn__sub">${done} checked</span>
      </button>
      <button class="btn btn--danger" id="mClearAll" ${all ? '' : 'disabled'}>
        Clear the whole list<span class="btn__sub">${all} item${all === 1 ? '' : 's'}</span>
      </button>`}
    ${sheetMode ? `<button class="btn" id="mRefresh">Refresh from the sheet</button>` : ''}
    ${auth.role === 'member' ? `<button class="btn btn--quiet" id="mLeave">Leave this shared list</button>` : ''}
    ${usingFirebase() && auth.user ? `<button class="btn btn--quiet" id="mOut">Sign out of ${esc(auth.user.displayName || auth.user.email)}</button>` : ''}
    <button class="btn btn--quiet" id="mClose">Close</button>
  `, body => {
    body.querySelector('#mClose').addEventListener('click', closeSheet);
    body.querySelector('#mClearDone')?.addEventListener('click', () => confirmClear('done'));
    body.querySelector('#mClearAll')?.addEventListener('click', () => confirmClear('all'));
    body.querySelector('#mRefresh')?.addEventListener('click', async () => { closeSheet(); await pullSheet(); toast('Refreshed.'); });
    body.querySelector('#mLeave')?.addEventListener('click', () => leaveHousehold().then(() => location.reload()));
    body.querySelector('#mOut')?.addEventListener('click', () => signOutNow().then(() => location.reload()));
  });
}

/* Second tap required, always. */
function confirmClear(kind){
  const targets = kind === 'done' ? ui.items.filter(i => i.done) : [...ui.items];
  const n = targets.length;
  if (!n) return closeSheet();

  const title = kind === 'done' ? 'Clear checked items?' : 'Clear the whole list?';
  const note  = kind === 'done'
    ? `${n} checked item${n === 1 ? '' : 's'} will be removed. Anything still unchecked stays.`
    : `All ${n} item${n === 1 ? '' : 's'} will be removed, checked or not. This also clears the list on the wall dashboard.`;

  openSheet(title, `
    <p class="sheet__note">${note}</p>
    <button class="btn btn--danger" id="cYes">${kind === 'done' ? 'Clear checked' : 'Clear everything'}</button>
    <button class="btn btn--quiet" id="cNo">Keep the list</button>
  `, body => {
    body.querySelector('#cNo').addEventListener('click', closeSheet);
    body.querySelector('#cYes').addEventListener('click', async () => {
      closeSheet();
      buzz(18);
      const snapshot = targets.map(({ id, ...rest }) => rest);

      await withBusy(() => kind === 'done' ? ui.store.clearDone() : ui.store.clearAll());

      toast(`${n} item${n === 1 ? '' : 's'} cleared.`, {
        undo: async () => {
          await withBusy(async () => {
            for (const item of snapshot) await ui.store.addGrocery(item);
          });
          toast('Put back.');
        }
      });
    });
  });
}


/* ══════════════════════════════════════════════════════════════
   Interactions
   ══════════════════════════════════════════════════════════════ */

$('list').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  if (del){
    const item = ui.items.find(i => i.id === del.dataset.del);
    buzz(12);
    const { id, ...rest } = item || {};
    await withBusy(() => ui.store.removeGrocery(del.dataset.del));
    if (item) toast(`${item.name} removed.`, { undo: () => withBusy(() => ui.store.addGrocery(rest)) });
    return;
  }

  const hit = e.target.closest('[data-toggle]');
  if (hit && !ui.readonly){
    buzz(8);
    await withBusy(() => ui.store.toggleGrocery(hit.dataset.toggle));
  }
});

$('menuBtn').addEventListener('click', menuSheet);

$('compose').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('newName').value.trim();
  if (!name) return;
  const qty = $('newQty').value.trim();

  $('newName').value = '';
  $('newQty').value = '';
  $('newName').focus();                 // keep the keyboard up for the next one
  buzz(8);

  await withBusy(() => ui.store.addGrocery({ name, qty }));
});

$('newName').addEventListener('input', () => {
  $('newGo').disabled = !$('newName').value.trim();
});
$('newGo').disabled = true;

window.addEventListener('online',  () => setSync('ok', label()));
window.addEventListener('offline', () => setSync('offline', 'Offline'));


/* ══════════════════════════════════════════════════════════════
   Sheet-backed list (read-only)
   ══════════════════════════════════════════════════════════════ */

async function pullSheet(){
  try {
    ui.items = await fetchSheetGrocery();
    setSync('ok', 'From sheet');
  } catch (err){
    setSync('offline', 'Sheet error');
    toast(err.message, { bad: true });
  }
  render();
}


/* ══════════════════════════════════════════════════════════════
   Gate
   ══════════════════════════════════════════════════════════════ */

function showGate(html){
  $('gateInner').innerHTML = html;
  $('gate').hidden = false;
  $('app').hidden = true;
}

function showApp(){
  $('gate').hidden = true;
  $('app').hidden = false;
  $('compose').hidden = ui.readonly;
}

function gateSignIn(msg, title){
  showGate(`
    <h1 class="gate__title">${esc(title || 'Shopping List')}</h1>
    <p class="gate__msg">${msg || 'Sign in with the same Google account your dashboard uses, and this list becomes the one on your wall.'}</p>
    <button class="btn btn--primary gsi" id="gIn">${GOOGLE_MARK} Continue with Google</button>
  `);
  $('gIn').addEventListener('click', () => signInWithGoogle().catch(e => toast(e.message, { bad: true })));
}

/* Someone opened an invite link. Say whose list it is before asking
   them to hand over a Google account. */
async function gateInvite(code){
  showGate(`<div class="spinner"></div><p class="gate__msg">Checking that invite</p>`);
  try {
    const inv = await peekInvite(code);
    gateSignIn(
      `Sign in with your own Google account to join${inv.name ? ` ${esc(inv.name)}'s` : ' this'} shopping list. Whatever you add or check off shows up on their wall dashboard and on everyone else's phone.`,
      'You\u2019re invited'
    );
  } catch (err){
    gateSignIn(`${esc(err.message)} You can still sign in to your own list.`);
  }
}


/* ══════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════ */

async function boot(){
  ui.store = await makeStore();
  ui.store.subscribe(state => {
    if (!sheetMode){ ui.items = state.grocery || []; render(); }
  });

  if (sheetMode){
    await pullSheet();
    setInterval(pullSheet, GROCERY.refreshMs);
  } else {
    setSync(navigator.onLine ? 'ok' : 'offline', navigator.onLine ? label() : 'Offline');
  }

  showApp();
  render();
}

async function start(){
  if (joinCode) setPendingJoin(joinCode);

  await initAuth();

  if (!usingFirebase()) return boot();     // local mode, this browser only

  let first = true;
  onAuth(a => {
    if (first){ first = false; return; }
    if (a.ready && a.role === 'owner' && $('app').hidden) boot();
  });

  if (!auth.user) return joinCode ? gateInvite(joinCode) : gateSignIn();

  if (auth.role !== 'owner'){
    // An anonymous session from the pairing flow. Not what a phone wants.
    return gateSignIn('This device is signed in as a paired display. Sign in with Google to edit the list.');
  }

  if (auth.joinError) toast(auth.joinError, { bad: true });
  if (auth.role === 'member') ui.houseLabel = `shared with ${await householdName()}`;

  return boot();
}

if ('serviceWorker' in navigator && !['localhost','127.0.0.1'].includes(location.hostname)){
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

start().catch(err => {
  console.error(err);
  showGate(`<h1 class="gate__title">Something went wrong</h1><p class="gate__msg">${esc(err.message)}</p>`);
});
