/* ==========================================================================
   Wright Home Dashboard — app.js

   Features:
   - Live clock and date
   - Placeholder weather and sensor data
   - Firebase email/password authentication
   - Persistent Firebase login
   - Private Firestore calendar access
   - Real-time calendar updates
   - Fullscreen and screen wake-lock attempts
   - Service worker registration
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const dateElement = document.getElementById("clock-date");
  const eventList = document.getElementById("event-list");

  if (dateElement) {
    dateElement.textContent = "JavaScript file loaded";
  }

  if (eventList) {
    eventList.innerHTML =
      '<li class="event-list__empty">JavaScript file loaded</li>';
  }
});

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from
  "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  onSnapshot
} from
  "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";


/* ==========================================================================
   Configuration
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyCABzIRuasTt8jFuxc5YA5tdS-dPNLrU88",
  authDomain: "wright-home-dashboard.firebaseapp.com",
  projectId: "wright-home-dashboard",
  storageBucket: "wright-home-dashboard.firebasestorage.app",
  messagingSenderId: "1090775992930",
  appId: "1:1090775992930:web:d4674faf64f9644b669f3b"
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const CLOCK_INTERVAL_MS = 1000;


/* ==========================================================================
   Firebase
   ========================================================================== */

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let unsubscribeFromCalendar = null;


/* ==========================================================================
   Formatting
   ========================================================================== */

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

const eventDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric"
});


/* ==========================================================================
   Page elements
   ========================================================================== */

const els = {
  dashboard: document.getElementById("dashboard"),

  clockTime: document.getElementById("clock-time"),
  clockDate: document.getElementById("clock-date"),

  connectionStatus: document.getElementById("connection-status"),
  connectionLabel: document.getElementById("connection-label"),
  lastSync: document.getElementById("last-sync"),

  weatherStrip: document.getElementById("weather-strip"),
  weatherLocation: document.getElementById("weather-location"),

  eventList: document.getElementById("event-list"),

  poolTemp: document.getElementById("pool-temp"),
  poolMeta: document.getElementById("pool-meta"),

  indoorTemp: document.getElementById("indoor-temp"),
  indoorMeta: document.getElementById("indoor-meta"),

  garageStatus: document.getElementById("garage-status"),
  garageMeta: document.getElementById("garage-meta"),
  garageCard: document.querySelector('[data-sensor="garage"]'),

  loginPanel: document.getElementById("firebase-login"),
  loginForm: document.getElementById("login-form"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginButton: document.getElementById("login-button"),
  loginError: document.getElementById("login-error")
};


/* ==========================================================================
   Weather icons
   ========================================================================== */

const ICONS = {
  sun: `
    <svg viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="24"
        cy="24"
        r="9"
        stroke="currentColor"
        stroke-width="2.5"
      />
      <g
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      >
        <line x1="24" y1="4" x2="24" y2="10" />
        <line x1="24" y1="38" x2="24" y2="44" />
        <line x1="4" y1="24" x2="10" y2="24" />
        <line x1="38" y1="24" x2="44" y2="24" />
        <line x1="9" y1="9" x2="13" y2="13" />
        <line x1="35" y1="35" x2="39" y2="39" />
        <line x1="9" y1="39" x2="13" y2="35" />
        <line x1="35" y1="13" x2="39" y2="9" />
      </g>
    </svg>
  `,

  cloud: `
    <svg viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14 34a9 9 0 1 1 2-17.8A11 11 0 0 1 37 20a7 7 0 0 1-1 14H14Z"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
    </svg>
  `,

  "partly-cloudy": `
    <svg viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="17"
        cy="16"
        r="7"
        stroke="currentColor"
        stroke-width="2.5"
      />
      <path
        d="M18 34a9 9 0 1 1 2-17.8A11 11 0 0 1 41 20a7 7 0 0 1-1 14H18Z"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
    </svg>
  `,

  rain: `
    <svg viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14 28a9 9 0 1 1 2-17.8A11 11 0 0 1 37 14a7 7 0 0 1-1 14H14Z"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <g
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      >
        <line x1="16" y1="36" x2="14" y2="42" />
        <line x1="24" y1="36" x2="22" y2="42" />
        <line x1="32" y1="36" x2="30" y2="42" />
      </g>
    </svg>
  `,

  storm: `
    <svg viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14 26a9 9 0 1 1 2-17.8A11 11 0 0 1 37 12a7 7 0 0 1-1 14H14Z"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <path
        d="M25 30 19 40h7l-3 8 11-13h-7l4-5Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
        fill="currentColor"
        fill-opacity="0.15"
      />
    </svg>
  `
};


/* ==========================================================================
   Placeholder weather and sensors
   ========================================================================== */

function getPlaceholderWeather() {
  const today = new Date();

  const conditions = [
    "sun",
    "partly-cloudy",
    "cloud",
    "rain",
    "partly-cloudy",
    "sun",
    "storm"
  ];

  const highs = [89, 90, 87, 83, 85, 91, 86];
  const lows = [74, 75, 73, 71, 72, 76, 73];

  const days = [];

  for (let index = 0; index < 7; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);

    days.push({
      label:
        index === 0
          ? "Today"
          : date.toLocaleDateString(undefined, {
              weekday: "short"
            }),
      condition: conditions[index],
      high: highs[index],
      low: lows[index]
    });
  }

  return {
    location: "Tampa, FL",
    days
  };
}

