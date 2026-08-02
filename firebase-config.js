/* ══════════════════════════════════════════════════════════════
   firebase-config.js — YOUR keys. Edit this file and no other.

   Nothing else in the project will ever overwrite this, so an
   updated app.js or config.js can't wipe your credentials.

   To fill it in:
     Firebase Console → Project settings → Your apps → Web app →
     "Config". Copy their whole snippet and paste it over the
     block below, from `const firebaseConfig = {` through `};`.
     The variable name matches theirs, so no editing is needed.

   Safe to commit. Firebase web config is public by design — it
   ships in your page source regardless, and your security comes
   from the database rules and authorized domains.

   Leave it blank and the dashboard runs in local mode, storing
   everything in the browser it's open in.
   ══════════════════════════════════════════════════════════════ */

export const firebaseConfig = {
  apiKey: "AIzaSyCABzIRuasTt8jFuxc5YA5tdS-dPNLrU88",
  authDomain: "wright-home-dashboard.firebaseapp.com",
  databaseURL: "https://wright-home-dashboard-default-rtdb.firebaseio.com",
  projectId: "wright-home-dashboard",
  storageBucket: "wright-home-dashboard.firebasestorage.app",
  messagingSenderId: "1090775992930",
  appId: "1:1090775992930:web:d4674faf64f9644b669f3b"
};
