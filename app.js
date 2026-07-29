"use strict";

var firebaseConfig = {
  apiKey: "AIzaSyCABzIRuasTt8jFuxc5YA5tdS-dPNLrU88",
  authDomain: "wright-home-dashboard.firebaseapp.com",
  projectId: "wright-home-dashboard",
  storageBucket: "wright-home-dashboard.firebasestorage.app",
  messagingSenderId: "1090775992930",
  appId: "1:1090775992930:web:d4674faf64f9644b669f3b"
};

var clockTime = document.getElementById("clock-time");
var clockDate = document.getElementById("clock-date");
var eventList = document.getElementById("event-list");

var loginPanel = document.getElementById("firebase-login");
var loginForm = document.getElementById("login-form");
var loginEmail = document.getElementById("login-email");
var loginPassword = document.getElementById("login-password");
var loginButton = document.getElementById("login-button");
var loginError = document.getElementById("login-error");

function escapeHtml(value) {
  var element = document.createElement("div");

  if (value === null || value === undefined) {
    value = "";
  }

  element.textContent = String(value);
  return element.innerHTML;
}

function showStatus(message) {
  if (!eventList) {
    return;
  }

  eventList.innerHTML =
    '<li class="event-list__empty">' +
    escapeHtml(message) +
    "</li>";
}

function updateClock() {
  var now = new Date();

  if (clockTime) {
    clockTime.textContent = now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  if (clockDate) {
    clockDate.textContent = now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  }
}

function showLogin() {
  if (loginPanel) {
    loginPanel.hidden = false;
  }
}

function hideLogin() {
  if (loginPanel) {
    loginPanel.hidden = true;
  }
}

function setLoginLoading(loading) {
  if (loginButton) {
    loginButton.disabled = loading;
    loginButton.textContent = loading
      ? "Signing in..."
      : "Sign in";
  }

  if (loginEmail) {
    loginEmail.disabled = loading;
  }

  if (loginPassword) {
    loginPassword.disabled = loading;
  }
}

function renderCalendar(eventData) {
  var start = eventData.start
    ? new Date(eventData.start)
    : null;

  var startLabel = "Time unavailable";

  if (start && !isNaN(start.getTime())) {
    startLabel = start.toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  var title = eventData.title || "Untitled event";
  var location = eventData.location || "";

  eventList.innerHTML =
    '<li class="event-item">' +
      '<div class="event-item__time">' +
        escapeHtml(startLabel) +
      "</div>" +
      '<div class="event-item__body">' +
        '<div class="event-item__title">' +
          escapeHtml(title) +
        "</div>" +
        '<div class="event-item__meta">' +
          escapeHtml(location) +
        "</div>" +
      "</div>" +
    "</li>";
}

updateClock();
window.setInterval(updateClock, 1000);

showStatus("Loading Firebase...");

if (typeof firebase === "undefined") {
  showStatus("Firebase SDK did not load.");
  throw new Error("Firebase SDK is unavailable.");
}

firebase.initializeApp(firebaseConfig);

var auth = firebase.auth();
var db = firebase.firestore();

auth
  .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(function (error) {
    console.error("Persistence failed:", error);
  });

if (loginForm) {
  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();

    loginError.textContent = "";
    setLoginLoading(true);

    auth
      .signInWithEmailAndPassword(
        loginEmail.value.trim(),
        loginPassword.value
      )
      .then(function () {
        loginPassword.value = "";
      })
      .catch(function (error) {
        console.error("Sign-in failed:", error);

        loginError.textContent =
          (error.code || "auth/error") +
          ": " +
          error.message;
      })
      .then(function () {
        setLoginLoading(false);
      });
  });
}

auth.onAuthStateChanged(function (user) {
  if (!user) {
    showLogin();
    showStatus("Sign in to view the calendar.");
    return;
  }

  hideLogin();
  showStatus("Signed in. Loading calendar...");

  db.collection("dashboard")
    .doc("calendar")
    .onSnapshot(
      function (snapshot) {
        if (!snapshot.exists) {
          showStatus("Calendar document does not exist.");
          return;
        }

        renderCalendar(snapshot.data());
      },
      function (error) {
        console.error("Firestore read failed:", error);

        showStatus(
          (error.code || "firestore/error") +
          ": " +
          error.message
        );
      }
    );
});
