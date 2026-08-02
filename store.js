/* ══════════════════════════════════════════════════════════════
   store.js — auth, data, and device pairing

   Two interchangeable stores expose the same surface:

     store.state                → { events, grocery, sensors, settings }
     store.subscribe(fn)        → fn(state) now and on every change
     store.addEvent / removeEvent / updateEvent
     store.addGrocery / toggleGrocery / removeGrocery / clearDone
     store.saveSettings / renameSensor

   LocalStore  — no Firebase configured. Saves to this browser.
   CloudStore  — Firebase Realtime Database, live-synced.
   ══════════════════════════════════════════════════════════════ */

import { FIREBASE_CONFIG, usingFirebase, DEFAULTS, SENSORS, GROCERY } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(36).slice(2, 8));

const emptyState = () => ({
  events: [],
  gcal: [],
  meta: {},
  grocery: [],
  sensors: {},
  settings: { ...DEFAULTS }
});


/* ══════════════════════════════════════════════════════════════
   Seed data — first run only, so there's something to look at
   ══════════════════════════════════════════════════════════════ */

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function seed(){
  const d = n => iso(addDays(new Date(), n));
  const ev = (date, time, title, tone) => ({ id: uid(), date, time, title, tone });
  const gi = (name, qty, done) => ({ id: uid(), name, qty, done, addedAt: Date.now() });

  return {
    events: [
      ev(d(0),  '06:45', 'OR block',            'warm'),
      ev(d(0),  '12:00', 'Tumor board',         'cool'),
      ev(d(0),  '19:00', 'Pool service',        'plain'),
      ev(d(1),  '08:00', 'Clinic',              'cool'),
      ev(d(1),  '17:15', 'Soccer practice',     'plain'),
      ev(d(2),  null,    'Trash out',           'plain'),
      ev(d(3),  '09:30', 'Case conference',     'cool'),
      ev(d(4),  '11:00', 'Dentist',             'warm'),
      ev(d(4),  '20:00', 'Movie night',         'cool'),
      ev(d(6),  '10:00', 'Farmers market',      'plain'),
      ev(d(8),  '07:30', 'Flight to ATL',       'warm'),
      ev(d(9),  null,    'Conference',          'cool'),
      ev(d(13), '13:00', 'Oil change',          'plain'),
      ev(d(15), '18:00', 'Anniversary dinner',  'warm')
    ],
    grocery: [
      gi('Eggs', '2 dz', false),   gi('Whole milk', '1 gal', false),
      gi('Coffee beans', '', true), gi('Bananas', '', false),
      gi('Chicken thighs', '3 lb', false), gi('Olive oil', '', false),
      gi('Greek yogurt', '4', true), gi('Sourdough', '1', false),
      gi('Baby spinach', '2 bag', false), gi('Parmesan', '', false),
      gi('Pool chlorine', '2', false), gi('Sparkling water', '12', false)
    ],
    sensors: {
      pool:   { value: 84.6,     unit: '°F', updated: Date.now() },
      garage: { value: 'CLOSED', updated: Date.now() - 40000 },
      house:  { value: 72.4,     unit: '°F', updated: Date.now() - 15000 }
    },
    settings: { ...DEFAULTS }
  };
}


/* ══════════════════════════════════════════════════════════════
   LocalStore — browser-only, for trying things out
   ══════════════════════════════════════════════════════════════ */

const LS_KEY = 'homedash.data.v1';

class LocalStore {
  constructor(){
    this.mode = 'local';
    this.subs = new Set();
    this.state = this._load();
    this._drift();
  }

