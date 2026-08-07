// Public "Setup Queue" page — no login needed, so anyone on the team can check it. Shows a
// prominent "today" reminder (Thailand time) plus the full history synced from the
// "ตาราง Set Up" sheet tab.
const SetupQueue = (() => {
  let state = { search: "" };

  const THAI_MONTHS = {
    "ม.ค.": 0, "ก.พ.": 1, "มี.ค.": 2, "เม.ย.": 3, "พ.ค.": 4, "มิ.ย.": 5,
    "ก.ค.": 6, "ส.ค.": 7, "ก.ย.": 8, "ต.ค.": 9, "พ.ย.": 10, "ธ.ค.": 11,
  };

  // The sheet's date columns are free text, staff-typed in a couple of different formats over
  // time: "D MMM YYYY" (Thai abbreviated month, e.g. "12 ก.ค. 2026") and "DD/MM/YYYY" (e.g.
  // "28/02/2026"). Older "วันที่ N" (day-only, no month) rows can't be safely resolved and are
  // treated as unparseable.
  function parseSetupDate(dateRaw) {
    const s = (dateRaw || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{1,2})\s+([ก-๙.]+)\s+(\d{4})$/);
    if (m) {
      const monthIdx = THAI_MONTHS[m[2]];
      if (monthIdx !== undefined) return Util.toISODate(Number(m[3]), monthIdx + 1, Number(m[1]));
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return Util.toISODate(Number(m[3]), Number(m[2]), Number(m[1]));
    return null;
  }

  function gameBadgeColor(text) {
    const t = (text || "").toLowerCase();
    const match = DB.listGames().find((g) => t.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(t));
    return match ? match.color : "#94a3b8";
  }

  function formatThaiDate(iso) {
    if (!iso) return null;
    const d = Util.parseISODate(iso);
    return `${d.getDate()} ${Util.MONTH_NAMES_TH[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  // Compares the Set date against the Live date staff filled into the sheet's "วันไลฟ์" column
  // and renders a line showing both, plus a status so it's obvious at a glance whether the
  // "≥1 day before (or ≥1hr if same day)" rule was actually met.
  function renderSetupVsLiveLine(game, setupRec) {
    const color = gameBadgeColor(game);
    const setupISO = parseSetupDate(setupRec.dateRaw);
    const liveISO = parseSetupDate(setupRec.liveDateRaw);
    const setupLabel = setupISO ? formatThaiDate(setupISO) : Util.escapeHtml(setupRec.dateRaw || "?");

    let statusHtml;
    if (!setupRec.liveDateRaw) {
      statusHtml = `<span style="color:var(--text-dim);">ยังไม่ระบุวันไลฟ์</span>`;
    } else if (!liveISO || !setupISO) {
      statusHtml = `<span style="color:var(--text-dim);">Live ${Util.escapeHtml(setupRec.liveDateRaw)} (แปลงวันที่ไม่ได้)</span>`;
    } else {
      const dayDiff = Math.round((Util.parseISODate(liveISO) - Util.parseISODate(setupISO)) / 86400000);
      if (dayDiff >= 1) {
        statusHtml = `<span style="color:var(--success);">✅ Live ${formatThaiDate(liveISO)} (ก่อน ${dayDiff} วัน)</span>`;
      } else if (dayDiff === 0) {
        statusHtml = `<span style="color:var(--warning);">⚠️ Live ${formatThaiDate(liveISO)} (วันเดียวกัน — เช็คเวลาด้วยตัวเอง)</span>`;
      } else {
        statusHtml = `<span style="color:var(--danger);">⚠️ Live ${formatThaiDate(liveISO)} (Set หลังวันไลฟ์!)</span>`;
      }
    }
    return `<div style="margin-bottom:4px;"><span class="badge" style="background:${color};">${Util.escapeHtml(game)}</span> <span style="font-size:11px;">Set ${Util.escapeHtml(setupLabel)}${setupRec.time ? " " + Util.escapeHtml(setupRec.time) : ""} → ${statusHtml}</span></div>`;
  }

  function render(container, opts) {
    opts = opts || {};
    const records = DB.listSetupRecords();
    const today = Util.todayISO();
    const todayRecords = records.filter((r) => parseSetupDate(r.dateRaw) === today);

    const searchLower = state.search.trim().toLowerCase();
    const grouped = {};
    const lastSeenIndex = {};
    records.forEach((r, i) => {
      if (searchLower && !r.streamerName.toLowerCase().includes(searchLower)) return;
      if (!grouped[r.streamerName]) grouped[r.streamerName] = [];
      grouped[r.streamerName].push(r);
      lastSeenIndex[r.streamerName] = i; // sheet row order — later index = added more recently
    });
    // Newest-added streamers first, so recently-booked names are easy to spot at the top.
    const names = Object.keys(grouped).sort((a, b) => lastSeenIndex[b] - lastSeenIndex[a]);

    container.innerHTML = `
      <div class="card" style="border:2px solid ${todayRecords.some((r) => !r.done) ? "var(--danger)" : "var(--border)"};">
        <h2>📅 วันนี้ต้อง Set Up (${todayRecords.length})</h2>
        ${todayRecords.length ? `<div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px;">
          ${todayRecords.map((r) => `<span class="badge" style="background:${r.done ? "var(--success)" : "var(--danger)"};padding:6px 12px;font-size:13px;">
            ${r.done ? "✅" : "⏳"} ${Util.escapeHtml(r.streamerName)} — ${Util.escapeHtml(r.game)}${r.time ? " เวลา " + Util.escapeHtml(r.time) : ""}
          </span>`).join("")}
        </div>` : `<p style="color:var(--text-dim);font-size:13px;margin-top:4px;">วันนี้ไม่มีคิวนัด Set Up</p>`}
      </div>

      <div class="card">
        <div class="row between">
          <h2>คิวนัด Set Up (${records.length} รายการ, ${names.length}${searchLower ? "" : " คน"})</h2>
          <button class="secondary small" id="sync-setup-sheet">↻ ซิงค์จากชีท</button>
        </div>
        <div class="brief-box" style="margin-top:10px;">
          <strong>แนวทางนัด Set up:</strong>
          <ul style="margin:8px 0 0 18px;font-size:13px;line-height:1.7;">
            <li>นัดล่วงหน้าอย่างน้อย 1 วันก่อนวันไลฟ์จริง หรือถ้าหาวันไม่ได้ อย่างน้อย 1 ชม. ก่อนขึ้นไลฟ์</li>
            <li>เวลาแนะนำ: 13:00-13:30, 14:30-15:00, 15:00-15:30, 15:30-16:00, 17:00-17:30, 17:30-18:00, 21:30-22:00</li>
            <li>หลัง 22:00 (สี่ทุ่ม) ได้ถ้าจำเป็น</li>
          </ul>
        </div>
        <input type="text" id="setup-search" placeholder="ค้นหาชื่อ Streamer..." value="${Util.escapeHtml(state.search)}" style="width:100%;margin:12px 0;">
        <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Streamer</th><th>เกมที่ Set แล้ว</th><th>เกมที่รอ Set — วันเวลาที่ Set vs วันที่ Live</th></tr></thead>
          <tbody>
            ${names.length === 0 ? `<tr><td colspan="3"><div class="empty-state">ไม่พบข้อมูล — ลองกดซิงค์จากชีท</div></td></tr>` : ""}
            ${names.map((name) => {
              const recs = grouped[name];
              const doneRecByGame = {};
              recs.filter((r) => r.done).forEach((r) => { doneRecByGame[r.game] = r; }); // last one wins = most recent
              const doneGameNames = Object.keys(doneRecByGame);
              const pendingRecs = recs.filter((r) => !r.done);
              return `<tr>
                <td style="white-space:nowrap;">${Util.escapeHtml(name)}</td>
                <td style="font-size:12px;">
                  ${doneGameNames.length ? doneGameNames.map((g) => `<span class="badge" style="background:${gameBadgeColor(g)};margin-right:4px;margin-bottom:4px;display:inline-block;">${Util.escapeHtml(g)}</span>`).join("") : `<span style="color:var(--text-dim);">ไม่มี</span>`}
                </td>
                <td>${pendingRecs.length ? pendingRecs.map((r) => renderSetupVsLiveLine(r.game, r)).join("") : `<span style="color:var(--text-dim);font-size:12px;">—</span>`}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        </div>
      </div>
    `;

    container.querySelector("#setup-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      const cursorPos = e.target.selectionStart;
      render(container, { skipAutoSync: true });
      const newInput = container.querySelector("#setup-search");
      if (newInput) { newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
    });
    const syncBtn = container.querySelector("#sync-setup-sheet");
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "กำลังซิงค์...";
      try {
        const result = await DB.syncSetupFromSheet();
        render(container, { skipAutoSync: true });
        Util.showToast(`ซิงค์แล้ว — ${result.count} รายการ`);
      } catch (err) {
        syncBtn.disabled = false;
        syncBtn.textContent = "↻ ซิงค์จากชีท";
        Util.showToast("ซิงค์ไม่สำเร็จ: " + err.message);
      }
    });

    // Silently refresh from the sheet in the background so this stays a reliable "don't
    // forget" reminder for anyone who has the page open, without needing a manual click.
    if (!opts.skipAutoSync) {
      const before = JSON.stringify(DB.listSetupRecords());
      DB.syncSetupFromSheet().then(() => {
        const after = JSON.stringify(DB.listSetupRecords());
        if (after !== before) render(container, { skipAutoSync: true });
      }).catch(() => {
        // Some in-app browsers (e.g. the Google app's built-in browser) block background
        // fetches to other Google services like Sheets, even though Safari/Chrome don't — this
        // page is specifically a "don't forget" reminder, so silently going stale is the worst
        // failure mode; show a visible hint instead.
        const warn = document.createElement("div");
        warn.className = "card";
        warn.style.border = "2px solid var(--warning)";
        warn.innerHTML = `<p style="color:var(--warning);font-size:13px;margin:0;">⚠️ โหลดข้อมูลล่าสุดจากชีทไม่ได้ อาจเป็นเพราะเปิดผ่านเบราว์เซอร์ในแอป (เช่น แอป Google) — ลองเปิดผ่าน Safari หรือ Chrome โดยตรงแทน</p>`;
        container.prepend(warn);
      });
    }
  }

  return { render };
})();
