#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   sync-calendar.mjs — Google Calendar → Firebase, unattended

   This is what removes the one-hour limit. A refresh token doesn't
   expire on a schedule, so this script can mint a fresh access
   token every time it runs, forever, with no browser open anywhere.

   Runs in GitHub Actions on a cron. Also runs locally:

     node scripts/sync-calendar.mjs --dry-run

   Zero npm dependencies — Node 18+ has fetch and crypto built in.
   ══════════════════════════════════════════════════════════════ */

import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── Load .env if it's there ──────────────────────────────────
   Saves you from remembering `source .env` on a Mac or the
   PowerShell equivalent on Windows. Real environment variables
   always win, which is what GitHub Actions relies on.
   ──────────────────────────────────────────────────────────── */
(function loadDotEnv(){
  const here = dirname(fileURLToPath(import.meta.url));

  // Look next to the script, one level up, and in whatever folder you
  // ran the command from — so a flat layout works as well as scripts/.
  const path = [
    join(here, '.env'),
    join(here, '..', '.env'),
    join(process.cwd(), '.env')
  ].find(p => existsSync(p));

  if (!path){
    console.log('No .env file found — using environment variables only.');
    return;
  }

  for (let line of readFileSync(path, 'utf8').split('\n')){
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    // Strip matching quotes, and honour \n inside them (service account keys)
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))){
      val = val.slice(1, -1);
      if (line[eq + 1] === '"') val = val.replace(/\\n/g, '\n');
    }

    if (val && process.env[key] === undefined) process.env[key] = val;
  }
  console.log(`Loaded settings from ${path}`);
})();

if (typeof fetch !== 'function'){
  console.error(
    'This needs Node 18 or newer (your version: ' + process.version + ').\n' +
    'Download the current LTS from https://nodejs.org and run this again.'
  );
  process.exitCode = 1;
}

const KNOWN_FLAGS = [
  '--dry-run', '--list-calendars', '--list-households', '--verbose', '--help', '-h'
];

const args = process.argv.slice(2);
const unknown = args.filter(a => a.startsWith('-') && !KNOWN_FLAGS.includes(a));

if (unknown.length){
  // Silently ignoring a flag would be dangerous here: ask for --dry-run on a
  // build that doesn't have it and you'd get a real write instead.
  console.error(`Unrecognized option: ${unknown.join(', ')}`);
  console.error('This is usually an out-of-date copy of the script. Known options:');
  KNOWN_FLAGS.forEach(f => console.error('  ' + f));
  process.exitCode = 1;
}

const HELP = args.includes('--help') || args.includes('-h');
const DRY  = args.includes('--dry-run');
const LIST = args.includes('--list-calendars');
const HOUSES = args.includes('--list-households');
const VERBOSE = args.includes('--verbose') || DRY || LIST || HOUSES;

if (HELP){
  console.log(`
Google Calendar → Firebase sync

  node scripts/sync-calendar.mjs [options]

  (no options)        Fetch events and write them to Firebase.
  --dry-run           Print the events, write nothing. Needs only the
                      three GOOGLE_* settings.
  --list-calendars    Show every calendar this account can see, with
                      event counts, so you can pick which to sync.
  --list-households   Show the household IDs already in your database,
                      for filling in FIREBASE_HOUSEHOLD_ID.
  --verbose           Extra logging.
  --help              This.

Settings come from .env beside the script or in the project root, or
from real environment variables (which is how GitHub Actions supplies
them). See .env.example.
`);
  process.exitCode = 0;
}

const env = k => process.env[k];

/* ── Config from environment ─────────────────────────────────── */

const CFG = {
  clientId:     env('GOOGLE_CLIENT_ID'),
  clientSecret: env('GOOGLE_CLIENT_SECRET'),
  refreshToken: env('GOOGLE_REFRESH_TOKEN'),

  databaseUrl:  (env('FIREBASE_DATABASE_URL') || '').replace(/\/$/, ''),
  householdId:  env('FIREBASE_HOUSEHOLD_ID'),

  // Pick ONE of these for write access:
  serviceAccount: env('FIREBASE_SERVICE_ACCOUNT'),   // full JSON, preferred
  databaseSecret: env('FIREBASE_DATABASE_SECRET'),   // legacy, simpler

  calendars: (env('CALENDAR_IDS') || 'primary')
    .split(',').map(s => s.trim()).filter(Boolean),
  tones: (env('CALENDAR_TONES') || 'cool')
    .split(',').map(s => s.trim()).filter(Boolean),

  timeZone:  env('HOUSEHOLD_TZ') || 'America/New_York',
  daysBack:  Number(env('DAYS_BACK')  || 7),
  daysAhead: Number(env('DAYS_AHEAD') || 35)
};