  _load(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return { ...emptyState(), ...JSON.parse(raw) };
    } catch (e){ console.warn('Could not read saved data:', e); }
    const s = seed();
    this._save(s);
    return s;
  }

  _save(s = this.state){
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
    catch (e){ console.warn('Could not save:', e); }
  }

  // Nudge the fake sensor values so local mode looks alive.
  _drift(){
    setInterval(() => {
      const j = (v, spread) => +(v + (Math.random() - .5) * spread).toFixed(1);
      const s = this.state.sensors;
      if (typeof s.pool?.value  === 'number') s.pool  = { ...s.pool,  value: j(s.pool.value, .6),  updated: Date.now() };
      if (typeof s.house?.value === 'number') s.house = { ...s.house, value: j(s.house.value, .4), updated: Date.now() };
      this._emit();
    }, 60000);
  }

  subscribe(fn){ this.subs.add(fn); fn(this.state); return () => this.subs.delete(fn); }
  _emit(){ this._save(); this.subs.forEach(fn => fn(this.state)); }

  addEvent(e){ this.state.events.push({ id: uid(), ...e }); this._emit(); }
  updateEvent(id, patch){
    const e = this.state.events.find(x => x.id === id);
    if (e) Object.assign(e, patch);
    this._emit();
  }
  removeEvent(id){ this.state.events = this.state.events.filter(e => e.id !== id); this._emit(); }

  addGrocery(item){ this.state.grocery.push({ id: uid(), done: false, addedAt: Date.now(), ...item }); this._emit(); }
  toggleGrocery(id){
    const g = this.state.grocery.find(x => x.id === id);
    if (g) g.done = !g.done;
    this._emit();
  }
  updateGrocery(id, patch){
    const g = this.state.grocery.find(x => x.id === id);
    if (g) Object.assign(g, patch);
    this._emit();
  }
  removeGrocery(id){ this.state.grocery = this.state.grocery.filter(g => g.id !== id); this._emit(); }
  clearDone(){ this.state.grocery = this.state.grocery.filter(g => !g.done); this._emit(); }
  clearAll(){ this.state.grocery = []; this._emit(); }

  setGcal(list){ this.state.gcal = list; this._emit(); }
  clearEvents(){ this.state.events = []; this._emit(); }

  renameSensor(id, label){
    this.state.settings.sensorLabels = { ...(this.state.settings.sensorLabels || {}), [id]: label };
    this._emit();
  }
  saveSettings(patch){ Object.assign(this.state.settings, patch); this._emit(); }

  resetAll(){ this.state = seed(); this._emit(); }
}


/* ══════════════════════════════════════════════════════════════
   CloudStore — Firebase Realtime Database
   ══════════════════════════════════════════════════════════════ */

class CloudStore {
  constructor(db, fns, householdId, role){
    this.mode = 'cloud';
    this.db = db;
    this.fns = fns;                 // { ref, onValue, set, update, remove, push, serverTimestamp }
    this.hid = householdId;
    this.role = role;               // 'owner' | 'member' | 'display'
    this.canWrite = role === 'owner' || role === 'member';
    this.subs = new Set();
    this.state = emptyState();
    this._listen();
  }

  _path(p){ return this.fns.ref(this.db, `households/${this.hid}${p ? '/' + p : ''}`); }

  _listen(){
    const { onValue } = this.fns;
    onValue(this._path(''), snap => {
      const v = snap.val() || {};
      this.state = {
        events:   Object.entries(v.events  || {}).map(([id, e]) => ({ id, ...e })),
        gcal:     Object.entries(v.gcal    || {}).map(([id, e]) => ({ id, ...e })),
        grocery:  Object.entries(v.grocery || {}).map(([id, g]) => ({ id, ...g })),
        sensors:  v.sensors  || {},
        settings: { ...DEFAULTS, ...(v.settings || {}) },
        meta:     v.meta || {}
      };
      this.subs.forEach(fn => fn(this.state));
    }, err => console.error('Realtime Database read failed:', err));
  }

  subscribe(fn){ this.subs.add(fn); fn(this.state); return () => this.subs.delete(fn); }

  _guard(){
    if (!this.canWrite) throw new Error('This display is paired read-only.');
  }

  // Settings, sensors, and the calendar mirror stay with the owner.
  _guardOwner(){
    if (this.role !== 'owner')
      throw new Error('Only the household owner can change that.');
  }