function getPlaceholderSensors() {
  return {
    pool: {
      temp: 84,
      meta: "Pump running"
    },

    indoor: {
      temp: 72,
      meta: "Living room"
    },

    garage: {
      status: "Closed",
      alert: false,
      meta: "Last opened 8:12 AM"
    }
  };
}


/* ==========================================================================
   Clock
   ========================================================================== */

function renderClock() {
  const now = new Date();

  if (els.clockTime) {
    els.clockTime.textContent = timeFormatter.format(now);
  }

  if (els.clockDate) {
    els.clockDate.textContent = dateFormatter.format(now);
  }
}


/* ==========================================================================
   Weather
   ========================================================================== */

function renderWeather(data) {
  if (!els.weatherStrip || !els.weatherLocation) {
    return;
  }

  els.weatherLocation.textContent = data.location;

  els.weatherStrip.innerHTML = data.days
    .map((day) => {
      return `
        <div class="weather-day">
          <div class="weather-day__name">
            ${escapeHtml(day.label)}
          </div>

          <div class="weather-day__icon">
            ${ICONS[day.condition] || ICONS.sun}
          </div>

          <div class="weather-day__high">
            ${escapeHtml(day.high)}&deg;
          </div>

          <div class="weather-day__low">
            ${escapeHtml(day.low)}&deg;
          </div>
        </div>
      `;
    })
    .join("");
}


/* ==========================================================================
   Sensors
   ========================================================================== */

function renderSensors(sensors) {
  if (els.poolTemp) {
    els.poolTemp.textContent = sensors.pool.temp;
  }

  if (els.poolMeta) {
    els.poolMeta.textContent = sensors.pool.meta;
  }

  if (els.indoorTemp) {
    els.indoorTemp.textContent = sensors.indoor.temp;
  }

  if (els.indoorMeta) {
    els.indoorMeta.textContent = sensors.indoor.meta;
  }

  if (els.garageStatus) {
    els.garageStatus.textContent = sensors.garage.status;
  }

  if (els.garageMeta) {
    els.garageMeta.textContent = sensors.garage.meta;
  }

  if (els.garageCard) {
    els.garageCard.dataset.alert = String(
      Boolean(sensors.garage.alert)
    );
  }
}


/* ==========================================================================
   Firebase Authentication
   ========================================================================== */

async function configureAuthentication() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.error(
      "Firebase login persistence could not be enabled:",
      error
    );
  }

  if (els.loginForm) {
    els.loginForm.addEventListener("submit", handleLoginSubmit);
  }

  onAuthStateChanged(auth, handleAuthenticationChange);
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const email = els.loginEmail?.value.trim() || "";
  const password = els.loginPassword?.value || "";

  clearLoginError();

  if (!email || !password) {
    showLoginError("Enter the dashboard email and password.");
    return;
  }

  setLoginLoading(true);

  try {
    await signInWithEmailAndPassword(auth, email, password);

    if (els.loginPassword) {
      els.loginPassword.value = "";
    }
  } catch (error) {
    console.error("Firebase sign-in failed:", error);

    let message = "Unable to sign in. Check the email and password.";

    if (error?.code === "auth/too-many-requests") {
      message =
        "Too many sign-in attempts. Wait briefly and try again.";
    } else if (error?.code === "auth/network-request-failed") {
      message =
        "The dashboard could not reach Firebase. Check the internet connection.";
    }

    showLoginError(message);
  } finally {
    setLoginLoading(false);
  }
}

function handleAuthenticationChange(user) {
  stopCalendarListener();

  if (!user) {
    showLoginPanel();

    renderCalendarMessage(
      "Sign in to view calendar events."
    );

    return;
  }

  hideLoginPanel();
  subscribeToCalendar();
}

function showLoginPanel() {
  if (els.loginPanel) {
    els.loginPanel.hidden = false;
  }
}

function hideLoginPanel() {
  if (els.loginPanel) {
    els.loginPanel.hidden = true;
  }
}

