# Home Dashboard

A wall display that also works as a normal app on your computer.

- **Kiosk mode** — no cursor, no controls, nothing clickable. What the bathroom and kitchen screens show.
- **Interactive mode** — click, type, and edit everything. What your computer gets.

Mode is picked automatically from whether a real pointer exists. Force it with `?mode=edit` or `?mode=kiosk`, or press **K** to toggle.

---

## Folder layout

Most of these files sit together in the repo root, but **two must be in subfolders**:

```
your-repo/
├── .github/
│   └── workflows/
│       └── sync-calendar.yml     ← GitHub only looks here
├── scripts/
│   └── sync-calendar.mjs
├── .env                          ← you create this; never committed
├── .env.example
├── .gitignore
├── index.html
├── app.js  store.js  config.js  calendar.js  styles.css
├── list.html  list.js  list.css
├── manifest.json  list-manifest.json
├── service-worker.js
├── database.rules.json  firebase.json
├── icon-192.png  icon-512.png
├── icon-list-192.png  icon-list-512.png
└── README.md
```

`sync-calendar.yml` **must** live at `.github/workflows/` — that exact path is how GitHub finds workflows. Anywhere else and it's an inert text file: no error, no warning, it simply never appears in the Actions tab and never runs.

`sync-calendar.mjs` is more forgiving. It finds `.env` whether you keep it in `scripts/` or loose in the root; just match the path in your command to where it actually is.

In PowerShell, from your project folder:

```powershell
New-Item -ItemType Directory -Force .github\workflows, scripts
Move-Item sync-calendar.yml  .github\workflows\
Move-Item sync-calendar.mjs  scripts\
```

---

## Run it

A service worker and ES modules both need a real origin — `file://` won't work.

```bash
cd path/to/dashboard
python3 -m http.server 8080     # Windows: python -m http.server 8080
```

**That command doesn't finish.** It prints `Serving HTTP on :: port 8080` and then sits there — that's a web server running, waiting for requests, and it's supposed to look idle. Nothing else will happen in that window.

The dashboard opens in a **browser**: <http://localhost:8080> for the wall display, <http://localhost:8080/list.html> for the phone list.

Leave that terminal alone while you're working. If you need to run `node scripts/sync-calendar.mjs`, open a *second* PowerShell window. `Ctrl+C` in the first one stops the server when you're done. The service worker stays off on localhost unless you add `?sw=1`, so you don't fight a stale cache while editing.

Out of the box there's **no Firebase config**, so it runs in local mode: fully interactive, data saved in that browser. Good for deciding what you want before wiring anything up.

---

## Keyboard

| Key | Does |
|---|---|
| `A` | Add a grocery item (Enter saves and opens another row) |
| `E` | Add an event to today |
| `S` | Settings — location, units, week start, events per day |
| `K` | Toggle kiosk / interactive |
| `F` | Fullscreen |
| `Esc` | Close whatever's open |

Click a calendar day to add or remove events on it. Click a grocery item to check it off, or the × to delete. Click a sensor tile to rename it and see the exact Firebase path that board should write to.

---

## Connect Firebase

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Realtime Database** → create one.
3. **Build → Authentication** → Sign-in method → enable **Google** *and* **Anonymous**. Anonymous is what lets a screen with no keyboard pair itself.
4. Project settings → Your apps → Web app → copy the config object.
5. Paste the values into `config.js`.
6. Rules tab → paste the contents of `database.rules.json` → Publish.
7. Authentication → Settings → Authorized domains → add wherever you host this (`localhost` is already there).

Reload. You'll get a Google sign-in screen; after that everything syncs live.

---

## Pairing the kitchen and bathroom screens

Signing in on your computer does **not** carry over to another device — a Firebase session lives in one browser's storage and there's no way to transfer it. Pairing is how you get the effect you want without typing a Google password on a screen that has no keyboard:

1. Open the dashboard on the wall screen. With no pointer, it signs in anonymously and shows a **six-character code**.
2. On your computer, click your account chip → type the code → **Pair**.
3. The wall screen switches to the dashboard by itself and stays authorized through reboots and power cuts. You never touch it again.

Paired displays are **read-only** — a screen in the bathroom can't wipe your grocery list. Unpair any of them from the same account panel.