  async addEvent(e){ this._guard(); await this.fns.push(this._path('events'), e); }
  async updateEvent(id, patch){ this._guard(); await this.fns.update(this._path(`events/${id}`), patch); }
  async removeEvent(id){ this._guard(); await this.fns.remove(this._path(`events/${id}`)); }

  async addGrocery(item){
    this._guard();
    await this.fns.push(this._path('grocery'), { done: false, addedAt: Date.now(), ...item });
  }
  async toggleGrocery(id){
    this._guard();
    const g = this.state.grocery.find(x => x.id === id);
    await this.fns.update(this._path(`grocery/${id}`), { done: !g?.done });
  }
  async updateGrocery(id, patch){ this._guard(); await this.fns.update(this._path(`grocery/${id}`), patch); }
  async removeGrocery(id){ this._guard(); await this.fns.remove(this._path(`grocery/${id}`)); }
  async clearDone(){
    this._guard();
    const updates = {};
    this.state.grocery.filter(g => g.done).forEach(g => { updates[g.id] = null; });
    await this.fns.update(this._path('grocery'), updates);
  }

  /* Replaces the mirror wholesale. Manual events live in `events`
     and are never touched by a calendar sync. */
  async setGcal(list){
    this._guardOwner();
    const out = {};
    list.forEach((e, i) => { out[`g${i}`] = e; });
    await this.fns.set(this._path('gcal'), out);
  }

  async clearAll(){
    this._guard();
    await this.fns.set(this._path('grocery'), null);
  }

  async clearEvents(){
    this._guard();
    await this.fns.set(this._path('events'), null);
  }

  async renameSensor(id, label){
    this._guardOwner();
    await this.fns.update(this._path('settings/sensorLabels'), { [id]: label });
  }
  async saveSettings(patch){ this._guard(); await this.fns.update(this._path('settings'), patch); }
}


/* ══════════════════════════════════════════════════════════════
   Auth + pairing

   A wall panel never types a password. It signs in anonymously,
   shows a 6-character code, and waits. You claim that code from
   your signed-in computer, which writes the panel's UID into your
   household. Anonymous sessions persist across reboots, so the
   panel stays paired until you unpair it.
   ══════════════════════════════════════════════════════════════ */

export const auth = {
  ready: false,
  mode: usingFirebase() ? 'cloud' : 'local',
  user: null,
  role: null,        // 'owner' | 'member' | 'display' | null
  joinError: null,
  householdId: null,
  _fb: null,
  _subs: new Set()
};

function emitAuth(){ auth._subs.forEach(fn => fn(auth)); }
export function onAuth(fn){ auth._subs.add(fn); fn(auth); return () => auth._subs.delete(fn); }

const REQUIRED_CONFIG = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];

function validateConfig(){
  if (typeof FIREBASE_CONFIG !== 'object' || FIREBASE_CONFIG === null){
    throw new Error(
      'config.js does not export FIREBASE_CONFIG.\n\n' +
      'The line must read exactly:\n' +
      '  export const FIREBASE_CONFIG = { ... };\n\n' +
      'If you pasted Google\u2019s snippet, it declares "const firebaseConfig" — ' +
      'that name will not work. Keep the original line and fill in the values.'
    );
  }

  const missing = REQUIRED_CONFIG.filter(k => !FIREBASE_CONFIG[k]);
  if (missing.length){
    throw new Error(
      'config.js is missing these values: ' + missing.join(', ') + '.\n\n' +
      'Copy them from Firebase Console \u2192 Project settings \u2192 Your apps \u2192 ' +
      'the Web app\u2019s config snippet. databaseURL only appears once a Realtime ' +
      'Database exists, and must match the URL in the database viewer.'
    );
  }
}

