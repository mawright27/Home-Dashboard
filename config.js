import { firebaseConfig } from './firebase-config.js';

/* ══════════════════════════════════════════════════════════════
   config.js — dashboard settings

   Your Firebase keys are NOT here — they live in
   firebase-config.js, which never gets overwritten by an update.

   With that file blank, the dashboard runs in LOCAL MODE: fully
   interactive, data saved in this browser only. Filled in, the
   same UI switches to Firebase + Google Sign-In.
   ══════════════════════════════════════════════════════════════ */

/* ── Your Firebase keys live in firebase-config.js ──────────────
   They are kept in a separate file on purpose: this file changes
   whenever the dashboard gains a feature, and your credentials
   should never be caught in the crossfire. Edit that file, not
   this one. It is safe to commit — Firebase web config is public
   by design.
   ───────────────────────────────────────────────────────────── */

export const FIREBASE_CONFIG = firebaseConfig;

/* If `databaseURL` is missing from the snippet Firebase gave you, it means
   the Realtime Database had not been created when that app was registered.
   Create it, then copy the URL from the top of the database viewer and add
   the line by hand. It must match FIREBASE_DATABASE_URL in .env. */

export const usingFirebase = () =>
  Boolean(FIREBASE_CONFIG?.apiKey && FIREBASE_CONFIG?.databaseURL);

/* ── Google Calendar ────────────────────────────────────────────
   Your OAuth client ID is safe to keep here — web client IDs are
   public by design. The client *secret* is not, and this browser
   flow never needs one.

   Before this works, in Google Cloud Console → Credentials → your
   OAuth client, add your dashboard's origin (e.g. http://localhost:8080)
   to "Authorized JavaScript origins". Then enable the Google Calendar
   API for the project.
   ───────────────────────────────────────────────────────────── */
export const CALENDAR = {
  clientId: '733688950525-hfb4afl7d88frvq7kvlhig112uvf0f5r.apps.googleusercontent.com',
  scope:    'https://www.googleapis.com/auth/calendar.readonly',

  /* Browser-side calendar sync. OFF by default.

     The GitHub Action is the sync agent — it runs on a schedule with no
     browser involved, which is the whole point. This flag only controls
     an optional "pull now from this page" button.

     It requires a **Web application** OAuth client with this page's exact
     origin listed under Authorized JavaScript origins. A **Desktop app**
     client — the kind normally used to mint a refresh token from a script —
     has no such field and cannot do browser sign-in at all. With one of
     those you get "no registered origin / 401 invalid_client" no matter
     what you add in the console.

     Leave this false unless you have a Web client set up for it. */
  browserSync: false,

  // 'primary' is your main calendar. Add more by ID (Calendar settings
  // → Integrate calendar → Calendar ID) and give each an accent color.
  calendars: [
    { id: 'primary', tone: 'cool' }
  ],

  daysBack:    7,      // how far back to mirror
  daysAhead:   35,     // must cover the 4-week grid
  syncEveryMs: 10 * 60 * 1000
};


/* ── Grocery source ─────────────────────────────────────────────
   'builtin'  the dashboard's own list — editable here and from any
              signed-in browser, including your phone. Nothing else
              to set up.
   'sheet'    a published Google Sheet. Read-only on the dashboard,
              edited in the Sheets app. Set publishedCsvUrl below.
   ───────────────────────────────────────────────────────────── */
export const GROCERY = {
  source: 'builtin',

  // File → Share → Publish to web → pick the sheet → CSV → copy the link.
  // Columns, with a header row: item | qty | done
  publishedCsvUrl: '',

  refreshMs: 2 * 60 * 1000
};


export const DEFAULTS = {
  refreshMs:       2 * 60 * 1000,
  place:           'Tampa, FL',
  lat:             27.9506,
  lon:             -82.4572,
  units:           'F',            // 'F' | 'C'
  weekStartsOn:    0,              // 0 Sunday, 1 Monday
  weeks:           4,
  maxEventsPerDay: 3,
  maxGroceryItems: 16,
  dayStartHour:    5,
  dayEndHour:      23,
  staleMinutes:    20,
  burnInMs:        15 * 60 * 1000
};

/* Sensor tiles. `id` is the Firebase key each ESP32 writes to:
   households/<householdId>/sensors/<id> = { value, unit, updated } */
export const SENSORS = [
  { id: 'pool',   label: 'Pool Temp',  kind: 'temp',  unit: '°F' },
  { id: 'garage', label: 'Garage',     kind: 'state', openWord: 'OPEN', shutWord: 'CLOSED' },
  { id: 'house',  label: 'House Temp', kind: 'temp',  unit: '°F' }
];
