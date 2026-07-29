"use strict";

const firebaseConfig = {
  apiKey: "AIzaSyCABzIRuasTt8jFuxc5YA5tdS-dPNLrU88",
  authDomain: "wright-home-dashboard.firebaseapp.com",
  projectId: "wright-home-dashboard",
  storageBucket: "wright-home-dashboard.firebasestorage.app",
  messagingSenderId: "1090775992930",
  appId: "1:1090775992930:web:d4674faf64f9644b669f3b"
};

const clockTime = document.getElementById("clock-time");
const clockDate = document.getElementById("clock-date");
const eventList = document.getElementById("event-list");

const loginPanel = document.getElementById("firebase-login");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");

function showStatus(message) {
  eventList.innerHTML = `
    <li class="event-list__empty">
      ${escapeHtml(message)}
    </li>
  `;
}

function updateClock() {
  const now = new Date();

  clockTime.textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  clockDate.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function showLogin() {
  loginPanel.hidden = false;
}

function hideLogin() {
  loginPanel.hidden = true;
}

function setLoginLoading(loading) {
  loginButton.disabled = loading;
  loginEmail.disabled = loading;
  loginPassword.disabled = loading;
  loginButton.textContent = loading ? "Signing in…" : "Sign in";
}

updateClock();
setInterval(updateClock, 1000);

showStatus("Loading Firebase…");

if (typeof firebase === "undefined") {
  showStatus("Firebase SDK did not load.");
  throw new Error("Firebase global object is unavailable.");
}

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

auth
  .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch((error) => {
    console.error("Persistence failed:", error);
  });

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginError.textContent = "";
  setLoginLoading(true);

  try {
    await auth.signInWithEmailAndPassword(
      loginEmail.value.trim(),
      loginPassword.value
    );

    loginPassword.value = "";
  } catch (error) {
    console.error("Sign-in failed:", error);

    loginError.textContent =
      `${error.code || "auth/error"}: ${error.message}`;
  } finally {
    setLoginLoading(false);
  }
});

auth.onAuthStateChanged((user) => {
  if (!user) {
    showLogin();
    showStatus("Sign in to view the calendar.");
    return;
  }

  hideLogin();
  showStatus("Signed in. Loading calendar…");

  db.collection("dashboard")
    .doc("calendar")
    .onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) {
          showStatus("Calendar document does not exist.");
          return;
        }

        renderCalendar(snapshot.data());
      },
      (error) => {
        console.error("Firestore read failed:", error);

        showStatus(
          `${error.code || "firestore/error"}: ${error.message}`
        );
      }
    );
});

function renderCalendar(event) {
  const start = event.start
    ? new Date(event.start)
    : null;

  const startLabel =
    start && !Number.isNaN(start.getTime())
      ? start.toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        })
      : "Time unavailable";

  eventList.innerHTML = `
    <li class="event-item">
      <div class="event-item__time">
        ${escapeHtml(startLabel)}
      </div>

      <div class="event-item__body">
        <div class="event-item__title">
          ${escapeHtml(event.title || "Untitled event")}
        </div>

        <div class="event-item__meta">
          ${escapeHtml(event.location || "")}
        </div>
      </div>
    </li>
  `;
}