async function loadFirebase(){
  if (auth._fb) return auth._fb;

  validateConfig();

  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`)
  ]);

  const app = appMod.initializeApp(FIREBASE_CONFIG);
  const a = authMod.getAuth(app);
  await authMod.setPersistence(a, authMod.browserLocalPersistence);

  auth._fb = {
    app, auth: a, db: dbMod.getDatabase(app),
    A: authMod,
    D: dbMod,
    fns: {
      ref: dbMod.ref, onValue: dbMod.onValue, get: dbMod.get,
      set: dbMod.set, update: dbMod.update, remove: dbMod.remove,
      push: dbMod.push, serverTimestamp: dbMod.serverTimestamp
    }
  };
  return auth._fb;
}

/* Called once at boot. Resolves as soon as we know who we are. */
export async function initAuth(){
  if (!usingFirebase()){
    auth.ready = true;
    auth.role = 'owner';
    auth.householdId = 'local';
    emitAuth();
    return auth;
  }

  const fb = await loadFirebase();

  return new Promise(resolve => {
    let settled = false;
    fb.A.onAuthStateChanged(fb.auth, async user => {
      auth.user = user;
      auth.error = null;

      try {

      if (!user){
        auth.role = null;
        auth.householdId = null;
      } else if (user.isAnonymous){
        // A wall panel. Which household claimed it, if any?
        auth.role = 'display';
        auth.householdId = await lookupHousehold(user.uid);
      } else {
        // An invite link may be waiting. Redeem it before we decide
        // whether this person owns a household of their own.
        const pending = takePendingJoin();
        if (pending){
          try { await joinHousehold(pending); }
          catch (err){ auth.joinError = err.message; }
        }

        const memberOf = await lookupMembership(user.uid);
        if (memberOf){
          auth.role = 'member';
          auth.householdId = memberOf;
        } else {
          auth.role = 'owner';
          auth.householdId = user.uid;
          await ensureHousehold(user.uid, user);
        }
      }

      } catch (err){
        // Anything thrown here used to leave the promise unresolved, which
        // showed up as a permanent "Starting up" spinner with no explanation.
        console.error('Auth/database step failed:', err);
        auth.error = err.message;
        auth.role = null;
      }

      auth.ready = true;
      emitAuth();
      if (!settled){ settled = true; resolve(auth); }
    });
  });
}

/* A wrong databaseURL doesn't error — it just never answers. Without a
   deadline the whole app sits on a spinner with nothing to show. */
function withTimeout(promise, ms, what){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      `Timed out after ${ms / 1000}s ${what}.\n\n` +
      'The usual cause is a databaseURL in config.js that points at a database ' +
      'that does not exist — check it against the URL shown in Firebase Console ' +
      '\u2192 Realtime Database, including the region.'
    )), ms))
  ]);
}

async function lookupHousehold(deviceUid){
  const fb = auth._fb;
  const snap = await fb.fns.get(fb.fns.ref(fb.db, `deviceIndex/${deviceUid}`));
  return snap.exists() ? snap.val() : null;
}

/* Keep watching, so a panel flips to the dashboard the moment you pair it. */
export function watchHousehold(deviceUid, cb){
  const fb = auth._fb;
  return fb.fns.onValue(fb.fns.ref(fb.db, `deviceIndex/${deviceUid}`), snap => {
    if (snap.exists()) cb(snap.val());
  });
}

async function lookupMembership(userUid){
  const fb = auth._fb;
  const snap = await withTimeout(
    fb.fns.get(fb.fns.ref(fb.db, `memberIndex/${userUid}`)),
    12000, 'reading the database');
  return snap.exists() ? snap.val() : null;
}

/* An invite code can arrive as ?join=CODE before sign-in, so park it
   somewhere that survives a Google redirect. */
const JOIN_KEY = 'homedash.pendingJoin';

export function setPendingJoin(code){
  try { sessionStorage.setItem(JOIN_KEY, String(code).trim().toUpperCase()); } catch {}
}

function takePendingJoin(){
  try {
    const v = sessionStorage.getItem(JOIN_KEY);
    if (v) sessionStorage.removeItem(JOIN_KEY);
    return v;
  } catch { return null; }
}

export async function peekInvite(code){
  const fb = await loadFirebase();
  const clean = cleanCode(code);
  const snap = await fb.fns.get(fb.fns.ref(fb.db, `invites/${clean}`));
  if (!snap.exists()) throw new Error('That invite code is not valid.');
  const inv = snap.val();
  if (inv.expiresAt && inv.expiresAt < Date.now()) throw new Error('That invite has expired.');
  return { code: clean, ...inv };
}

export async function joinHousehold(code){
  const fb = await loadFirebase();
  const inv = await peekInvite(code);
  const user = fb.auth.currentUser;
  if (!user) throw new Error('Sign in first.');
  if (user.uid === inv.hid) throw new Error('That is your own household.');

  await fb.fns.update(fb.fns.ref(fb.db), {
    [`households/${inv.hid}/members/${user.uid}`]: {
      name: user.displayName || user.email || 'Member',
      joinedAt: Date.now(),
      via: inv.code
    },
    [`memberIndex/${user.uid}`]: inv.hid
  });

  return inv;
}

export async function createInvite(days = 14){
  const fb = await loadFirebase();
  if (auth.role !== 'owner') throw new Error('Only the household owner can invite people.');

  const code = randomCode();
  const rec = {
    hid: auth.householdId,
    createdAt: Date.now(),
    expiresAt: Date.now() + days * 864e5,
    name: auth.user?.displayName || ''
  };

  await fb.fns.update(fb.fns.ref(fb.db), {
    [`invites/${code}`]: rec,
    [`households/${auth.householdId}/invites/${code}`]: { createdAt: rec.createdAt, expiresAt: rec.expiresAt }
  });

  return { code, ...rec };
}

export async function listInvites(){
  const fb = await loadFirebase();
  const snap = await fb.fns.get(fb.fns.ref(fb.db, `households/${auth.householdId}/invites`));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([code, v]) => ({ code, ...v }))
    .filter(i => !i.expiresAt || i.expiresAt > Date.now())
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeInvite(code){
  const fb = await loadFirebase();
  await fb.fns.update(fb.fns.ref(fb.db), {
    [`invites/${code}`]: null,
    [`households/${auth.householdId}/invites/${code}`]: null
  });
}

export async function listMembers(){
  const fb = await loadFirebase();
  const snap = await fb.fns.get(fb.fns.ref(fb.db, `households/${auth.householdId}/members`));
  return snap.exists()
    ? Object.entries(snap.val()).map(([uid, m]) => ({ uid, ...m }))
    : [];
}

export async function removeMember(memberUid){
  const fb = await loadFirebase();
  await fb.fns.update(fb.fns.ref(fb.db), {
    [`households/${auth.householdId}/members/${memberUid}`]: null,
    [`memberIndex/${memberUid}`]: null
  });
}

export async function leaveHousehold(){
  const fb = await loadFirebase();
  const me = fb.auth.currentUser.uid;
  await fb.fns.update(fb.fns.ref(fb.db), {
    [`households/${auth.householdId}/members/${me}`]: null,
    [`memberIndex/${me}`]: null
  });
}

export async function householdName(){
  const fb = await loadFirebase();
  const snap = await fb.fns.get(fb.fns.ref(fb.db, `households/${auth.householdId}/meta/ownerName`));
  return snap.exists() ? snap.val() : 'your household';
}

const cleanCode = c => String(c).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

async function ensureHousehold(hid, user){
  const fb = auth._fb;
  const metaRef = fb.fns.ref(fb.db, `households/${hid}/meta`);
  const snap = await fb.fns.get(metaRef);
  if (!snap.exists()){
    await fb.fns.set(metaRef, {
      owner: hid,
      ownerName: user.displayName || user.email || 'Owner',
      createdAt: Date.now()
    });
    // Start empty. Sample events in a real household are more confusing
    // than helpful — you cannot tell yours from the filler.
    await fb.fns.update(fb.fns.ref(fb.db, `households/${hid}`), {
      settings: { ...DEFAULTS }
    });
  }
}

export async function signInWithGoogle(){
  const fb = await loadFirebase();
  const provider = new fb.A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await fb.A.signInWithPopup(fb.auth, provider);
  } catch (err){
    // Popups get blocked in kiosk shells and some in-app browsers.
    if (['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/popup-closed-by-user']
        .includes(err.code)){
      await fb.A.signInWithRedirect(fb.auth, provider);
    } else {
      throw err;
    }
  }
}

export async function signOutNow(){
  const fb = await loadFirebase();
  await fb.A.signOut(fb.auth);
}

/* ── Display side: sign in anonymously and publish a pairing code ── */
export async function startPairing(){
  const fb = await loadFirebase();

  if (!fb.auth.currentUser){
    try {
      await fb.A.signInAnonymously(fb.auth);
    } catch (err){
      if (err.code === 'auth/operation-not-allowed'){
        throw new Error(
          'Anonymous sign-in is turned off for this Firebase project.\n\n' +
          'A keyboard-less display uses it to identify itself before you pair it.\n\n' +
          'Firebase Console \u2192 Authentication \u2192 Sign-in method \u2192 Anonymous \u2192 Enable.'
        );
      }
      if (err.code === 'auth/unauthorized-domain'){
        throw new Error(
          `This address (${location.hostname}) is not authorized for sign-in.\n\n` +
          'Firebase Console \u2192 Authentication \u2192 Settings \u2192 Authorized domains \u2192 Add domain.'
        );
      }
      throw err;
    }
  }

  const deviceUid = fb.auth.currentUser.uid;

  const code = randomCode();
  await fb.fns.set(fb.fns.ref(fb.db, `pairing/${code}`), {
    deviceUid,
    createdAt: Date.now(),
    name: guessDeviceName()
  });

  return { code, deviceUid };
}

/* ── Owner side: type the code shown on the panel ── */
export async function claimPairing(code){
  const fb = await loadFirebase();
  const clean = cleanCode(code);
  const pRef = fb.fns.ref(fb.db, `pairing/${clean}`);
  const snap = await fb.fns.get(pRef);
  if (!snap.exists()) throw new Error('That code is not active. Check the screen and try again.');

  const { deviceUid, name } = snap.val();
  const hid = auth.householdId;

  await fb.fns.update(fb.fns.ref(fb.db), {
    [`households/${hid}/devices/${deviceUid}`]: { name: name || 'Display', pairedAt: Date.now() },
    [`deviceIndex/${deviceUid}`]: hid,
    [`pairing/${clean}`]: null
  });

  return { deviceUid, name };
}

export async function listDevices(){
  const fb = await loadFirebase();
  const snap = await fb.fns.get(fb.fns.ref(fb.db, `households/${auth.householdId}/devices`));
  return snap.exists() ? Object.entries(snap.val()).map(([uid, d]) => ({ uid, ...d })) : [];
}

export async function unpairDevice(deviceUid){
  const fb = await loadFirebase();
  await fb.fns.update(fb.fns.ref(fb.db), {
    [`households/${auth.householdId}/devices/${deviceUid}`]: null,
    [`deviceIndex/${deviceUid}`]: null
  });
}

function randomCode(){
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I/L/O/0/1
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function guessDeviceName(){
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android display';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'Display';
}


/* ══════════════════════════════════════════════════════════════
   Store factory
   ══════════════════════════════════════════════════════════════ */

export async function makeStore(){
  if (!usingFirebase()) return new LocalStore();
  const fb = await loadFirebase();
  return new CloudStore(fb.db, fb.fns, auth.householdId, auth.role);
}


/* ══════════════════════════════════════════════════════════════
   Weather — Open-Meteo, no API key needed
   ══════════════════════════════════════════════════════════════ */

const WMO = code => {
  if (code === 0) return { icon: 'clear',  cond: 'Clear' };
  if (code <= 2)  return { icon: 'partly', cond: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud',  cond: 'Overcast' };
  if (code <= 48) return { icon: 'cloud',  cond: 'Fog' };
  if (code <= 57) return { icon: 'rain',   cond: 'Drizzle' };
  if (code <= 67) return { icon: 'rain',   cond: 'Rain' };
  if (code <= 77) return { icon: 'cloud',  cond: 'Snow' };
  if (code <= 82) return { icon: 'rain',   cond: 'Showers' };
  if (code <= 86) return { icon: 'cloud',  cond: 'Snow showers' };
  return { icon: 'storm', cond: 'Thunderstorms' };
};

export async function fetchWeather(settings){
  const unit = settings.units === 'C' ? 'celsius' : 'fahrenheit';
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${settings.lat}&longitude=${settings.lon}`
    + `&current=temperature_2m,apparent_temperature,weather_code`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min`
    + `&temperature_unit=${unit}&timezone=auto&forecast_days=3`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const j = await res.json();

  const nowMeta = WMO(j.current.weather_code);
  const names = ['Today', 'Tomorrow'];

  return {
    now: {
      temp:  j.current.temperature_2m,
      feels: j.current.apparent_temperature,
      cond:  nowMeta.cond,
      icon:  nowMeta.icon
    },
    days: j.daily.time.slice(0, 3).map((t, i) => ({
      day: names[i] || new Date(t + 'T12:00:00')
        .toLocaleDateString(undefined, { weekday: 'short' }),
      hi:   j.daily.temperature_2m_max[i],
      lo:   j.daily.temperature_2m_min[i],
      icon: WMO(j.daily.weather_code[i]).icon
    }))
  };
}

/* ══════════════════════════════════════════════════════════════
   Grocery from a published Google Sheet

   File → Share → Publish to web → CSV. No API key, no auth, works
   on a wall panel that has never signed into anything.
   ══════════════════════════════════════════════════════════════ */

function parseCsv(text){
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quoted){
      if (ch === '"'){
        if (text[i+1] === '"'){ field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"'){ quoted = true; }
    else if (ch === ','){ row.push(field); field = ''; }
    else if (ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r'){ field += ch; }
  }
  if (field || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const truthy = v => ['x','yes','true','done','1','✓','y'].includes(String(v).trim().toLowerCase());

export async function fetchSheetGrocery(){
  const url = GROCERY.publishedCsvUrl;
  if (!url) throw new Error('No published sheet URL set in config.js.');

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet returned ${res.status}. Is it still published to the web?`);

  const rows = parseCsv(await res.text());
  if (!rows.length) return [];

  // Skip a header row if the first cell looks like a label
  const head = rows[0].map(c => c.trim().toLowerCase());
  const body = ['item','name','grocery','thing'].includes(head[0]) ? rows.slice(1) : rows;

  return body.map((r, i) => ({
    id:   `sheet-${i}`,
    name: (r[0] || '').trim(),
    qty:  (r[1] || '').trim(),
    done: truthy(r[2]),
    addedAt: i
  })).filter(g => g.name);
}

/* ══════════════════════════════════════════════════════════════
   Place search

   Open-Meteo's geocoder — no API key, same service the forecast
   comes from, so a place it finds is always one it can forecast.
   ══════════════════════════════════════════════════════════════ */

export async function geocodePlace(query){
  const q = String(query || '').trim();
  if (!q) return [];

  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Place search failed (${res.status}). Check your connection.`);

  const results = (await res.json()).results || [];

  return results.map(r => {
    // "San Jose, California, US" reads better than a bare city name when
    // several places share it.
    const parts = [r.name, r.admin1, r.country_code || r.country].filter(Boolean);
    const seen = new Set();
    const label = parts.filter(p => {
      const k = p.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(', ');

    return {
      label,
      latitude:  r.latitude,
      longitude: r.longitude,
      timezone:  r.timezone,
      population: r.population || 0
    };
  });
}

export function fallbackWeather(){
  return {
    now: { temp: 88, feels: 97, cond: 'No weather data', icon: 'cloud' },
    days: [0,1,2].map(i => ({
      day: ['Today','Tomorrow','—'][i],
      hi: 90, lo: 76, icon: 'cloud'
    }))
  };
}

export { SENSORS };
