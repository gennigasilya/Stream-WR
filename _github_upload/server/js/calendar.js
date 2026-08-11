const Calendar = (() => {
  let state = { year: null, month: null, view: "month", weekAnchor: null, gameFilter: null };

  function init() {
    const today = new Date();
    if (!state.year) {
      state.year = today.getFullYear();
      state.month = today.getMonth() + 1;
      state.weekAnchor = Util.todayISO();
    }
  }

  function dayEntriesSorted(dateISO) {
    let entries = DB.listScheduleByDate(dateISO);
    if (state.gameFilter) entries = entries.filter((e) => e.gameId === state.gameFilter);
    return entries.sort((a, b) => a.time.localeCompare(b.time));
  }

  function gameBadges(dateISO) {
    const entries = dayEntriesSorted(dateISO);
    const byGame = {};
    entries.forEach((e) => {
      byGame[e.gameId] = (byGame[e.gameId] || 0) + 1;
    });
    return Object.keys(byGame).map((gid) => {
      const g = DB.getGame(gid);
      if (!g) return "";
      return `<span class="game-badge" style="background:${g.color}">${Util.escapeHtml(g.name)} ${byGame[gid]}</span>`;
    }).join("");
  }

  // When a single game is selected, list streamer names directly instead of a count badge.
  function streamerNameList(dateISO) {
    const entries = dayEntriesSorted(dateISO);
    if (!entries.length) return `<div class="cal-name-empty">—</div>`;
    return entries.map((e) => {
      const s = DB.getStreamer(e.streamerId);
      const startTime = (e.time || "").split("-")[0].trim().replace(".", ":");
      return `<div class="cal-name-item ${e.isTournament ? "tournament" : ""}">${e.isTournament ? "🏆 " : ""}<span class="cal-name-time">${Util.escapeHtml(startTime)}</span> ${Util.escapeHtml(s ? s.name : "?")}</div>`;
    }).join("");
  }

  function renderLegend() {
    return `<div class="legend">
      <span><span class="status-swatch" style="background:rgba(239,68,68,0.35);border:1px solid var(--danger)"></span>ไม่ไลฟ์</span>
      <span><span class="status-swatch" style="background:rgba(184,134,11,0.35);border:1px solid var(--warning)"></span>🏆 มีทัวร์นาเมนต์ (ฟรี)</span>
    </div>`;
  }

  function renderGameFilter() {
    const games = DB.listGames();
    const allActive = !state.gameFilter;
    const chips = [`<button class="game-filter-chip ${allActive ? "active" : ""}" data-game-filter="">ทั้งหมด</button>`]
      .concat(games.map((g) => {
        const active = state.gameFilter === g.id;
        const style = active ? `background:${g.color};border-color:${g.color};color:#fff;` : `border-color:${g.color};color:${g.color};`;
        return `<button class="game-filter-chip" data-game-filter="${g.id}" style="${style}">${Util.escapeHtml(g.name)}</button>`;
      }));
    return `<div class="game-filter-row">${chips.join("")}</div>`;
  }

  function renderMonthGrid(year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayISO = Util.todayISO();

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateISO = Util.toISODate(year, month, d);
      const status = DB.getDayStatus(dateISO);
      const isToday = dateISO === todayISO ? "today" : "";
      const hasTournament = dayEntriesSorted(dateISO).some((e) => e.isTournament);
      cells += `<div class="cal-cell status-${status} ${isToday}" data-date="${dateISO}">
        <div class="date-num">${d}${status === "no_live" ? `<span class="status-tag no_live"> · ไม่ไลฟ์</span>` : hasTournament ? `<span class="status-tag tournament"> · 🏆</span>` : ""}</div>
        ${state.gameFilter
          ? `<div class="cal-names">${streamerNameList(dateISO)}</div>`
          : `<div class="badges">${gameBadges(dateISO)}</div>`}
      </div>`;
    }
    const dow = Util.DOW_TH.map((d) => `<div class="cal-dow">${d}</div>`).join("");
    return `<div class="cal-grid">${dow}${cells}</div>`;
  }

  function renderWeekGrid(anchorISO) {
    const anchor = Util.parseISODate(anchorISO);
    const startOfWeek = new Date(anchor);
    startOfWeek.setDate(anchor.getDate() - anchor.getDay());
    const todayISO = Util.todayISO();

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      weekDates.push(d);
    }
    // Always plain chronological (Sun→Sat) order — a "today-first" rotation was tried but made
    // the day numbers look out of sequence (e.g. "8, 2, 3, 4, 5..."), which read as broken
    // rather than helpful. On mobile, today is highlighted and scrolled into view instead (see
    // the .week-col.today CSS / :has() rule), so quick access doesn't need reordering the dates.
    let cols = "";
    weekDates.forEach((d) => {
      const dateISO = Util.toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const status = DB.getDayStatus(dateISO);
      const entries = dayEntriesSorted(dateISO);
      const isToday = dateISO === todayISO ? "today" : "";

      const events = entries.length
        ? entries.map((e) => {
            const g = DB.getGame(e.gameId);
            const s = DB.getStreamer(e.streamerId);
            return `<div class="week-event" style="border-left-color:${g ? g.color : "#999"}">
              <div class="we-time">${Util.escapeHtml(e.time)}</div>
              <div class="we-game" style="color:${g ? g.color : "var(--text)"}">${g ? Util.escapeHtml(g.fullName) : "?"}</div>
              <div class="we-streamer">${Util.escapeHtml(s ? s.name : "ไม่ระบุ")}</div>
              ${e.isTournament ? `<div class="we-tournament-tag">🏆 ทัวร์นาเมนต์ฟรี</div>` : ""}
            </div>`;
          }).join("")
        : `<div class="empty-state" style="padding:14px 4px;">— ไม่มีคิว —</div>`;

      cols += `<div class="week-col status-${status} ${isToday}" data-date="${dateISO}">
        <div class="week-col-header">
          <span>${Util.DOW_TH[d.getDay()]} ${d.getDate()}</span>
          ${status === "no_live" ? `<span class="status-tag no_live">ไม่ไลฟ์</span>` : ""}
        </div>
        ${events}
      </div>`;
    });
    return `<div class="week-grid">${cols}</div>`;
  }

  function render(container) {
    init();
    const monthTitle = `${Util.MONTH_NAMES_TH[state.month - 1]} ${state.year + 543}`;
    container.innerHTML = `
      <div class="card">
        <div class="cal-header">
          <div class="row">
            <button class="secondary small" id="cal-prev">‹</button>
            <div class="cal-title">${state.view === "month" ? monthTitle : "รายสัปดาห์"}</div>
            <button class="secondary small" id="cal-next">›</button>
            <button class="secondary small" id="cal-today">วันนี้</button>
          </div>
          <div class="row" style="gap:8px;">
            <div class="view-toggle">
              <button data-view="month" class="${state.view === "month" ? "active" : ""}">รายเดือน</button>
              <button data-view="week" class="${state.view === "week" ? "active" : ""}">รายสัปดาห์</button>
            </div>
            <button class="secondary small" id="reload-schedule" title="ดึงตารางไลฟ์สดจาก Google Sheet ตอนนี้เลย (ต้องมีอินเทอร์เน็ต) — ราคา/รูป/ช่วงเวลาที่สะดวกของ Streamer จะไม่หาย">↻ โหลดตารางไลฟ์ล่าสุด</button>
          </div>
        </div>
        ${renderGameFilter()}
        ${renderLegend()}
        ${state.view === "month" ? renderMonthGrid(state.year, state.month) : renderWeekGrid(state.weekAnchor)}
      </div>
    `;

    container.querySelectorAll("[data-date]").forEach((el) => {
      el.addEventListener("click", () => openDayModal(el.getAttribute("data-date")));
    });
    container.querySelector("#cal-prev").addEventListener("click", () => shift(-1));
    container.querySelector("#cal-next").addEventListener("click", () => shift(1));
    container.querySelector("#cal-today").addEventListener("click", () => {
      const t = new Date();
      state.year = t.getFullYear();
      state.month = t.getMonth() + 1;
      state.weekAnchor = Util.todayISO();
      render(container);
    });
    container.querySelectorAll(".view-toggle button").forEach((b) => {
      b.addEventListener("click", () => {
        state.view = b.getAttribute("data-view");
        render(container);
      });
    });
    container.querySelectorAll(".game-filter-chip").forEach((b) => {
      b.addEventListener("click", () => {
        state.gameFilter = b.getAttribute("data-game-filter") || null;
        render(container);
      });
    });
    container.querySelector("#reload-schedule").addEventListener("click", async () => {
      if (!confirm("ดึงตารางไลฟ์ล่าสุดจาก Google Sheet สดๆ มาอัปเดต?\n\nจะอัปเดตวัน/เวลา/เกม/ผู้ไลฟ์ให้ตรงกับชีทล่าสุด ส่วนราคา รูปภาพ และช่วงเวลาที่สะดวกของ Streamer ที่ตั้งค่าไว้ในหลังบ้านจะไม่หาย")) return;
      Util.showToast("กำลังดึงข้อมูลจาก Google Sheet…");
      try {
        const result = await DB.syncScheduleFromSheet();
        render(container);
        const failedNote = result.failedTabs && result.failedTabs.length ? ` — ดึงไม่ได้: ${result.failedTabs.join(", ")}` : "";
        Util.showToast(`อัปเดตจากชีทสดแล้ว (${result.newCount} คิว${result.addedStreamers ? `, เพิ่ม Streamer ใหม่ ${result.addedStreamers} คน` : ""})${failedNote}`);
      } catch (liveErr) {
        try {
          const result = await DB.syncScheduleFromSeed();
          render(container);
          Util.showToast(`ดึงชีทสดไม่ได้ (${liveErr.message}) — ใช้ข้อมูลสำรองในไฟล์แทน (${result.newCount} คิว)`);
        } catch (fallbackErr) {
          Util.showToast("โหลดข้อมูลไม่สำเร็จ: " + fallbackErr.message);
        }
      }
    });
  }

  function shift(dir) {
    if (state.view === "month") {
      state.month += dir;
      if (state.month > 12) { state.month = 1; state.year++; }
      if (state.month < 1) { state.month = 12; state.year--; }
    } else {
      const d = Util.parseISODate(state.weekAnchor);
      d.setDate(d.getDate() + dir * 7);
      state.weekAnchor = Util.toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    render(document.getElementById("app"));
  }

  function refreshBackground() {
    const app = document.getElementById("app");
    if (app) render(app);
  }

  // Compact "available days & times" line shown under each session row, so admin can see it
  // at a glance without opening the Streamer detail page. (Price used to show here too, but
  // Dashboard is a public-facing schedule view, so it was dropped — see Admin/Summary instead.)
  function sessionSubInfo(s) {
    if (!s) return "";
    const avail = s.availability || {};
    const availTimeSlots = avail.timeSlots || [];
    const availDays = avail.days || [];
    const slotLabels = Util.TIME_SLOTS.filter((t) => availTimeSlots.includes(t.key)).map((t) => t.label);
    const dayLabels = Util.AVAIL_DAYS.filter((d) => availDays.includes(d.key)).map((d) => d.label);
    const availText = slotLabels.length || dayLabels.length
      ? `สะดวก: ${[...slotLabels, ...dayLabels].join(" ")}`
      : "ยังไม่ระบุเวลาสะดวก";

    return `<div class="session-row-sub"><span>${Util.escapeHtml(availText)}</span></div>`;
  }

  function openDayModal(dateISO) {
    const d = Util.parseISODate(dateISO);
    const label = `${d.getDate()} ${Util.MONTH_NAMES_TH[d.getMonth()]} ${d.getFullYear() + 543}`;
    const status = DB.getDayStatus(dateISO);
    const entries = dayEntriesSorted(dateISO);

    let rows = entries.map((e) => {
      const g = DB.getGame(e.gameId);
      const s = DB.getStreamer(e.streamerId);
      return `<div class="session-row ${e.isTournament ? "is-tournament" : ""}">
        <div class="session-row-main">
          <span class="badge" style="background:${g ? g.color : "#666"}">${g ? Util.escapeHtml(g.name) : "?"}</span>
          <span class="time">${Util.escapeHtml(e.time)}</span>
          ${Util.avatarHTML(s, "tiny")}
          <a class="streamer-link" data-streamer="${s ? s.id : ""}">${Util.escapeHtml(s ? s.name : "ไม่ระบุ")}</a>
          <button class="tour-icon-toggle ${e.isTournament ? "active" : ""}" data-toggle-tournament="${e.id}" title="${e.isTournament ? "ยกเลิกทัวร์นาเมนต์ (คิดเงินตามปกติ)" : "ทำเครื่องหมายว่าคนนี้มาทัวร์นาเมนต์ฟรี"}">🏆</button>
        </div>
        ${sessionSubInfo(s)}
      </div>`;
    }).join("");
    if (!entries.length) rows = `<div class="empty-state">ไม่มีคิวไลฟ์ในวันนี้</div>`;

    const statusBanner = status === "no_live"
      ? `<div class="row" style="color:var(--danger);font-weight:700;margin-bottom:10px;">🔴 วันนี้ไม่มีการไลฟ์ — ไม่นำมารวมยอด</div>`
      : "";

    Util.openModal(`
      <div class="row between"><h2>${label}</h2><button class="modal-close" id="modal-close-btn">✕</button></div>
      ${statusBanner}
      <div class="row" style="margin-bottom:12px;">
        <button class="${status === "no_live" ? "secondary" : "danger"} small" id="toggle-no-live">
          ${status === "no_live" ? "↩ ยกเลิกสถานะไม่ไลฟ์" : "🔴 ทำเครื่องหมายว่าวันนี้ไม่ไลฟ์"}
        </button>
      </div>
      ${rows}
    `);
    document.getElementById("modal-close-btn").addEventListener("click", Util.closeModal);
    document.querySelectorAll("[data-streamer]").forEach((el) => {
      const id = el.getAttribute("data-streamer");
      if (!id) return;
      el.addEventListener("click", () => {
        Util.closeModal();
        location.hash = `#streamer/${id}`;
      });
    });
    document.getElementById("toggle-no-live").addEventListener("click", () => {
      DB.setDayStatus(dateISO, status === "no_live" ? "normal" : "no_live");
      refreshBackground();
      openDayModal(dateISO);
    });
    document.querySelectorAll("[data-toggle-tournament]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entryId = btn.getAttribute("data-toggle-tournament");
        const entry = DB.listSchedule().find((e) => e.id === entryId);
        DB.setEntryTournament(entryId, !entry.isTournament);
        refreshBackground();
        openDayModal(dateISO);
      });
    });
  }

  return { render };
})();
