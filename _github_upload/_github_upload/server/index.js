require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT: GoogleJWT } = require("google-auth-library");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_HOURS = 12;

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET env var — refusing to start (sessions would be forgeable without it).");
  process.exit(1);
}

// ADMIN_USERS env var: JSON array of {"email":"...","passwordHash":"$2a$..."}.
// Generate a hash with: node hash-password.js "the password" — never put a plain password here.
let ADMIN_USERS = [];
try {
  ADMIN_USERS = JSON.parse(process.env.ADMIN_USERS || "[]");
} catch (e) {
  console.error("ADMIN_USERS env var is not valid JSON — no one will be able to log in until it's fixed.");
}

// The sheet ID and per-tab gids used to live in the shipped client JS (js/db.js), readable by
// anyone who opened the page source. They live only here now — the browser never sees them,
// only the CSV content this server chooses to hand back.
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const SHEET_MONTH_TABS = [
  { name: "มีนาคม 2569", gid: 1290161276 },
  { name: "เมษายน 2569", gid: 825844125 },
  { name: "พฤษภาคม 2569", gid: 395929126 },
  { name: "มิถุนายน 2569", gid: 132773539 },
  { name: "กรกฎาคม 2569", gid: 1398685991 },
  { name: "สิงหาคม 2569", gid: 2081502206 },
  { name: "กันยายน 2569", gid: 1965405291 },
  { name: "ตุลาคม 2569", gid: 929378145 },
  { name: "พฤศจิกายน 2569", gid: 1192033499 },
  { name: "ธันวาคม 2569", gid: 1508262743 },
];
const SETUP_GID = 1774117405;

// GOOGLE_SERVICE_ACCOUNT_JSON env var: the full JSON key downloaded from Google Cloud Console
// for a service account with read access (shared via the Sheet's own Share dialog) — see
// server/README.md. Reading a private sheet requires the Sheets API (not the old public CSV
// export link, which now 401s since the sheet was locked down).
let GOOGLE_SERVICE_ACCOUNT = null;
try {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
} catch (e) {
  console.error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — sheet sync will fail until it's fixed.");
}

let googleAuthClient = null;
function getGoogleAuthClient() {
  if (!GOOGLE_SERVICE_ACCOUNT) return null;
  if (!googleAuthClient) {
    googleAuthClient = new GoogleJWT({
      email: GOOGLE_SERVICE_ACCOUNT.client_email,
      key: GOOGLE_SERVICE_ACCOUNT.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  return googleAuthClient;
}

// gid (numeric sheetId) -> tab title, resolved once and cached — the Sheets API addresses
// ranges by title, not gid, so this is required before every values.get call below.
let titleByGidCache = null;
async function getTitleByGid(client) {
  if (titleByGidCache) return titleByGidCache;
  const res = await client.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
  });
  titleByGidCache = {};
  (res.data.sheets || []).forEach((s) => { titleByGidCache[s.properties.sheetId] = s.properties.title; });
  return titleByGidCache;
}

// Re-serializes the Sheets API's values.get response (a 2D array, formatted the same way the
// user sees the cell — dates as "dd/mm/yyyy" text, not serial numbers) back into CSV text, so
// the existing client-side parsers (parseSheetCSV / parseSetupCSV in js/db.js, unchanged) keep
// working exactly as before — only the fetch source changed underneath them.
function rowsToCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const s = cell === null || cell === undefined ? "" : String(cell);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\r\n");
}

async function fetchTabAsCsv(gid) {
  const client = getGoogleAuthClient();
  if (!client) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  const titleByGid = await getTitleByGid(client);
  const title = titleByGid[gid];
  if (!title) throw new Error(`No tab with gid ${gid} found in the spreadsheet`);
  const res = await client.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(title)}`,
    params: { valueRenderOption: "FORMATTED_VALUE" },
  });
  return rowsToCsv(res.data.values || []);
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ---------------- Auth ----------------
// The password itself is only ever compared here, server-side, via bcrypt — the browser sends
// the plain password once over HTTPS and gets back either a session cookie or a 401. It never
// receives the hash, and the hash is never reachable from any client-facing route.
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "missing email/password" });
  const user = ADMIN_USERS.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });
  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
  res.cookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  });
  res.json({ ok: true, email: user.email });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.json({ authed: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ authed: true, email: payload.email });
  } catch (e) {
    res.json({ authed: false });
  }
});

// ---------------- Google Sheet proxy ----------------
// Dashboard/Live/Setup Queue are meant to stay public, so these endpoints aren't behind login —
// the win here isn't hiding the schedule itself, it's that the actual spreadsheet (ID, gids,
// other tabs/columns, edit history) is no longer directly reachable by anyone. Only this server,
// via its own service account, can read it now that the sheet is private.
app.get("/api/sheet/schedule", async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: "GOOGLE_SHEET_ID not configured" });
  const failedTabs = [];
  const tabs = await Promise.all(SHEET_MONTH_TABS.map(async (tab) => {
    try {
      const csvText = await fetchTabAsCsv(tab.gid);
      return { name: tab.name, csvText };
    } catch (e) {
      failedTabs.push(tab.name);
      return { name: tab.name, csvText: "" };
    }
  }));
  res.json({ tabs, failedTabs });
});

app.get("/api/sheet/setup", async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: "GOOGLE_SHEET_ID not configured" });
  try {
    const csvText = await fetchTabAsCsv(SETUP_GID);
    res.json({ csvText });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Hash-based client routing (#dashboard, #admin, ...) never hits the server on navigation, so
// this is just a safety net for a direct/bookmarked load.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Streamer Manager server listening on :${PORT}`);
});