If a panel ever gets stuck, load it with `?pair=1` to force a fresh code.

---

## Publishing ESP32 data

Each board writes one node:

```
households/<your-uid>/sensors/pool
households/<your-uid>/sensors/garage
households/<your-uid>/sensors/house
```

with a payload like:

```json
{ "value": 84.6, "unit": "°F", "updated": 1730000000000 }
```

Click any tile in interactive mode and it shows you that path with your real UID filled in.

A tile dims and reads **No signal** when `updated` is older than 20 minutes, so a board that died is obvious instead of sitting on a stale number that looks fine.

For auth on the boards, the two workable options are:

- **Firebase REST + a database secret or custom token.** Simplest for `Firebase_ESP_Client` on Arduino. Keep the secret off any public repo.
- **A service account writing through a small relay** (a Pi, a Cloud Function on a schedule, whatever you already run). Better if you ever expose the boards outside your LAN.

The rules as written only let the owner UID write to `sensors`. If your boards authenticate as something else, loosen that one branch — not the whole household node.

---

## Unattended calendar sync (the one-hour fix)

The browser OAuth flow hands out a one-hour access token and no refresh token, so a dashboard left up in the kitchen would go stale by lunch. The fix is to move the sync off the panel entirely: a **GitHub Action** runs every 15 minutes, exchanges your refresh token for a fresh access token, and writes events into Firebase. The panels just read the mirror and update live. Nothing in the kitchen ever talks to Google, so nothing there can expire.

This runs on GitHub's free tier and needs no Firebase billing.

### 1. Find your household ID

The household ID is **your Firebase Auth UID** — the ID Firebase assigns your Google account the first time you sign in to the dashboard. It's the folder in the database where all your household's data lives: `households/<uid>/grocery`, `households/<uid>/gcal`, and so on.

It doesn't exist until you've signed in at least once. So:

1. Fill in `config.js` with your Firebase web config (Console → Project settings → Your apps → Web app).
2. Serve the dashboard (`python -m http.server 8080`) and open it.
3. Sign in with Google. That creates your household.

Then get the UID by any of these:

- **From the script**, once `FIREBASE_DATABASE_URL` and a Firebase credential are in `.env`:
  ```bash
  node scripts/sync-calendar.mjs --list-households
  ```
  It prints the IDs with owner names, and the exact line to paste into `.env`.
- **Firebase Console** → Authentication → Users tab → the **User UID** column.
- **From the dashboard itself** → click any sensor tile; the path shown is `households/<this-part>/sensors/...`.

### 2. Get Firebase write access for the Action

Either one works — pick whichever you can set up faster.

**Service account (preferred):** Firebase Console → Project settings → Service accounts → **Generate new private key**. You get a JSON file.

**Database secret (simpler):** same page, **Database secrets** section → reveal and copy the string. Google marks this deprecated, but it still works and it's one line instead of a JSON blob.

### 3. Add repository secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID already in `config.js` |
| `GOOGLE_CLIENT_SECRET` | from the same OAuth client in Cloud Console |
| `GOOGLE_REFRESH_TOKEN` | the one you generated |
| `FIREBASE_DATABASE_URL` | `https://your-project-default-rtdb.firebaseio.com` |
| `FIREBASE_HOUSEHOLD_ID` | your UID from step 1 |
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON file's contents — **or** |
| `FIREBASE_DATABASE_SECRET` | the database secret string |

Optionally, under the **Variables** tab: `HOUSEHOLD_TZ` (set this — it defaults to `America/New_York`, which happens to be right for Tampa), `CALENDAR_IDS`, `CALENDAR_TONES`, `DAYS_BACK`, `DAYS_AHEAD`.

### 4. Test it before trusting it

Two ways. Neither needs the Firebase secrets — a dry run only reads from Google.

**On GitHub, no install required.** Push the repo, add at least the three `GOOGLE_*` secrets, then Actions tab → **Sync Google Calendar** → **Run workflow** → tick **dry run** → Run. Open the run and expand the log; your events print there. Slower to iterate (a minute or two per attempt) but nothing to set up.

