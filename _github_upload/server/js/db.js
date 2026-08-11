// Data layer: localStorage-backed store, seeded from data/seed.json on first run.
const DB = (() => {
  const STORAGE_KEY = "streamer_manager_db_v1";
  // The sheet ID and every tab's gid used to live here, visible to anyone reading the shipped
  // JS. They now live only in server/index.js — this file just asks the server's own API for
  // the CSV text, the same shape parseSheetCSV/parseSetupCSV already expected.
  let state = null;

  function splitCSVLine(line) {
    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        result.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur);
    return result;
  }

  // Full-table CSV parser that (unlike splitCSVLine + naive line-splitting used elsewhere in
  // this file) correctly handles quoted cells containing literal embedded newlines — needed
  // for the Brief tab, whose promo-text cells are genuinely multi-line.
  function parseCSVTable(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cur += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(cur); cur = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(cur); cur = ""; rows.push(row); row = []; i++; continue; }
      cur += c; i++;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // Parses the "ตาราง Set Up" tab: row 1 is a title ("SET UP OBS"), row 2 is the header
  // (Streamer, GAME, วันที่, เวลา, status). Game names and date formats here are whatever staff
  // typed by hand (not our 5-game enum, not a consistent date format), so both are kept as raw
  // text rather than mapped/parsed — this is a display/reference table, not schedule data.
  // Columns: Streamer, GAME, วันที่ (set date), เวลา, วันไลฟ์ (live date — added later by staff;
  // "FALSE" or blank means not filled in yet), status. Live date lets Set-vs-Live lead time be
  // checked directly against what staff actually confirmed, rather than guessed from schedule data.
  function parseSetupCSV(csvText) {
    const rows = parseCSVTable(csvText).slice(2);
    const records = [];
    rows.forEach((cols) => {
      const streamerName = (cols[0] || "").trim();
      if (!streamerName) return;
      const liveDateRaw = (cols[4] || "").trim();
      records.push({
        streamerName,
        game: (cols[1] || "").trim(),
        dateRaw: (cols[2] || "").trim(),
        time: (cols[3] || "").trim(),
        liveDateRaw: liveDateRaw.toUpperCase() === "FALSE" ? "" : liveDateRaw,
        done: (cols[5] || "").trim().toLowerCase() === "done",
      });
    });
    return records;
  }

  // Replaces the whole setup-queue table from the sheet (it's a flat historical log, not
  // date-scoped data to merge).
  async function syncSetupFromSheet() {
    const res = await fetch("/api/sheet/setup");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { csvText } = await res.json();
    state.setupRecords = parseSetupCSV(csvText);
    save();
    return { count: state.setupRecords.length };
  }

  function listSetupRecords() {
    return state.setupRecords || [];
  }

  // Distinct games a streamer already has a "Done" setup record for, by name (case-insensitive).
  function setupGamesForStreamer(name) {
    const key = (name || "").trim().toLowerCase();
    const games = new Set();
    listSetupRecords().forEach((r) => {
      if (r.done && r.streamerName.trim().toLowerCase() === key) games.add(r.game);
    });
    return Array.from(games);
  }

  function mapSheetGameId(raw) {
    const t = (raw || "").trim();
    if (/^TOSM$/.test(t)) return "tosm";
    if (/^Zone4/.test(t)) return "zone4";
    if (/^Cabal/.test(t)) return "cabal";
    if (/^TR$/.test(t)) return "tr";
    if (/^WARZ$/.test(t)) return "warz";
    return null;
  }

  // Parses the sheet's raw CSV export into flat {date, time, gameId, streamerName, program} rows,
  // forward-filling the merged Date column the same way the original PowerShell importer did.
  function parseSheetCSV(csvText) {
    const lines = csvText.split(/\r\n|\n/).slice(2); // row1 is blank, row2 is the header row
    let currentDate = null;
    const rows = [];
    lines.forEach((line) => {
      if (line === "") return;
      const [dateRaw, time, game, program, kol] = splitCSVLine(line);
      const dateTrim = (dateRaw || "").trim();
      if (dateTrim) {
        const parts = dateTrim.split("/");
        if (parts.length === 3) {
          currentDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
        }
      }
      if (!currentDate) return;
      const streamerName = (kol || "").trim();
      if (!streamerName) return;
      const gameId = mapSheetGameId(game);
      if (!gameId) return;
      rows.push({ date: currentDate, time: (time || "").trim(), gameId, streamerName, program: (program || "").trim() });
    });
    return rows;
  }

  function defaultState() {
    return { games: [], streamers: [], schedule: [], dayStatus: {}, setupRecords: [] };
  }

  // A handful of streamer records on live Firebase data have been found missing their `prices`
  // array entirely (Firebase strips empty arrays on write, and an older code path once saved
  // that raw shape straight into localStorage too) — anything that reads `.prices` without
  // checking crashes the whole page. Repair any such records once on every load, whichever
  // source they came from, so a stale corrupted snapshot can't keep crashing forever.
  function repairStreamers() {
    if (!state || !Array.isArray(state.streamers)) return;
    state.streamers.forEach((s) => {
      if (!Array.isArray(s.prices)) s.prices = [];
      const avail = s.availability || {};
      s.availability = {
        timeSlots: Array.isArray(avail.timeSlots) ? avail.timeSlots : [],
        days: Array.isArray(avail.days) ? avail.days : [],
        needsCheck: !!avail.needsCheck,
      };
    });
  }

  async function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      repairStreamers();
      save();
      return state;
    }
    // data/seed.json is now gated behind login (see server/index.js) — an unauthenticated
    // first-time visitor gets a 401 here, not a network error, so this has to check res.ok
    // itself rather than relying on fetch() to throw. Falling through to defaultState() is
    // correct either way: app.js runs an immediate schedule sync right after load() that
    // populates real (public) schedule data from the sheet regardless of login state.
    try {
      const res = await fetch("data/seed.json", { credentials: "include" });
      state = res.ok ? await res.json() : defaultState();
    } catch (e) {
      state = defaultState();
    }
    repairStreamers();
    save();
    return state;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function get() {
    return state;
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Games ----------
  function listGames() {
    return state.games;
  }
  function getGame(id) {
    return state.games.find((g) => g.id === id);
  }
  function addGame(g) {
    const game = { id: uid("g"), name: g.name, fullName: g.fullName || g.name, color: g.color || "#64748b", youtubeUrl: g.youtubeUrl || null, channelId: g.channelId || null, brief: { text: "", startDate: null, endDate: null } };
    state.games.push(game);
    save();
    return game;
  }
  function updateGame(id, patch) {
    const g = getGame(id);
    if (!g) return;
    Object.assign(g, patch);
    save();
  }

  // ---------- Streamers ----------
  function listStreamers() {
    return state.streamers;
  }
  function getStreamer(id) {
    return state.streamers.find((s) => s.id === id);
  }
  // Pushes one streamer's full record to the server (keyed by its stable id), which relays it
  // to Firebase via the Admin SDK — so an edit made in the web Admin UI — as opposed to the
  // sheet-import sync, which already reaches every device via the sheet itself — shows up for
  // everyone else within one polling cycle too. Fire-and-forget: never blocks the local save.
  // Requires an authenticated session; silently no-ops (via .catch) if not logged in, same as
  // it silently no-op'd before when Firebase hadn't loaded.
  function pushStreamerToFirebase(streamerId) {
    const s = getStreamer(streamerId);
    if (!s) return;
    fetch("/api/streamers/" + encodeURIComponent(streamerId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(s),
    }).catch(() => {});
  }

  function addStreamer(name) {
    const s = { id: uid("s"), name, photo: null, prices: [], availability: { timeSlots: [], days: [], needsCheck: false }, emergencyAvailable: false };
    state.streamers.push(s);
    save();
    pushStreamerToFirebase(s.id);
    return s;
  }
  function updateStreamer(id, patch) {
    const s = getStreamer(id);
    if (!s) return;
    Object.assign(s, patch);
    save();
    pushStreamerToFirebase(id);
  }
  function deleteStreamer(id) {
    state.streamers = state.streamers.filter((s) => s.id !== id);
    state.schedule = state.schedule.filter((e) => e.streamerId !== id);
    save();
    fetch("/api/streamers/" + encodeURIComponent(id), { method: "DELETE", credentials: "include" }).catch(() => {});
  }

  // ---------- Prices (per streamer, per game) ----------
  function setPrice(streamerId, gameId, normalPrice, discountPrice) {
    const s = getStreamer(streamerId);
    if (!s) return;
    let p = s.prices.find((p) => p.gameId === gameId);
    if (!p) {
      p = { gameId, normalPrice: 0, discountPrice: null };
      s.prices.push(p);
    }
    p.normalPrice = normalPrice;
    p.discountPrice = discountPrice === "" || discountPrice === null || discountPrice === undefined ? null : discountPrice;
    save();
    pushStreamerToFirebase(streamerId);
  }
  function deletePrice(streamerId, gameId) {
    const s = getStreamer(streamerId);
    if (!s) return;
    s.prices = s.prices.filter((p) => p.gameId !== gameId);
    save();
    pushStreamerToFirebase(streamerId);
  }
  function getPrice(streamerId, gameId) {
    const s = getStreamer(streamerId);
    if (!s || !Array.isArray(s.prices)) return null;
    return s.prices.find((p) => p.gameId === gameId) || null;
  }
  // Effective price used for totals: discount price if set, otherwise normal price.
  function effectivePrice(streamerId, gameId) {
    const p = getPrice(streamerId, gameId);
    if (!p) return { normal: 0, actual: 0 };
    const normal = Number(p.normalPrice) || 0;
    const actual = p.discountPrice !== null && p.discountPrice !== undefined && p.discountPrice !== "" ? Number(p.discountPrice) : normal;
    return { normal, actual };
  }

  // ---------- Schedule ----------
  function listSchedule() {
    return state.schedule;
  }
  function listScheduleByDate(date) {
    return state.schedule.filter((e) => e.date === date);
  }
  function listScheduleByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return state.schedule.filter((e) => e.date.startsWith(prefix));
  }
  function addScheduleEntry(entry) {
    const e = { id: uid("e"), date: entry.date, time: entry.time || "", gameId: entry.gameId, streamerId: entry.streamerId, program: entry.program || "", isTournament: !!entry.isTournament };
    state.schedule.push(e);
    save();
    return e;
  }
  function updateScheduleEntry(id, patch) {
    const e = state.schedule.find((e) => e.id === id);
    if (!e) return;
    Object.assign(e, patch);
    save();
  }
  function deleteScheduleEntry(id) {
    state.schedule = state.schedule.filter((e) => e.id !== id);
    save();
  }
  // Schedule entry IDs are regenerated on every sheet resync (see applyScheduleRows), so they
  // can't be used as a stable cross-device key for the tournament flag — this composite key
  // (date+time+game+streamer name) is what's already used locally to carry the flag through a
  // resync, and doubles as the Firebase path key. Firebase Realtime Database keys can't contain
  // ". # $ [ ] /", so those are stripped out.
  function fbTournamentKey(date, time, gameId, streamerName) {
    const clean = (s) => String(s || "").replace(/[.#$\[\]/]/g, "_");
    return `${date}_${clean(time)}_${gameId}_${clean(streamerName)}`;
  }

  function setEntryTournament(id, isTournament) {
    const e = state.schedule.find((e) => e.id === id);
    if (!e) return;
    e.isTournament = isTournament;
    save();
    const s = getStreamer(e.streamerId);
    if (!s) return;
    const key = fbTournamentKey(e.date, e.time, e.gameId, s.name);
    fetch("/api/tournament-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key, value: isTournament }),
    }).catch(() => {});
  }

  // Overlays Firebase's tournament flags (the cross-device source of truth) onto the current
  // schedule. Called both when Firebase pushes a live update and right after every schedule
  // resync (which would otherwise reset flags to whatever the old same-device carry-over found).
  let lastTournamentSnapshot = null;
  function applyTournamentFlagsFromSnapshot(snapshotVal) {
    if (!snapshotVal) return false;
    const idToName = {};
    state.streamers.forEach((s) => { idToName[s.id] = s.name; });
    let changed = false;
    state.schedule.forEach((e) => {
      const name = idToName[e.streamerId];
      if (!name) return;
      const flag = !!snapshotVal[fbTournamentKey(e.date, e.time, e.gameId, name)];
      if (e.isTournament !== flag) { e.isTournament = flag; changed = true; }
    });
    if (changed) save();
    return changed;
  }

  const POLL_INTERVAL_MS = 20000;
  let tournamentListenerAttached = false;
  // Used to sync live tournament-flag changes from any device; onChange is called (with no
  // args) whenever something actually changed, so the caller can re-render. Safe to call
  // multiple times — only attaches once. Polls the server instead of a live Firebase
  // subscription now that the browser can't reach Firebase directly (see server/index.js) —
  // near-real-time (within one interval) rather than instant. A 401 (not logged in) just skips
  // this cycle silently and tries again next interval, so logging in later self-heals it
  // without a page reload.
  function listenTournamentFlags(onChange) {
    if (tournamentListenerAttached) return;
    tournamentListenerAttached = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/tournament-flags", { credentials: "include" });
        if (!res.ok) return;
        const { flags } = await res.json();
        lastTournamentSnapshot = flags;
        const changed = applyTournamentFlagsFromSnapshot(flags);
        if (changed && typeof onChange === "function") onChange();
      } catch (e) {}
    };
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }

  // Merges streamer records pushed to Firebase (by pushStreamerToFirebase, above) into local
  // state — adds ones this device doesn't have yet, updates ones that changed, and removes ones
  // that are gone from the remote snapshot (every streamer, however it was created, gets pushed
  // to Firebase — see addStreamer — so the "streamers" node is a true superset; a device missing
  // that removal notices its Admin list quietly drift back out of sync with everyone else's,
  // which is exactly what re-grew the duplicate/garbage list after a cleanup on one device).
  // Firebase Realtime Database silently drops empty arrays/objects on write — a streamer with
  // no time slots set (timeSlots: []) comes back from Firebase with no timeSlots key at all, not
  // an empty array. A shallow merge would then overwrite a perfectly good local record with one
  // missing those keys, which crashes the Admin table (it assumes .timeSlots/.days/.prices are
  // always arrays). Normalize remote data back into our real shape before ever touching local state.
  function normalizeStreamerFromFirebase(remote) {
    const avail = remote.availability || {};
    return {
      id: remote.id,
      name: remote.name || "",
      photo: remote.photo || null,
      prices: Array.isArray(remote.prices) ? remote.prices : [],
      availability: {
        timeSlots: Array.isArray(avail.timeSlots) ? avail.timeSlots : [],
        days: Array.isArray(avail.days) ? avail.days : [],
        needsCheck: !!avail.needsCheck,
      },
      emergencyAvailable: !!remote.emergencyAvailable,
    };
  }

  function applyStreamersFromSnapshot(snapshotVal) {
    if (!snapshotVal) return false;
    let changed = false;
    const localById = {};
    state.streamers.forEach((s) => { localById[s.id] = s; });
    Object.keys(snapshotVal).forEach((id) => {
      const rawRemote = snapshotVal[id];
      if (!rawRemote) return;
      const remote = normalizeStreamerFromFirebase(rawRemote);
      const local = localById[id];
      if (!local) {
        state.streamers.push(remote);
        changed = true;
      } else if (JSON.stringify(local) !== JSON.stringify(remote)) {
        Object.assign(local, remote);
        changed = true;
      }
    });
    const removedIds = state.streamers.filter((s) => !snapshotVal[s.id]).map((s) => s.id);
    if (removedIds.length) {
      const removedSet = new Set(removedIds);
      state.streamers = state.streamers.filter((s) => !removedSet.has(s.id));
      state.schedule = state.schedule.filter((e) => !removedSet.has(e.streamerId));
      changed = true;
    }
    if (changed) save();
    return changed;
  }

  let streamerListenerAttached = false;
  // Same polling approach as listenTournamentFlags, and the same reasoning applies.
  function listenStreamerUpdates(onChange) {
    if (streamerListenerAttached) return;
    streamerListenerAttached = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/streamers", { credentials: "include" });
        if (!res.ok) return;
        const { streamers } = await res.json();
        const changed = applyStreamersFromSnapshot(streamers);
        if (changed && typeof onChange === "function") onChange();
      } catch (e) {}
    };
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }

  // ---------- Day status: normal | no_live (whole day cancelled) ----------
  function getDayStatus(date) {
    return state.dayStatus[date] || "normal";
  }
  function setDayStatus(date, status) {
    if (status === "normal") {
      delete state.dayStatus[date];
    } else {
      state.dayStatus[date] = status;
    }
    save();
  }

  // Cost of a single schedule entry, accounting for day cancellation and per-entry tournament (free) status.
  function getEntryCost(entry) {
    if (getDayStatus(entry.date) === "no_live") {
      return { normal: 0, actual: 0, excluded: true, free: false };
    }
    if (entry.isTournament) {
      return { normal: 0, actual: 0, excluded: false, free: true };
    }
    const price = effectivePrice(entry.streamerId, entry.gameId);
    return { normal: price.normal, actual: price.actual, excluded: false, free: false };
  }

  // ---------- Import/Export ----------
  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(json) {
    const parsed = JSON.parse(json);
    state = parsed;
    save();
  }
  function resetToSeed() {
    localStorage.removeItem(STORAGE_KEY);
    return load();
  }

  // Once a browser has saved data in localStorage, load() never looks at the bundled seed
  // again — so a device that first opened the app before a game's youtubeUrl/channelId was
  // set (or before it changed) is stuck with the old value forever. This pulls just those two
  // fields from the bundled seed into the existing games, without touching anything else
  // (streamers, schedule, prices, or any other admin edits stay exactly as they are).
  async function syncGamesFromSeed() {
    let seed;
    if (typeof SEED_DATA !== "undefined") {
      seed = SEED_DATA;
    } else {
      const res = await fetch("data/seed.json");
      seed = await res.json();
    }
    let updated = 0;
    seed.games.forEach((sg) => {
      const g = getGame(sg.id);
      if (g) {
        g.youtubeUrl = sg.youtubeUrl;
        g.channelId = sg.channelId;
      } else {
        state.games.push({ ...sg });
      }
      updated++;
    });
    save();
    return { updated };
  }

  // Same staleness problem as syncGamesFromSeed, but for streamer photos bulk-imported into
  // the bundled seed after a device's localStorage was already created. Only fills in a photo
  // for a streamer who currently has none — never overwrites a photo someone already set
  // (bundled default or a custom upload), and matches by name like the other sheet syncs.
  async function syncPhotosFromSeed() {
    let seed;
    if (typeof SEED_DATA !== "undefined") {
      seed = SEED_DATA;
    } else {
      const res = await fetch("data/seed.json");
      seed = await res.json();
    }
    const byName = {};
    seed.streamers.forEach((s) => { byName[s.name] = s; });
    let updated = 0;
    state.streamers.forEach((s) => {
      const seedS = byName[s.name];
      if (seedS && seedS.photo && !s.photo) {
        s.photo = seedS.photo;
        updated++;
      }
    });
    save();
    return { updated };
  }

  // Replaces the schedule with the given flat {date,time,gameId,streamerName,program} rows,
  // matching streamers by name so existing profiles (prices, photo, availability) are left untouched.
  // New streamer names are added; per-entry tournament (free) flags carry over when the same
  // date+time+game+streamer combination still exists in the new rows.
  // Staff type KOL names into the sheet by hand, so the same person shows up as "1nonCh" in one
  // row and "1nonch" in another. Matching (and the tournament-flag carry-over key below) both go
  // through this normalized form so a case/spacing slip never spawns a duplicate streamer.
  function normStreamerName(name) {
    return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function applyScheduleRows(rows) {
    const nameToId = {};
    state.streamers.forEach((s) => { nameToId[normStreamerName(s.name)] = s.id; });
    let addedStreamers = 0;
    const seenKeys = new Set();
    rows.forEach((r) => {
      const key = normStreamerName(r.streamerName);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      if (!nameToId[key]) {
        const created = addStreamer(r.streamerName);
        nameToId[key] = created.id;
        addedStreamers++;
      }
    });

    const idToName = {};
    state.streamers.forEach((s) => { idToName[s.id] = s.name; });
    const oldTournamentKeys = new Set();
    state.schedule.forEach((e) => {
      if (!e.isTournament) return;
      const name = idToName[e.streamerId];
      if (!name) return;
      oldTournamentKeys.add(`${e.date}|${e.time}|${e.gameId}|${normStreamerName(name)}`);
    });

    state.schedule = rows.map((r) => {
      const normName = normStreamerName(r.streamerName);
      const key = `${r.date}|${r.time}|${r.gameId}|${normName}`;
      return {
        id: uid("e"),
        date: r.date,
        time: r.time,
        gameId: r.gameId,
        streamerId: nameToId[normName],
        program: r.program,
        isTournament: oldTournamentKeys.has(key),
      };
    });
    // Firebase (cross-device) wins over the same-device carry-over above, if we have a cached
    // snapshot — otherwise a resync would silently drop tournament flags set from another device.
    if (lastTournamentSnapshot) applyTournamentFlagsFromSnapshot(lastTournamentSnapshot);
    save();
    return { addedStreamers, newCount: state.schedule.length };
  }

  // Refreshes the schedule from the sheet snapshot embedded/bundled with this file (offline fallback).
  async function syncScheduleFromSeed() {
    let seed;
    if (typeof SEED_DATA !== "undefined") {
      seed = SEED_DATA;
    } else {
      const res = await fetch("data/seed.json");
      seed = await res.json();
    }
    const seedIdToName = {};
    seed.streamers.forEach((s) => { seedIdToName[s.id] = s.name; });
    const rows = seed.schedule.map((se) => ({
      date: se.date, time: se.time, gameId: se.gameId, streamerName: seedIdToName[se.streamerId], program: se.program,
    }));
    return applyScheduleRows(rows);
  }

  // Fetches every known month tab's CSV through the server's /api/sheet/schedule (which holds
  // the actual sheet ID and per-tab gids now — see server/index.js) and refreshes the schedule
  // from the combined result. A single tab failing there doesn't abort the rest — its rows are
  // just skipped and reported back in failedTabs.
  async function syncScheduleFromSheet() {
    const res = await fetch("/api/sheet/schedule");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { tabs, failedTabs } = await res.json();
    const allFailed = failedTabs.slice();
    const rows = tabs.flatMap((tab) => {
      if (!tab.csvText) return [];
      const parsed = parseSheetCSV(tab.csvText);
      if (!parsed.length && !allFailed.includes(tab.name)) allFailed.push(tab.name);
      return parsed;
    });
    if (!rows.length) throw new Error("ไม่พบข้อมูลในชีทเลย (ทุกแท็บดึงไม่ได้)");
    const applied = applyScheduleRows(rows);
    return { ...applied, failedTabs: allFailed };
  }

  return {
    load, save, get, uid,
    listGames, getGame, addGame, updateGame,
    listStreamers, getStreamer, addStreamer, updateStreamer, deleteStreamer,
    setPrice, deletePrice, getPrice, effectivePrice,
    listSchedule, listScheduleByDate, listScheduleByMonth, addScheduleEntry, updateScheduleEntry, deleteScheduleEntry, setEntryTournament,
    getDayStatus, setDayStatus, getEntryCost,
    exportJSON, importJSON, resetToSeed, syncScheduleFromSeed, syncScheduleFromSheet, syncGamesFromSeed, syncPhotosFromSeed,
    syncSetupFromSheet, listSetupRecords, setupGamesForStreamer,
    listenTournamentFlags, listenStreamerUpdates,
  };
})();