function requireEnv(keys){
  const missing = keys.filter(k => !CFG[k]);
  if (missing.length){
    console.error('Missing required settings: ' + missing.join(', '));
    console.error('Set them as GitHub repository secrets, or put them in .env locally.');
    process.exitCode = 1;
    throw new Error('missing configuration');
  }
}

const log = (...a) => VERBOSE && console.log(...a);

/* Realtime Database keys cannot contain . $ # [ ] or /, and calendar IDs
   are full of them. base64url gives a stable, reversible key. */
const calKey = id => Buffer.from(String(id), 'utf8').toString('base64url');

/* Shows enough of a credential to identify it, never enough to use it. */
function fingerprint(v){
  if (!v) return 'MISSING';
  const s = String(v);
  return `${s.slice(0, 7)}… (${s.length} chars)`;
}

/* Google's own errors are famously vague, so check the obvious
   paste mistakes here where we can name them precisely. */
function preflight(){
  const notes = [];

  if (!CFG.clientId?.endsWith('.apps.googleusercontent.com'))
    notes.push('GOOGLE_CLIENT_ID does not end in .apps.googleusercontent.com — it looks truncated or wrong.');

  if (!CFG.clientSecret)
    notes.push('GOOGLE_CLIENT_SECRET is empty.');
  else if (!/^GOCSPX-/.test(CFG.clientSecret) && CFG.clientSecret.length < 20)
    notes.push('GOOGLE_CLIENT_SECRET looks too short. A current one starts with "GOCSPX-".');

  if (!CFG.refreshToken)
    notes.push('GOOGLE_REFRESH_TOKEN is empty.');
  else if (!CFG.refreshToken.startsWith('1//'))
    notes.push('GOOGLE_REFRESH_TOKEN does not start with "1//". You may have pasted an *access* token (starts "ya29.") instead — those last an hour and are not what this needs.');

  if (notes.length){
    console.error('\nSomething looks off before we even call Google:\n');
    notes.forEach(n => console.error('  • ' + n));
    console.error('');
  }
}


/* ══════════════════════════════════════════════════════════════
   1. Google access token from the refresh token
   ══════════════════════════════════════════════════════════════ */

async function googleAccessToken(){
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CFG.clientId,
      client_secret: CFG.clientSecret,
      refresh_token: CFG.refreshToken,
      grant_type:    'refresh_token'
    })
  });

  const raw = await res.text();
  let body = {};
  try { body = JSON.parse(raw); } catch {}

  if (!res.ok){
    // These are the two failures worth naming explicitly, because the
    // raw error text doesn't tell you what to actually do about it.
    if (body.error === 'invalid_grant'){
      console.error(
        'Google rejected the refresh token (invalid_grant).\n' +
        'Usual causes: the OAuth consent screen is still in "Testing" mode\n' +
        '(tokens expire after 7 days — publish the app to Production), the\n' +
        'token was revoked, or the Google account password changed.\n' +
        'Fix: generate a fresh refresh token and update the secret.'
      );
    } else if (res.status === 401 || body.error === 'invalid_client'){
      console.error(
        'Google rejected the client credentials (401 / invalid_client).\n' +
        '\nWhat this error does NOT mean: your refresh token is fine. A dead\n' +
        'refresh token returns 400 invalid_grant, not 401. This is about the\n' +
        'client ID and secret pair.\n' +
        '\nUsing:\n' +
        `  client_id     ${CFG.clientId || 'MISSING'}\n` +
        `  client_secret ${fingerprint(CFG.clientSecret)}\n` +
        `  refresh_token ${fingerprint(CFG.refreshToken)}\n` +
        '\nIn order of likelihood:\n' +
        '  1. The client secret does not belong to that client ID. In Cloud\n' +
        '     Console → Credentials, open THIS client and copy its secret.\n' +
        '     A secret from a different OAuth client fails exactly like this.\n' +
        '  2. The refresh token was minted under a different OAuth client.\n' +
        '     A refresh token is bound to the client that created it — if you\n' +
        '     generated it with the OAuth Playground or another client ID, it\n' +
        '     will not work here. Regenerate it using this client.\n' +
        '  3. The client is a "Desktop app" but you are sending a Web client\n' +
        '     ID, or vice versa. The types are not interchangeable.\n' +
        '  4. Stray quotes or spaces in .env around either value.'
      );
    }
    throw new Error(
      `Token exchange failed (${res.status}): ` +
      (body.error_description || body.error || raw.slice(0, 200) || 'no detail returned'));
  }

  log(`Got a Google access token, good for ${body.expires_in}s.`);
  return body.access_token;
}