**On your own computer, much faster to iterate.** You need [Node.js](https://nodejs.org) 18 or newer — check with `node --version`. Then, in a terminal sitting in your cloned repo folder:

```bash
cp .env.example .env          # macOS / Linux
```

```powershell
Copy-Item .env.example .env   # Windows PowerShell
```

Use the command rather than Explorer — Windows resists creating a file whose name starts with a dot. Then open `.env` in Notepad or VS Code, paste in your client secret and refresh token, and save.

```bash
node scripts/sync-calendar.mjs --dry-run
```

Run `node scripts/sync-calendar.mjs --help` for everything it can do.

The script reads `.env` on its own, so this exact command works on macOS, Linux, and Windows PowerShell alike. On Windows, `cp` is `copy` — or just duplicate the file in Explorer and rename it.

Either way you should see something like:

```
Loaded settings from .env
Fetched 23 events.

  2026-07-30
    06:45    OR block
    12:00    Tumor board
  2026-07-31
    08:00    Clinic
```

**Those are your real calendar items.** If they appear here, they'll appear on the dashboard. Nothing was written to Firebase — drop `--dry-run` (and add the Firebase secrets) when you're ready for that.

### Finding the right calendar

If a dry run comes back nearly empty, or shows only auto-generated travel entries, the schedule you care about probably isn't on this account's `primary` calendar. To see everything the token can reach:

```bash
node scripts/sync-calendar.mjs --list-calendars
```

That prints each calendar's name, its ID, and how many events it holds in the sync window — so the one with your actual schedule is obvious by count. Then list the IDs you want:

```
CALENDAR_IDS=primary,family00619516650243625259@group.calendar.google.com
CALENDAR_TONES=cool,warm
```

in `.env` locally, and under repo Settings → Variables for the Action. Tones set each calendar's accent color on the dashboard: `cool` (cyan), `warm` (amber), or `plain` (grey). The lists are positional — first ID gets the first tone.

**Only the calendars you name are synced.** With `CALENDAR_IDS` unset it defaults to `primary` alone, so a Family or shared calendar won't appear until you add its ID here.

Prefer the literal string `primary` over your email address for your own calendar — same result, and it keeps your address out of a file you might commit.

If the calendar you need doesn't appear in that list at all, it belongs to a different Google account. Two ways around that: share it to the account you're authenticating as (Calendar settings → Share with specific people), after which it shows up in the list — or generate a separate refresh token for that account.

And if your work schedule lives in Outlook or a hospital system rather than Google at all, the usual bridge is to subscribe to its iCal feed from Google Calendar (Other calendars → From URL). Once Google can see it, this script can.

### When sync fails

The script names what it can, but here's the decoder ring. **The HTTP status tells you which credential is at fault**, which saves a lot of blind guessing:

| Error | What's actually wrong |
|---|---|
| `401 Unauthorized` / `invalid_client` | The **client ID and secret don't match**, or the refresh token was minted under a different OAuth client. Nothing to do with the token's age. |
| `400 invalid_grant` | The **refresh token is dead** — revoked, password changed, or the consent screen fell back to Testing. |
| `403 accessNotConfigured` | The **Google Calendar API isn't enabled** for the project. |
| `404` on a calendar | Bad calendar ID, or this account can't see that calendar. |

The most common cause of a 401 is subtle: **a refresh token is bound to the OAuth client that created it.** If you generated it in the OAuth Playground, or under a different client ID than the one in `config.js`, it will never work here no matter how fresh it is. Regenerate it using this exact client, with this exact secret.

Also worth checking: Cloud Console lists **Web application** and **Desktop app** clients separately, and they aren't interchangeable. Whichever type minted the token is the type you must authenticate as.

The script prints which client ID it used and a safe fingerprint of the secret and token (first few characters and length, never the full value) so you can eyeball whether the right pair went out.

### Things that will bite you

- **A "Testing" consent screen expires refresh tokens after 7 days.** Production is what makes them long-lived. If sync dies in exactly a week, this is why.
- **Scheduled workflows are disabled after 60 days without repo activity.** GitHub emails first; any commit resets the clock.
- **GitHub's cron runs late** — sometimes 5–15 minutes past the mark on the free tier. Fine for a wall calendar.

The dashboard's account panel shows when the Action last ran and how many events it pulled, and warns in amber if that's more than an hour old. Browser-side OAuth stays available as a manual fallback, but stops firing on its own once the Action is doing the work.

---

## Putting this on GitHub and hosting it

```bash
cd path/to/dashboard
git init
git add .
git commit -m "Home dashboard: wall display, phone list, shared household"
git branch -M main
git remote add origin git@github.com:<you>/home-dashboard.git
git push -u origin main
```

Commit to `main` directly. It's a solo project with no reviewers and no CI, so branches mostly add ceremony. Two exceptions worth a branch, because both can break things you can't easily see:

- **`database.rules.json` changes.** A bad rule doesn't error at deploy time — it silently denies writes, and you find out when your wife's phone stops saving. Test with `firebase emulators:start` on a branch first.
- **Anything touching auth or pairing.** A wall panel that loses its session needs physical access to re-pair.

### Is it safe to commit `config.js`?

Yes, as written. Firebase web config and OAuth **web client IDs are public by design** — they ship in your page source either way, and your actual security comes from the database rules plus the authorized-domains list. Google's own docs say to treat them as public.

What must *never* be committed: a Firebase **database secret** or legacy auth token, a service account JSON, or an OAuth **client secret**. You'll hit the first one when you wire up the ESP32 boards. The `.gitignore` here already blocks the usual filenames — put board credentials in something like `config.secret.js` and import it, rather than editing `config.js`.

Consider making the repo private anyway. Nothing in it is sensitive, but a public repo means anyone can read your household's structure and start guessing invite codes.

### Hosting

You need HTTPS — service workers and Google Sign-In both refuse plain HTTP.

**GitHub Pages** is what this project is set up for now. Repo → Settings → Pages → deploy from `main`. Every path here is relative, so serving from `username.github.io/home-dashboard/` works as-is. A private repo needs a paid plan for Pages; a public repo is free but exposes your household structure, so weigh that.

Because Pages serves from a different domain than your Firebase auth domain, Google Sign-In may fall back from a popup to a full redirect. That's handled in `store.js` and works fine — it just looks different.

**Firebase Hosting** remains an option if you want to revisit it:

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project
firebase deploy
```

`firebase.json` is included and set up to publish this folder and your database rules together, with no-cache headers on `service-worker.js` so a deploy can't get pinned behind a stale worker.

**GitHub Pages** also works — repo Settings → Pages → deploy from `main`. Every path in this project is relative, so serving from `username.github.io/home-dashboard/` is fine. Note that Pages on a *private* repo needs a paid plan.

Either way, add the final URL to:

1. Firebase Console → Authentication → Settings → **Authorized domains**
2. Google Cloud Console → Credentials → your OAuth client → **Authorized JavaScript origins**

Miss either and sign-in fails with an unhelpful error.

### After a deploy

The wall panels keep serving the old build until their service worker updates. A reload on each one forces it. If you change any of `index.html`, `styles.css`, `app.js`, `store.js`, `calendar.js`, `list.*` — bump `CACHE_VERSION` in `service-worker.js`, or the panels will happily serve last week's code forever.

---

## The phone shopping list

`list.html` is a second, separate app for exactly one job: the shopping list, on a phone. Same Firebase node as the dashboard's grocery panel, so a tap in the aisle shows up in the bathroom within a couple of seconds, and anything added on the wall screen is waiting for you at the store.

Open `https://your-host/list.html` on your phone, sign in with the same Google account, then **Add to Home Screen**. It installs as its own app with its own icon — portrait, standalone, no browser chrome. There's a **Phone list ↗** link in the dashboard's grocery panel if you want to grab the URL from your computer.

What it does:

- **Add** — the composer is pinned to the bottom, under your thumb. Enter adds the item and keeps the keyboard up for the next one.
- **Check off** — tap anywhere on the row. Checked items drop into an "In the cart" group at the bottom.
- **Delete** — × on the row, with an Undo in the toast.
- **Clear** — the ⋮ menu offers *Clear checked* and *Clear the whole list*. **Both require a second confirming tap** on a sheet that names how many items are about to go, and both stay undoable for a few seconds after.

Nothing destructive happens on one tap, which matters when you're holding the phone in one hand and a bag of oranges in the other.

To let your wife or kids use it too, either share the Google account, or tell me and I'll add a members list to the security rules so their own accounts can write to your household.

---

## Sharing the list with other people

Each person uses **their own Google account**. Nobody shares a password, and you can cut anyone off without touching the rest.

**To invite someone:** account chip on the dashboard → **Invite someone**. You get a link and a six-character code. Send them the link.

**What they do:** open it, sign in with their own Google account, and they land in the shopping list already joined. Add to home screen and they have the same app you do.

One code works for the whole family and lasts 14 days. Revoke it any time from the account panel — that stops new joins but doesn't remove anyone who already joined. To remove a person, use **Remove** next to their name; they lose access on their next load.

**What a member can and can't do:**

| | Owner | Member | Paired display |
|---|---|---|---|
| Grocery list — add, check off, clear | ✓ | ✓ | — |
| Add calendar events by hand | ✓ | ✓ | — |
| Settings, sensor labels, Google Calendar sync | ✓ | — | — |
| Invite or remove people, pair displays | ✓ | — | — |
| Read everything | ✓ | ✓ | ✓ |

Members can leave on their own from the ⋮ menu in the phone list.

Everything is one Realtime Database node, so the sync is genuinely live: someone checks off milk in aisle four, and it strikes through on your bathroom wall and on everyone else's phone at the same moment. No polling, no refresh.

One wrinkle worth knowing: if someone who already had their own household joins yours, yours becomes the one they see. Their old data isn't deleted, it's just not shown; leaving the household brings it back.

**Republish `database.rules.json` after this change** — the member permissions are new, and without them invites will be accepted but writes will be rejected.

---

## Grocery from a Google Sheet instead

If you'd rather keep the list in something you already use, set `GROCERY.source = 'sheet'` in `config.js`:

1. Make a sheet with columns `item | qty | done`.
2. **File → Share → Publish to web** → pick that sheet → **CSV** → copy the link.
3. Paste it into `GROCERY.publishedCsvUrl`.

Anyone you share the sheet with can then edit from the Sheets app. Both the dashboard and the phone list become read-only mirrors of it, and neither needs auth to read — a wall panel that has never signed into anything can still show it.

One caveat: Google caches published-sheet output, so a change can take a few minutes to appear even though both apps re-fetch every two.

**Google Keep is not an option** — it has no public API. Google Tasks does; say the word and I'll wire it up.

---

## Google Calendar — optional browser sync

**Off by default** (`CALENDAR.browserSync` in `config.js`). The GitHub Action is the sync agent; this browser path is a convenience button and nothing depends on it.

Turning it on requires an OAuth client of type **Web application** with your page's exact origin under Authorized JavaScript origins. If your client is a **Desktop app** — which is what the usual "get a refresh token from a script" walkthrough creates — browser sign-in cannot work with it at all. Desktop clients have no JavaScript-origins field, so Google answers `no registered origin / 401 invalid_client` regardless of what you configure. The same client works perfectly for the Action, because a Node script isn't a browser.

To check which you have: Cloud Console → Credentials. The **Type** column says "Web application" or "Desktop". If you want the browser button and have a Desktop client, create a second, Web-application client and put its ID in `CALENDAR.clientId` — but note the Action's refresh token stays bound to the original, so keep that one in `.env` unchanged.

Setup on Google's side, needed for both paths:

1. **Cloud Console → APIs & Services → Library** → enable **Google Calendar API**.
2. **Credentials → your OAuth client → Authorized JavaScript origins** → add every origin you load from (`http://localhost:8080`, and your GitHub Pages URL).
3. **OAuth consent screen** → Production, which you've done.

Then: account chip → **Pull from this browser** → approve the read-only scope. Events land in `households/<uid>/gcal`, same node the Action writes.

Add more calendars by ID (Calendar settings → Integrate calendar → Calendar ID) — in `CALENDAR.calendars` for the browser path, or the `CALENDAR_IDS` repo variable for the Action.

**Google events are read-only on the dashboard.** They show a "Google" badge instead of a Remove button, and live in a separate node from events you type in, so a sync never eats your manual entries.

---

## On the Android panel

Chrome → **Add to Home screen**. The manifest asks for fullscreen landscape. For a screen that has to survive reboots and stay awake, Fully Kiosk Browser handles auto-start, screen-on, and wake-on-motion better than Chrome does.

The layout nudges itself 1–2px every 15 minutes so a static dashboard doesn't burn into an always-on panel.
