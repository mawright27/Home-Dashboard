/* ══════════════════════════════════════════════════════════════
   calendar.js — Google Calendar → dashboard

   Runs on your computer only. It holds a Calendar access token,
   pulls events, and mirrors them into the household's `gcal` node
   so the wall panels can read them without any Google login of
   their own.

   Tokens from this browser flow last about an hour and there is no
   refresh token, by design. After the first consent, renewals are
   silent as long as your Google session is alive; if it isn't,
   the account panel shows a Reconnect button.
   ══════════════════════════════════════════════════════════════ */

import { CALENDAR } from './config.js';

const GIS = 'https://accounts.google.com/gsi/client';

let gisReady = null;
let tokenClient = null;
let token = null;
let tokenExpiry = 0;

export const calendarState = { connected: false, lastSync: null, error: null };

function loadGis(){
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google Identity Services.'));
    document.head.appendChild(s);
  });
  return gisReady;
}

/* Both a client ID and explicit opt-in. Without the second, nothing here
   ever contacts Google — no popup, no error page, no surprise on load. */
export function calendarConfigured(){
  return Boolean(CALENDAR.clientId && CALENDAR.browserSync);
}

async function ensureTokenClient(){
  await loadGis();
  if (!tokenClient){
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CALENDAR.clientId,
      scope: CALENDAR.scope,
      callback: () => {},         // replaced per request below
      error_callback: err => console.warn('Google token client:', err)
    });
  }
  return tokenClient;
}

/* interactive = true shows the consent/account picker.
   interactive = false tries to renew silently and fails fast. */
export function getToken(interactive = false){
  if (token && Date.now() < tokenExpiry - 60000) return Promise.resolve(token);

  return ensureTokenClient().then(client => new Promise((resolve, reject) => {
    client.callback = res => {
      if (res.error){
        calendarState.error = res.error;
        return reject(new Error(explainTokenError(res)));
      }
      token = res.access_token;
      tokenExpiry = Date.now() + (Number(res.expires_in || 3600) * 1000);
      calendarState.connected = true;
      calendarState.error = null;
      resolve(token);
    };
    try {
      client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    } catch (err){ reject(err); }
  }));
}

/* Google's wording here is famously unhelpful, and the fix is never
   obvious from the message. */
function explainTokenError(res){
  const code = res.error || '';

  if (code === 'invalid_client' || /origin/i.test(res.error_description || '')){
    return (
      'Google rejected this page\u2019s address (401 invalid_client, ' +
      '"no registered origin").\n\n' +
      `This browser is at ${location.origin}, which is not listed on OAuth ` +
      `client ${CALENDAR.clientId.slice(0, 20)}\u2026\n\n` +
      'Fix: Google Cloud Console \u2192 APIs & Services \u2192 Credentials \u2192 ' +
      'open that client \u2192 Authorized JavaScript origins \u2192 Add URI \u2192 ' +
      `${location.origin} \u2192 Save. Changes can take a few minutes.\n\n` +
      'Note that http://localhost and http://127.0.0.1 count as different ' +
      'origins, as does each port number.\n\n' +
      'You can also just skip this — the GitHub Action syncs your calendar ' +
      'without needing the browser at all.'
    );
  }

  if (code === 'access_denied')
    return 'You declined the calendar permission, or the app is in Testing mode and this account is not a listed test user.';

  if (code === 'popup_closed_by_user' || code === 'popup_closed')
    return 'The Google window was closed before finishing.';

  return res.error_description || code || 'Unknown error from Google.';
}

export function disconnectCalendar(){
  if (token && window.google?.accounts?.oauth2)
    google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExpiry = 0;
  calendarState.connected = false;
}

/* ── Fetch and normalize ─────────────────────────────────────── */

const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function normalize(e, tone){
  const allDay = Boolean(e.start?.date);
  if (allDay){
    return { date: e.start.date, time: null, title: e.summary || '(no title)', tone, src: 'gcal' };
  }
  const d = new Date(e.start.dateTime);
  return {
    date:  localDate(d),
    time:  `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    title: e.summary || '(no title)',
    tone,
    src:   'gcal'
  };
}

async function fetchOne(calId, tok, timeMin, timeMax){
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`);
  url.search = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: 'true',        // expands recurring events into instances
    orderBy: 'startTime',
    maxResults: '250'
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (res.status === 401){ token = null; throw new Error('Calendar token expired.'); }
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error(`Calendar "${calId}" returned ${res.status}. ${body.slice(0, 140)}`);
  }
  return (await res.json()).items || [];
}

export async function fetchEvents({ interactive = false } = {}){
  const tok = await getToken(interactive);

  const now = new Date();
  const timeMin = new Date(now.getTime() - CALENDAR.daysBack  * 864e5).toISOString();
  const timeMax = new Date(now.getTime() + CALENDAR.daysAhead * 864e5).toISOString();

  const batches = await Promise.all(
    CALENDAR.calendars.map(async cal => {
      try {
        const items = await fetchOne(cal.id, tok, timeMin, timeMax);
        return items
          .filter(e => e.status !== 'cancelled' && (e.start?.date || e.start?.dateTime))
          .map(e => normalize(e, cal.tone || 'cool'));
      } catch (err){
        console.warn(`Calendar ${cal.id}:`, err.message);
        return [];
      }
    })
  );

  return batches.flat();
}

/* Mirrors into the store's `gcal` slot. Manual events live in a
   separate node, so a sync never eats something you typed here. */
export async function syncCalendar(store, opts){
  try {
    const events = await fetchEvents(opts);
    await store.setGcal(events);
    calendarState.lastSync = Date.now();
    calendarState.error = null;
    return events.length;
  } catch (err){
    calendarState.error = err.message;
    throw err;
  }
}
