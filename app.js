/* ==========================================================================
   Home Dashboard — app.js
   No user interaction is assumed anywhere in this file: nothing here waits
   on a click, tap, or key press. Everything is timer-driven.
   ========================================================================== */

(() => {
  "use strict";

  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // five minutes
  const CLOCK_INTERVAL_MS = 1000;

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const els = {
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
  };

  /* ---------------------------------- Weather icons (inline SVG, no network) ---------------------------------- */

  const ICONS = {
    sun: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="9" stroke="currentColor" stroke-width="2.5"/><g stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="24" y1="4" x2="24" y2="10"/><line x1="24" y1="38" x2="24" y2="44"/><line x1="4" y1="24" x2="10" y2="24"/><line x1="38" y1="24" x2="44" y2="24"/><line x1="9" y1="9" x2="13" y2="13"/><line x1="35" y1="35" x2="39" y2="39"/><line x1="9" y1="39" x2="13" y2="35"/><line x1="35" y1="13" x2="39" y2="9"/></g></svg>',
    cloud: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 34a9 9 0 1 1 2-17.8A11 11 0 0 1 37 20a7 7 0 0 1-1 14H14Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    "partly-cloudy": '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="17" cy="16" r="7" stroke="currentColor" stroke-width="2.5"/><path d="M18 34a9 9 0 1 1 2-17.8A11 11 0 0 1 41 20a7 7 0 0 1-1 14H18Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    rain: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 28a9 9 0 1 1 2-17.8A11 11 0 0 1 37 14a7 7 0 0 1-1 14H14Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><g stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="16" y1="36" x2="14" y2="42"/><line x1="24" y1="36" x2="22" y2="42"/><line x1="32" y1="36" x2="30" y2="42"/></g></svg>',
    storm: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 26a9 9 0 1 1 2-17.8A11 11 0 0 1 37 12a7 7 0 0 1-1 14H14Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M25 30 19 40h7l-3 8 11-13h-7l4-5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="currentColor" fill-opacity="0.15"/></svg>',
  };

  /* ---------------------------------- Placeholder data ---------------------------------- */
  /* In a real deployment these fetch() calls would hit a local API / home
     automation hub (e.g. Home Assistant). They're stubbed here so the
     dashboard is runnable standalone. Swap fetchWeather / fetchCalendar /
     fetchSensors for real requests when wiring this up. */

  function getPlaceholderWeather() {
    const today = new Date();
    const conditions = ["sun", "partly-cloudy", "cloud", "rain", "partly-cloudy", "sun", "storm"];
    const highs = [89, 90, 87, 83, 85, 91, 86];
    const lows = [74, 75, 73, 71, 72, 76, 73];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push({
        label: i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" }),
        condition: conditions[i],
        high: highs[i],
        low: lows[i],
      });
    }
    return { location: "Tampa, FL", days };
  }

  function getPlaceholderEvents() {
    return [
      { time: "9:00 AM", ampmSplit: true, title: "Team standup", meta: "Video call · 15 min" },
      { time: "12:30 PM", ampmSplit: true, title: "Lunch with Alex", meta: "Corner Bistro" },
      { time: "3:00 PM", ampmSplit: true, title: "Dentist appointment", meta: "Dr. Patel's office" },
      { time: "6:30 PM", ampmSplit: true, title: "Pick up groceries", meta: "Publix" },
      { time: "Tomorrow", ampmSplit: false, title: "Trash & recycling day", meta: "Curbside by 7:00 AM" },
    ];
  }

  function getPlaceholderSensors() {
    return {
      pool: { temp: 84, meta: "Pump running" },
      indoor: { temp: 72, meta: "Living room" },
      garage: { status: "Closed", alert: false, meta: "Last opened 8:12 AM" },
    };
  }

  /* ---------------------------------- Rendering ---------------------------------- */

  function renderClock() {
    const now = new Date();
    els.clockTime.textContent = timeFormatter.format(now);
    els.clockDate.textContent = dateFormatter.format(now);
  }

  function renderWeather(data) {
    els.weatherLocation.textContent = data.location;
    els.weatherStrip.innerHTML = data.days
      .map(
        (day) => `
        <div class="weather-day">
          <div class="weather-day__name">${day.label}</div>
          <div class="weather-day__icon">${ICONS[day.condition] || ICONS.sun}</div>
          <div class="weather-day__high">${day.high}&deg;</div>
          <div class="weather-day__low">${day.low}&deg;</div>
        </div>`
      )
      .join("");
  }

  function renderEvents(events) {
    if (!events.length) {
      els.eventList.innerHTML = '<li class="event-list__empty">Nothing scheduled</li>';
      return;
    }
    els.eventList.innerHTML = events
      .map((ev) => {
        const [num, ampm] = ev.ampmSplit ? ev.time.split(" ") : [ev.time, ""];
        return `
        <li class="event-item">
          <div class="event-item__time">${num}${ampm ? `<span>${ampm}</span>` : ""}</div>
          <div class="event-item__body">
            <div class="event-item__title">${ev.title}</div>
            <div class="event-item__meta">${ev.meta}</div>
          </div>
        </li>`;
      })
      .join("");
  }

  function renderSensors(sensors) {
    els.poolTemp.textContent = sensors.pool.temp;
    els.poolMeta.textContent = sensors.pool.meta;

    els.indoorTemp.textContent = sensors.indoor.temp;
    els.indoorMeta.textContent = sensors.indoor.meta;

    els.garageStatus.textContent = sensors.garage.status;
    els.garageMeta.textContent = sensors.garage.meta;
    els.garageCard.dataset.alert = String(!!sensors.garage.alert);
  }

  function renderSyncTime(date) {
    els.lastSync.textContent = `Last update: ${timeFormatter.format(date)}`;
  }

  /* ---------------------------------- Connection status ---------------------------------- */

  function setConnectionState(state) {
    // state: "online" | "offline" | "unknown"
    els.connectionStatus.dataset.state = state;
    els.connectionLabel.textContent =
      state === "online" ? "Online" : state === "offline" ? "Offline" : "Connecting\u2026";
  }

  function updateConnectionFromNavigator() {
    setConnectionState(navigator.onLine ? "online" : "offline");
  }

  /* ---------------------------------- Refresh cycle ---------------------------------- */

  async function refreshData() {
    try {
      // Placeholder data stands in for real network calls. Because this
      // still runs even offline, a failed real fetch() below should fall
      // back to the last-known values rather than clearing the screen.
      const weather = getPlaceholderWeather();
      const events = getPlaceholderEvents();
      const sensors = getPlaceholderSensors();

      renderWeather(weather);
      renderEvents(events);
      renderSensors(sensors);
      renderSyncTime(new Date());
      updateConnectionFromNavigator();
    } catch (err) {
      console.error("Dashboard refresh failed:", err);
      setConnectionState("offline");
    }
  }

  /* ---------------------------------- Fullscreen / wake lock (best effort) ---------------------------------- */
  /* These are convenience attempts for a kiosk-mode browser. Fullscreen
     generally requires a user gesture in standard browsers; when this app
     is launched as an installed PWA (see manifest.json "display":
     "fullscreen") or via a kiosk-mode browser flag, the OS/browser handles
     it directly and these calls are harmless no-ops if blocked. */

  function requestFullscreenBestEffort() {
    const root = document.documentElement;
    const request =
      root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      root.mozRequestFullScreen;
    if (request) {
      request.call(root).catch(() => {
        /* Ignored: most browsers require a user gesture. Fine to run windowed. */
      });
    }
  }

  let wakeLock = null;
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
      // Not fatal — display timeout should still be handled at the OS/kiosk level.
      console.warn("Wake lock unavailable:", err);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestWakeLock();
    }
  });

  /* ---------------------------------- Service worker ---------------------------------- */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    });
  }

  /* ---------------------------------- Init ---------------------------------- */

  function init() {
    renderClock();
    setInterval(renderClock, CLOCK_INTERVAL_MS);

    updateConnectionFromNavigator();
    window.addEventListener("online", updateConnectionFromNavigator);
    window.addEventListener("offline", updateConnectionFromNavigator);

    refreshData();
    setInterval(refreshData, REFRESH_INTERVAL_MS);

    requestFullscreenBestEffort();
    requestWakeLock();
    registerServiceWorker();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