/* ══════════════════════════════════════════════════════════════
   2. Fetch and normalize events

   Dates are resolved in the household's timezone, not the runner's.
   GitHub's runners are UTC, so without this a 9pm Tampa event would
   land on tomorrow's square.
   ══════════════════════════════════════════════════════════════ */

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CFG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: CFG.timeZone, hour: '2-digit', minute: '2-digit', hour12: false
});

function normalize(e, calKeyValue){
  const base = {
    title: e.summary || '(no title)',
    cal:   calKeyValue,      // which calendar it came from
    tone:  'cool',           // the dashboard overrides this per calendar
    src:   'gcal'
  };

  if (e.start?.date) return { ...base, date: e.start.date, time: null };

  const d = new Date(e.start.dateTime);
  return {
    ...base,
    date: dateFmt.format(d),          // en-CA gives YYYY-MM-DD
    time: timeFmt.format(d)           // en-GB h23 gives HH:MM
  };
}

async function fetchCalendar(cal, token, timeMin, timeMax){
  const calId = typeof cal === 'string' ? cal : cal.id;
  const key   = typeof cal === 'string' ? calKey(cal) : cal.key;

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`);
  url.search = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: 'true',              // expand recurring events into instances
    orderBy: 'startTime',
    maxResults: '250'
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok){
    const text = await res.text().catch(() => '');
    if (res.status === 404){
      console.warn(`Calendar "${calId}" not found. Check the ID, and that this Google account can see it.`);
      return [];
    }
    if (res.status === 403 && text.includes('accessNotConfigured')){
      throw new Error('The Google Calendar API is not enabled for this project. Enable it in the Cloud Console.');
    }
    throw new Error(`Calendar "${calId}" returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const items = (await res.json()).items || [];
  return items
    .filter(e => e.status !== 'cancelled' && (e.start?.date || e.start?.dateTime))
    .map(e => normalize(e, key));
}

/* Every calendar this account can see, with a rough event count for
   the sync window. Answers "which one actually has my schedule in it". */
async function listCalendars(token){
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
    { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok){
    const text = await res.text().catch(() => '');
    throw new Error(`Could not list calendars (${res.status}): ${text.slice(0, 200)}`);
  }

  const items = (await res.json()).items || [];
  const now = Date.now();
  const timeMin = new Date(now - CFG.daysBack  * 864e5).toISOString();
  const timeMax = new Date(now + CFG.daysAhead * 864e5).toISOString();

  console.log(`\nThis account can see ${items.length} calendar${items.length === 1 ? '' : 's'}.`);
  console.log(`Event counts are for the sync window (${CFG.daysBack}d back, ${CFG.daysAhead}d ahead).\n`);

  for (const cal of items){
    let count = '?';
    try {
      const evs = await fetchCalendar(cal.id, token, 'cool', timeMin, timeMax);
      count = String(evs.length);
    } catch { count = 'error' }

    const flags = [
      cal.primary ? 'PRIMARY' : null,
      cal.accessRole === 'reader' ? 'read-only' : null
    ].filter(Boolean).join(', ');

    console.log(`  ${count.padStart(4)} events  ${cal.summary}${flags ? `  [${flags}]` : ''}`);
    console.log(`              id: ${cal.id}`);
  }

  console.log(
    '\nTo sync more than the primary calendar, list the IDs you want:\n' +
    '  .env               CALENDAR_IDS=primary,other@group.calendar.google.com\n' +
    '  GitHub             repo Settings → Variables → CALENDAR_IDS\n' +
    '  Optionally pair with CALENDAR_TONES=cool,warm  (accent color per calendar)\n'
  );
}