function setLoginLoading(isLoading) {
  if (els.loginButton) {
    els.loginButton.disabled = isLoading;
    els.loginButton.textContent =
      isLoading ? "Signing in…" : "Sign in";
  }

  if (els.loginEmail) {
    els.loginEmail.disabled = isLoading;
  }

  if (els.loginPassword) {
    els.loginPassword.disabled = isLoading;
  }
}

function showLoginError(message) {
  if (els.loginError) {
    els.loginError.textContent = message;
  }
}

function clearLoginError() {
  if (els.loginError) {
    els.loginError.textContent = "";
  }
}


/* ==========================================================================
   Firestore calendar
   ========================================================================== */

function subscribeToCalendar() {
  const calendarReference = doc(
    db,
    "dashboard",
    "calendar"
  );

  renderCalendarMessage("Loading calendar…");

  unsubscribeFromCalendar = onSnapshot(
    calendarReference,

    (snapshot) => {
      if (!snapshot.exists()) {
        renderCalendarMessage(
          "No calendar information is available."
        );

        return;
      }

      const data = snapshot.data();
      const events = normalizeCalendarData(data);

      renderEvents(events);
      renderSyncTime(new Date());

      setConnectionState(
        navigator.onLine ? "online" : "offline"
      );
    },

    (error) => {
      console.error("Firestore calendar read failed:", error);

      if (error?.code === "permission-denied") {
        renderCalendarMessage(
          "This account does not have permission to view the calendar."
        );
      } else {
        renderCalendarMessage(
          "Unable to load calendar information."
        );
      }

      setConnectionState(
        navigator.onLine ? "unknown" : "offline"
      );
    }
  );
}

function stopCalendarListener() {
  if (typeof unsubscribeFromCalendar === "function") {
    unsubscribeFromCalendar();
  }

  unsubscribeFromCalendar = null;
}

/*
 * Supports both:
 *
 * Current test structure:
 * dashboard/calendar
 *   title
 *   start
 *   end
 *   location
 *   allDay
 *
 * Future structure:
 * dashboard/calendar
 *   events: [...]
 */
function normalizeCalendarData(data) {
  let events;

  if (Array.isArray(data.events)) {
    events = data.events;
  } else if (data.title || data.start) {
    events = [data];
  } else {
    events = [];
  }

  return events
    .filter((event) => event && event.start)
    .map((event) => {
      return {
        title: event.title || "Untitled event",
        start: event.start,
        end: event.end || null,
        location: event.location || "",
        allDay: normalizeBoolean(event.allDay)
      };
    })
    .sort((first, second) => {
      return (
        parseCalendarDate(first.start).getTime() -
        parseCalendarDate(second.start).getTime()
      );
    });
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return Boolean(value);
}

function renderEvents(events) {
  if (!els.eventList) {
    return;
  }

  if (!events.length) {
    renderCalendarMessage("Nothing scheduled");
    return;
  }

  els.eventList.innerHTML = events
    .slice(0, 6)
    .map((event) => {
      const display = formatCalendarEvent(event);

      return `
        <li class="event-item">
          <div class="event-item__time">
            ${escapeHtml(display.primary)}

            ${
              display.secondary
                ? `<span>${escapeHtml(display.secondary)}</span>`
                : ""
            }
          </div>

          <div class="event-item__body">
            <div class="event-item__title">
              ${escapeHtml(event.title)}
            </div>

            <div class="event-item__meta">
              ${escapeHtml(display.meta)}
            </div>
          </div>
        </li>
      `;
    })
    .join("");
}

function formatCalendarEvent(event) {
  const start = parseCalendarDate(event.start);

  if (Number.isNaN(start.getTime())) {
    return {
      primary: "—",
      secondary: "",
      meta: event.location || "Time unavailable"
    };
  }

  const now = new Date();
  const isToday = sameCalendarDay(start, now);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const isTomorrow = sameCalendarDay(start, tomorrow);

  let primary;
  let secondary = "";

  if (event.allDay) {
    if (isToday) {
      primary = "Today";
    } else if (isTomorrow) {
      primary = "Tomorrow";
    } else {
      primary = eventDateFormatter.format(start);
    }
  } else if (isToday) {
    const timeParts = splitFormattedTime(
      eventTimeFormatter.format(start)
    );

    primary = timeParts.primary;
    secondary = timeParts.secondary;
  } else if (isTomorrow) {
    primary = "Tomorrow";
    secondary = eventTimeFormatter.format(start);
  } else {
    primary = eventDateFormatter.format(start);
    secondary = eventTimeFormatter.format(start);
  }

  const metaParts = [];

  if (!event.allDay && !isToday && !isTomorrow) {
    // The time is already shown separately.
  }

  if (event.location) {
    metaParts.push(event.location);
  }

  if (!metaParts.length) {
    metaParts.push(
      event.allDay ? "All-day event" : formatEventDuration(event)
    );
  }

  return {
    primary,
    secondary,
    meta: metaParts.join(" · ")
  };
}

