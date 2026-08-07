// "Who's live right now" board — a lightweight card grid (avatar + pulsing LIVE dot + game
// badge) instead of heavy embedded video players. Live/offline status per game comes from the
// schedule data we already have (is there an entry for this game whose time window covers now),
// so it needs no API key and no per-streamer channel setup. Clicking a live card opens that
// game's YouTube channel so you can actually watch.
const LiveStream = (() => {
  // Which games' live video is currently expanded below the card grid — a Set so multiple
  // games can be watched side by side. Persists across re-renders (module-level, not inside
  // render()) so toggling one card doesn't reset the others.
  const activeEmbeds = new Set();

  function nowMinutesBangkok() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour").value);
    const m = Number(parts.find((p) => p.type === "minute").value);
    return h * 60 + m;
  }

  function parseTimeRange(rangeStr) {
    const parts = (rangeStr || "").split("-").map((s) => s.trim());
    if (parts.length !== 2) return null;
    const toMin = (t) => {
      const m = t.match(/^(\d{1,2})\.(\d{2})$/);
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]);
    };
    const start = toMin(parts[0]);
    const end = toMin(parts[1]);
    if (start === null || end === null) return null;
    return { start, end };
  }

  // A range dated "today" that wraps past midnight (e.g. 23.30-01.30) hasn't started yet
  // during today's own early-morning hours — that early stretch belongs to YESTERDAY's
  // wrapping entry instead (still running from last night into this morning). So this needs
  // to know which day the entry is dated relative to today, not just compare against nowMin
  // in isolation — otherwise a not-yet-started tonight's entry gets mistaken for the tail end
  // of an entry that doesn't exist (or was actually a different streamer, last night's).
  function isRangeActive(range, nowMin, isYesterday) {
    const wraps = range.end < range.start;
    if (!wraps) return !isYesterday && nowMin >= range.start && nowMin < range.end;
    return isYesterday ? nowMin < range.end : nowMin >= range.start;
  }

  function addDaysISO(iso, delta) {
    const d = Util.parseISODate(iso);
    d.setDate(d.getDate() + delta);
    return Util.toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // For a game: finds the entry currently in its scheduled window (checking both today's
  // entries and yesterday's, since an overnight slot dated yesterday can still be running
  // into today's early morning), and the next upcoming one today (for the "not live yet" caption).
  function gameScheduleStatus(gameId) {
    const nowMin = nowMinutesBangkok();
    const today = Util.todayISO();
    const yesterdayEntries = DB.listScheduleByDate(addDaysISO(today, -1)).filter((e) => e.gameId === gameId);
    const todayEntries = DB.listScheduleByDate(today)
      .filter((e) => e.gameId === gameId)
      .sort((a, b) => a.time.localeCompare(b.time));

    let current = null;
    yesterdayEntries.forEach((e) => {
      const range = parseTimeRange(e.time);
      if (!range) return;
      if (!current && isRangeActive(range, nowMin, true)) current = e;
    });
    let next = null;
    todayEntries.forEach((e) => {
      const range = parseTimeRange(e.time);
      if (!range) return;
      if (!current && isRangeActive(range, nowMin, false)) current = e;
      if (!next && range.start > nowMin) next = e;
    });
    return { current, next };
  }

  function gameBadgeInitials(name) {
    return (name || "?").replace(/[^A-Za-z0-9ก-๙]/g, "").slice(0, 2).toUpperCase();
  }

  function renderCard(g) {
    const status = gameScheduleStatus(g.id);
    const isLive = !!status.current;
    const entry = status.current || status.next;
    const s = entry ? DB.getStreamer(entry.streamerId) : null;
    const isWatching = activeEmbeds.has(g.id);

    const avatarHtml = s ? Util.avatarHTML(s, "") : `<div class="avatar-circle">${Util.escapeHtml(gameBadgeInitials(g.name))}</div>`;
    const name = s ? s.name : g.fullName;
    const statusLine = isLive
      ? `<span class="live-card-status is-live"><span class="live-dot-inline"></span> LIVE</span>`
      : status.next
        ? `<span class="live-card-status is-offline">รอบถัดไป ${Util.escapeHtml(status.next.time)}</span>`
        : `<span class="live-card-status is-offline">ไม่มีคิววันนี้แล้ว</span>`;

    // Cards toggle an inline video below (data-toggle-embed) instead of linking out to
    // YouTube, so multiple games' streams can be watched side by side on this same page.
    return `<div class="live-card ${isLive ? "is-live" : "is-offline"} ${isWatching ? "is-watching" : ""}" data-toggle-embed="${g.id}" role="button" tabindex="0">
      <span class="live-card-game-name" style="background:${g.color};">${Util.escapeHtml(g.name)}</span>
      <div class="live-card-avatar-wrap">
        ${avatarHtml}
        ${isLive ? `<span class="live-pulse-dot"></span>` : ""}
        <span class="live-game-badge" style="background:${g.color};">${Util.escapeHtml(gameBadgeInitials(g.name))}</span>
      </div>
      <div class="live-card-name">${Util.escapeHtml(name)}</div>
      ${statusLine}
      <span class="live-card-watch-hint">${isWatching ? "▲ ปิดวิดีโอ" : "▼ ดูสด"}</span>
    </div>`;
  }

  function renderEmbed(g) {
    const src = `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(g.channelId)}&autoplay=1&mute=1`;
    return `<div class="live-embed-box">
      <div class="live-embed-header">
        <span class="live-card-game-name" style="background:${g.color};">${Util.escapeHtml(g.name)}</span>
        <button class="secondary small" data-close-embed="${g.id}">✕ ปิด</button>
      </div>
      <div class="live-embed-frame-wrap">
        <iframe src="${src}" title="${Util.escapeHtml(g.fullName)} live" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
      </div>
    </div>`;
  }

  // Order the Brief boxes exactly as requested: TalesRunner, WarZ, TOSM, Zone4, Cabal —
  // rather than whatever order DB.listGames() happens to return.
  const BRIEF_ORDER = ["tr", "warz", "tosm", "zone4", "cabal"];

  function formatBriefDate(iso) {
    if (!iso) return null;
    const d = Util.parseISODate(iso);
    return `${d.getDate()} ${Util.MONTH_NAMES_TH[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  function renderBriefBox(g) {
    const brief = g.brief || {};
    const hasText = brief.text && brief.text.trim();
    const startLabel = formatBriefDate(brief.startDate);
    const endLabel = formatBriefDate(brief.endDate);
    let dateLine = "";
    if (startLabel && endLabel) dateLine = `${startLabel} – ${endLabel}`;
    else if (startLabel) dateLine = `ตั้งแต่ ${startLabel}`;
    else if (endLabel) dateLine = `ถึง ${endLabel}`;
    return `<div class="brief-box" style="border-top-color:${g.color};">
      <div class="brief-game-name" style="color:${g.color};">${Util.escapeHtml(g.name)}</div>
      ${hasText ? `<div class="brief-text">${Util.linkify(Util.escapeHtml(brief.text))}</div>` : `<div class="brief-empty">ยังไม่มีบรีฟ</div>`}
      ${dateLine ? `<div class="brief-dates">📅 ${Util.escapeHtml(dateLine)}</div>` : ""}
    </div>`;
  }

  function render(container) {
    const allGames = DB.listGames();
    const withChannel = allGames.filter((g) => g.channelId);
    const missing = allGames.filter((g) => !g.channelId);

    const cards = withChannel
      .map((g) => ({ g, isLive: !!gameScheduleStatus(g.id).current }))
      .sort((a, b) => (b.isLive - a.isLive))
      .map(({ g }) => renderCard(g))
      .join("");

    const orderedForBrief = BRIEF_ORDER.map((id) => DB.getGame(id)).filter(Boolean);
    allGames.forEach((g) => { if (!orderedForBrief.includes(g)) orderedForBrief.push(g); });
    const briefBoxes = orderedForBrief.map((g) => renderBriefBox(g)).join("");

    const watchingGames = withChannel.filter((g) => activeEmbeds.has(g.id));
    const embedsSection = watchingGames.length
      ? `<div class="card">
          <h2>▶️ กำลังดู (${watchingGames.length})</h2>
          <div class="live-embed-grid">${watchingGames.map((g) => renderEmbed(g)).join("")}</div>
        </div>`
      : "";

    container.innerHTML = `
      <div class="card">
        <div class="row between">
          <h2>📡 ไลฟ์สดตอนนี้</h2>
          <button class="secondary small" id="live-refresh-all">🔄 รีเฟรช</button>
        </div>
        <p style="color:var(--text-dim);font-size:12px;">อิงจากตารางไลฟ์ — ใครมีคิวอยู่ ณ ตอนนี้จะขึ้นสถานะ LIVE ให้อัตโนมัติ กดที่การ์ดเพื่อดูสด (เลือกได้หลายเกมพร้อมกัน)</p>
      </div>
      <div class="card">
        <h2>📋 Brief</h2>
        <div class="brief-box-grid">${briefBoxes}</div>
      </div>
      ${withChannel.length ? `<div class="card"><div class="live-card-grid">${cards}</div></div>` : `<div class="card empty-state">ยังไม่ได้ตั้ง Channel ID ให้เกมไหนเลย — ไปตั้งได้ที่หลังบ้าน &gt; เกม</div>`}
      ${embedsSection}
      ${missing.length ? `<div class="card">
        <p style="color:var(--text-dim);font-size:12px;margin-bottom:10px;">ยังไม่ได้ตั้ง Channel ID: ${missing.map((g) => Util.escapeHtml(g.name)).join(", ")} — ไปตั้งได้ที่หลังบ้าน &gt; เกม หรือลองซิงค์ค่าเริ่มต้นก่อน</p>
        <button class="secondary small" id="live-sync-games">↻ ซิงค์ Channel ID เริ่มต้น</button>
      </div>` : ""}
    `;

    container.querySelector("#live-refresh-all").addEventListener("click", () => {
      render(container);
      Util.showToast("รีเฟรชแล้ว");
    });
    container.querySelectorAll("[data-toggle-embed]").forEach((card) => {
      const toggle = () => {
        const gameId = card.getAttribute("data-toggle-embed");
        if (activeEmbeds.has(gameId)) activeEmbeds.delete(gameId);
        else activeEmbeds.add(gameId);
        render(container);
      };
      card.addEventListener("click", toggle);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
    container.querySelectorAll("[data-close-embed]").forEach((btn) => btn.addEventListener("click", () => {
      activeEmbeds.delete(btn.getAttribute("data-close-embed"));
      render(container);
    }));
    const syncBtn = container.querySelector("#live-sync-games");
    if (syncBtn) syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "กำลังซิงค์...";
      try {
        await DB.syncGamesFromSeed();
        render(container);
        Util.showToast("ซิงค์ Channel ID แล้ว");
      } catch (err) {
        syncBtn.disabled = false;
        syncBtn.textContent = "↻ ซิงค์ Channel ID เริ่มต้น";
        Util.showToast("ซิงค์ไม่สำเร็จ: " + err.message);
      }
    });
  }

  return { render };
})();