/* The full set this account can see, in the shape the dashboard needs. */
async function getCalendarList(token){
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
    { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok){
    const text = await res.text().catch(() => '');
    throw new Error(`Could not list calendars (${res.status}): ${text.slice(0, 200)}`);
  }

  return ((await res.json()).items || []).map(c => ({
    id:      c.id,
    key:     calKey(c.id),
    name:    c.summary || c.id,
    primary: Boolean(c.primary)
  }));
}

async function fetchAllEvents(token, cals){
  const now = Date.now();
  const timeMin = new Date(now - CFG.daysBack  * 864e5).toISOString();
  const timeMax = new Date(now + CFG.daysAhead * 864e5).toISOString();

  // Everything is mirrored; the dashboard decides what to show. That makes
  // toggling a calendar on or off instant instead of a 15-minute wait.
  const batches = await Promise.all(
    cals.map(c => fetchCalendar(c, token, timeMin, timeMax))
  );

  const all = batches.flat();
  all.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  return all;
}


/* ══════════════════════════════════════════════════════════════
   3. Firebase write access

   Preferred: a service account, signed into an OAuth token.
   Fallback: the legacy database secret, which is one string and
   needs no JWT dance — deprecated by Google but still works.
   ══════════════════════════════════════════════════════════════ */

async function firebaseAuthQuery(){
  if (CFG.serviceAccount){
    const token = await serviceAccountToken();
    return `access_token=${encodeURIComponent(token)}`;
  }
  if (CFG.databaseSecret){
    return `auth=${encodeURIComponent(CFG.databaseSecret)}`;
  }
  throw new Error('No Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_SECRET.');
}