function formatEventDuration(event) {
  if (!event.end) {
    return "Scheduled event";
  }

  const start = parseCalendarDate(event.start);
  const end = parseCalendarDate(event.end);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return "Scheduled event";
  }

  const durationMinutes = Math.round(
    (end.getTime() - start.getTime()) / 60000
  );

  if (durationMinutes <= 0) {
    return "Scheduled event";
  }

  if (durationMinutes < 60) {
    return `${durationMinutes} min`;
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (minutes === 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${hours} hr ${minutes} min`;
}

function parseCalendarDate(value) {
  /*
   * A Google Calendar all-day date may eventually arrive as YYYY-MM-DD.
   * Adding T00:00:00 parses it as local time instead of UTC.
   */
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return new Date(`${value}T00:00:00`);
  }

  return new Date(value);
}

function sameCalendarDay(first, second) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function splitFormattedTime(value) {
  const match = String(value).match(
    /^(.+?)\s*([AP]M)$/i
  );

  if (!match) {
    return {
      primary: value,
      secondary: ""
    };
  }

  return {
    primary: match[1],
    secondary: match[2].toUpperCase()
  };
}

function renderCalendarMessage(message) {
  if (!els.eventList) {
    return;
  }

  els.eventList.innerHTML = `
    <li class="event-list__empty">
      ${escapeHtml(message)}
    </li>
  `;
}


/* ==========================================================================
   Connection and synchronization status
   ========================================================================== */

function setConnectionState(state) {
  if (els.connectionStatus) {
    els.connectionStatus.dataset.state = state;
  }

  if (!els.connectionLabel) {
    return;
  }

  if (state === "online") {
    els.connectionLabel.textContent = "Online";
  } else if (state === "offline") {
    els.connectionLabel.textContent = "Offline";
  } else {
    els.connectionLabel.textContent = "Connecting…";
  }
}

function updateConnectionFromNavigator() {
  setConnectionState(
    navigator.onLine ? "online" : "offline"
  );
}

function renderSyncTime(date) {
  if (els.lastSync) {
    els.lastSync.textContent =
      `Last update: ${timeFormatter.format(date)}`;
  }
}


/* ==========================================================================
   Placeholder refresh cycle
   ========================================================================== */

function refreshLocalData() {
  try {
    renderWeather(getPlaceholderWeather());
    renderSensors(getPlaceholderSensors());

    /*
     * Calendar data is not refreshed here because Firestore supplies it
     * through a real-time listener.
     */
    updateConnectionFromNavigator();
  } catch (error) {
    console.error("Dashboard refresh failed:", error);
    setConnectionState("offline");
  }
}


/* ==========================================================================
   Fullscreen and wake lock
   ========================================================================== */

function requestFullscreenBestEffort() {
  const root = document.documentElement;

  const request =
    root.requestFullscreen ||
    root.webkitRequestFullscreen ||
    root.mozRequestFullScreen;

  if (!request) {
    return;
  }

  try {
    const result = request.call(root);

    if (result && typeof result.catch === "function") {
      result.catch(() => {
        // Standard browsers may require a user gesture.
      });
    }
  } catch {
    // Fullscreen is already handled by the Android wrapper.
  }
}

let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (error) {
    console.warn("Screen wake lock unavailable:", error);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    requestWakeLock();
  }
});


/* ==========================================================================
   Service worker
   ========================================================================== */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((error) => {
        console.error(
          "Service worker registration failed:",
          error
        );
      });
  });
}


/* ==========================================================================
   Utilities
   ========================================================================== */

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}


/* ==========================================================================
   Initialization
   ========================================================================== */

async function init() {
  renderClock();
  window.setInterval(renderClock, CLOCK_INTERVAL_MS);

  updateConnectionFromNavigator();

  window.addEventListener(
    "online",
    updateConnectionFromNavigator
  );

  window.addEventListener(
    "offline",
    updateConnectionFromNavigator
  );

  refreshLocalData();

  window.setInterval(
    refreshLocalData,
    REFRESH_INTERVAL_MS
  );

  await configureAuthentication();

  requestFullscreenBestEffort();
  requestWakeLock();
  registerServiceWorker();
}

init().catch((error) => {
  console.error("Dashboard initialization failed:", error);

  renderCalendarMessage(
    "The dashboard could not initialize."
  );

  setConnectionState("offline");
});
