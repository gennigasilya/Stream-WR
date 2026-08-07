// Firebase Realtime Database — used only to sync the "tournament (free)" flag on schedule
// entries across devices/team members in real time, since localStorage alone is per-browser
// and different staff toggling this on their own device would never see each other's changes,
// leading to wrong Monthly Summary totals. Everything else in the app still works exactly the
// same (localStorage) if Firebase fails to load (ad-blocker, offline, etc.) — fbDb just stays
// null and the sync functions in db.js no-op.
const firebaseConfig = {
  apiKey: "AIzaSyAXaOabKKf_q_kpwFxam_NXq6Q4C5aGURc",
  authDomain: "genniga-7b94d.firebaseapp.com",
  databaseURL: "https://genniga-7b94d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "genniga-7b94d",
  storageBucket: "genniga-7b94d.firebasestorage.app",
  messagingSenderId: "453707544395",
  appId: "1:453707544395:web:839b3d30a317516c3d9ace",
};

let fbDb = null;
try {
  if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);
    fbDb = firebase.database();
  }
} catch (e) {
  fbDb = null;
}
