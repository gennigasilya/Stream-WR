require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { JWT: GoogleJWT } = require("google-auth-library");

const app = express();
app.disable("x-powered-by");
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
// TEMPORARY diagnostic — remove once login is confirmed working. Logs only the count and each
// email (never the hash), so this is safe to leave in Railway's log output briefly.
console.log("ADMIN_USERS loaded:", ADMIN_USERS.length, "account(s) —", ADMIN_USERS.map((u) => u.email));

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

// Railway terminates TLS at its edge and forwards internally over plain HTTP, tagging the
// original protocol via X-Forwarded-Proto — trust proxy makes Express's req.secure reflect that
// real value instead of always reading false, which matters for the cookie's Secure flag below.
app.set("trust proxy", 1);
// Helmet's strict defaults broke two things a live check caught: streamer photos (admins paste
// arbitrary photo URLs — Google Drive links, anywhere — so img-src needs any https: source, not
// just 'self'/data:) and Firebase (loaded from gstatic.com's CDN, then talks to its realtime
// backend over its own domains for the live cross-device sync elsewhere in this app).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https:"],
      "script-src": ["'self'", "https://www.gstatic.com"],
      "connect-src": ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com", "https://*.firebasedatabase.app", "wss://*.firebaseio.com", "wss://*.firebasedatabase.app"],
    },
  },
}));
app.use(express.json());
app.use(cookieParser());
// The client files ended up flattened into this same directory as the server source (a GitHub
// web-upload quirk, not intentional) — express.static(__dirname) would work, but it would also
// serve index.js, package.json, hash-password.js etc. straight to any visitor, which defeats
// the whole point of moving the sheet ID and gids server-side. Serve only the specific
// client-facing paths instead; everything else 404s.
["css", "js", "data"].forEach((dir) => {
  app.use("/" + dir, express.static(path.join(__dirname, dir)));
});
app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ---------------- Auth ----------------
// 10 rapid guesses against a short password (see the "CDM" discussion) went through completely
// unthrottled during a review of this deployment — every one hit bcrypt.compare with no penalty.
// Capped at 10 attempts per 15 minutes per IP; deliberately counts every attempt (not just
// failures) so it can't be reset by pausing between guesses.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
});

// A dummy hash to compare against when the email isn't found, purely so bcrypt.compare's ~100ms
// cost is paid on that path too — otherwise "no such user" returns near-instantly while "wrong
// password" takes noticeably longer, and that timing gap alone lets someone map out which emails
// have real accounts without ever seeing a different error message.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

// The password itself is only ever compared here, server-side, via bcrypt — the browser sends
// the plain password once over HTTPS and gets back either a session cookie or a 401. It never
// receives the hash, and the hash is never reachable from any client-facing route.
//
// A live check against this deployment sent {"password":{"$ne":null}} instead of a string and
// it took the whole site down: bcrypt.compare() throws on a non-string input, that throw becomes
// an unhandled promise rejection inside this async handler (Express 4 does not catch those on
// its own), and the process crashed — repeatable by anyone, no login required. Fixed with an
// explicit typeof check up front and a try/catch as a second layer underneath it.
app.post("/api/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ error: "missing email/password" });
    }
    const user = ADMIN_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: "invalid credentials" });
    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
    res.cookie("session", token, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      maxAge: SESSION_HOURS * 60 * 60 * 1000,
    });
    res.json({ ok: true, email: user.email });
  } catch (e) {
    res.status(400).json({ error: "invalid request" });
  }
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
  res.sendFile(path.join(__dirname, "index.html"));
});

// Last-resort net for any route that throws unexpectedly (must be defined last, with all 4
// args, or Express won't treat it as an error handler) — the /api/login crash above is exactly
// the kind of bug this exists to contain if it ever happens somewhere else instead.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () => {
  console.log(`Streamer Manager server listening on :${PORT}`);
});