async function serviceAccountToken(){
  let sa;
  try {
    sa = JSON.parse(CFG.serviceAccount);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole downloaded key file.');
  }
  if (!sa.client_email || !sa.private_key){
    throw new Error('That service account JSON is missing client_email or private_key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database ' +
           'https://www.googleapis.com/auth/userinfo.email',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  });

  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  `${unsigned}.${signature}`
    })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firebase token exchange failed: ${body.error_description || body.error}`);

  log('Signed in to Firebase as the service account.');
  return body.access_token;
}


/* ══════════════════════════════════════════════════════════════
   4. Write the mirror
   ══════════════════════════════════════════════════════════════ */

async function writeMirror(events, cals){
  const authQuery = await firebaseAuthQuery();
  const base = `${CFG.databaseUrl}/households/${CFG.householdId}`;

  // Keyed object, since the Realtime Database has no real arrays.
  const payload = {};
  events.forEach((e, i) => { payload[`g${String(i).padStart(4, '0')}`] = e; });

  const put = async (path, data) => {
    const res = await fetch(`${base}/${path}.json?${authQuery}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok){
      const text = await res.text().catch(() => '');
      if (res.status === 404){
        console.error('\n' + explainDatabase404());
        throw new Error('database not found at that URL');
      }
      if (res.status === 401 || res.status === 403){
        throw new Error(
          `Firebase rejected the write to ${path} (${res.status}).\n` +
          'If you used a service account, confirm it belongs to this same project.\n' +
          'If you used a database secret, confirm it is still listed under\n' +
          'Project Settings → Service accounts → Database secrets.'
        );
      }
      throw new Error(`Write to ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
  };

  await put('gcal', payload);

  // What the settings panel lists as available to switch on and off.
  const catalog = {};
  for (const c of cals) catalog[c.key] = { id: c.id, name: c.name, primary: c.primary };
  await put('meta/calendars', catalog);

  await put('meta/calendarSync', {
    at: Date.now(),
    count: events.length,
    by: process.env.GITHUB_ACTIONS ? 'github-actions' : 'manual'
  });
}


function explainDatabase404(){
  return (
    'The Realtime Database URL returned 404, which means no database exists\n' +
    'at that address. The service account authenticated fine, so the project\n' +
    'is real — this is specifically the database.\n' +
    '\nUsing: ' + CFG.databaseUrl + '\n' +
    '\nTwo likely causes:\n' +
    '\n  1. No Realtime Database has been created yet. Firebase Console →\n' +
    '     Build → Realtime Database. If it shows a "Create Database" button,\n' +
    '     that is the problem. Note this is a DIFFERENT product from Cloud\n' +
    '     Firestore — the console pushes Firestore first, and creating one\n' +
    '     does not create the other. This project needs Realtime Database.\n' +
    '\n  2. The URL is right in shape but wrong in region. Databases outside\n' +
    '     us-central1 live on a different host:\n' +
    '       us-central1   https://<project>-default-rtdb.firebaseio.com\n' +
    '       other regions https://<project>-default-rtdb.<region>.firebasedatabase.app\n' +
    '\n     Copy the exact URL from the top of the Realtime Database data\n' +
    '     viewer in the console and paste it into FIREBASE_DATABASE_URL.\n' +
    '\nAn existing but empty database returns null, not 404 — so this is not\n' +
    'a "nothing has signed in yet" situation.'
  );
}

/* Answers "what do I put in FIREBASE_HOUSEHOLD_ID" without a hunt
   through the Firebase console. */
async function listHouseholds(){
  const authQuery = await firebaseAuthQuery();
  const res = await fetch(`${CFG.databaseUrl}/households.json?shallow=true&${authQuery}`);

  if (!res.ok){
    if (res.status === 404){
      console.error('\n' + explainDatabase404());
      throw new Error('database not found at that URL');
    }
    const text = await res.text().catch(() => '');
    throw new Error(`Could not read the database (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const ids = data ? Object.keys(data) : [];

  if (!ids.length){
    console.log(
      '\nNo households exist in this database yet.\n' +
      'A household is created the first time you sign in to the dashboard\n' +
      'with Google. Open index.html, sign in, then run this again.'
    );
    return;
  }

  console.log(`\nFound ${ids.length} household${ids.length === 1 ? '' : 's'}:\n`);
  for (const id of ids){
    let who = '';
    try {
      const m = await fetch(`${CFG.databaseUrl}/households/${id}/meta/ownerName.json?${authQuery}`);
      if (m.ok){
        const name = await m.json();
        if (name) who = `  (${name})`;
      }
    } catch {}
    console.log(`  ${id}${who}`);
  }

  console.log(
    ids.length === 1
      ? `\nPut that in .env:\n  FIREBASE_HOUSEHOLD_ID=${ids[0]}\n`
      : '\nUse the one matching your own Google account.\n'
  );
}


/* ══════════════════════════════════════════════════════════════
   Main
   ══════════════════════════════════════════════════════════════ */

async function main(){
  if (HELP || unknown.length) return;

  // Listing households only touches Firebase, never Google.
  if (HOUSES){
    requireEnv(['databaseUrl']);
    await listHouseholds();
    return;
  }

  requireEnv(['clientId', 'clientSecret', 'refreshToken']);
  if (!DRY && !LIST) requireEnv(['databaseUrl', 'householdId']);

  preflight();

  log(`Calendars: ${CFG.calendars.join(', ')}`);
  log(`Window: ${CFG.daysBack} days back, ${CFG.daysAhead} ahead, in ${CFG.timeZone}`);

  const token = await googleAccessToken();

  if (LIST){
    await listCalendars(token);
    return;
  }

  const cals = await getCalendarList(token);
  log(`Found ${cals.length} calendar${cals.length === 1 ? '' : 's'}: ${cals.map(c => c.name).join(', ')}`);

  if (process.env.CALENDAR_IDS){
    console.log(
      'Note: CALENDAR_IDS is set but no longer selects calendars. All of them\n' +
      '      are mirrored now, and which ones appear is chosen in the dashboard\n' +
      '      settings panel. You can remove that variable.');
  }

  const events = await fetchAllEvents(token, cals);

  console.log(`Fetched ${events.length} events across ${cals.length} calendars.`);



  if (DRY){
    // The point of a dry run is seeing your real events, so print them.
    const byDate = {};
    for (const e of events) (byDate[e.date] ||= []).push(e);
    for (const date of Object.keys(byDate).sort()){
      console.log(`\n  ${date}`);
      for (const e of byDate[date]){
        const from = cals.find(c => c.key === e.cal);
        console.log(`    ${(e.time || 'all day').padEnd(8)} ${e.title}` +
          (from && !from.primary ? `   [${from.name}]` : ''));
      }
    }
    console.log('\nDry run — nothing was written to Firebase.');
    return;
  }

  await writeMirror(events, cals);
  console.log(`Mirrored to households/${CFG.householdId}/gcal at ${new Date().toISOString()}.`);
}

main().catch(err => {
  if (err.message !== 'missing configuration' && err.message !== 'database not found at that URL')
    console.error('\nSync failed: ' + err.message);
  // Setting exitCode rather than calling process.exit() avoids a libuv
  // assertion crash on Windows when a fetch socket is still closing.
  process.exitCode = 1;
});
