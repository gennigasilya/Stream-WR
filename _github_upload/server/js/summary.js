const Summary = (() => {
  let state = { year: null, month: null };
  const MANAGEMENT_FEE_RATE = 0.15;
  const VAT_RATE = 0.07;

  // Client invoice: normal (non-discounted) rate as the base, plus management fee margin, plus VAT on top.
  function computeInvoice(normalTotal) {
    const managementFee = normalTotal * MANAGEMENT_FEE_RATE;
    const beforeVat = normalTotal + managementFee;
    const vat = beforeVat * VAT_RATE;
    const grandTotal = beforeVat + vat;
    return { normalTotal, managementFee, beforeVat, vat, grandTotal };
  }

  function init() {
    if (!state.year) {
      const now = new Date();
      state.year = now.getFullYear();
      state.month = now.getMonth() + 1;
    }
  }

  // Standard billing window: the 1st through the last day of the calendar month.
  function standardRange(year, month) {
    const lastDay = new Date(year, month, 0).getDate();
    return { start: Util.toISODate(year, month, 1), end: Util.toISODate(year, month, lastDay) };
  }

  // WarZ billing window: the 26th of the previous month through the 25th of this month
  // (e.g. the "August" WarZ round runs 26 Jul – 25 Aug), instead of the calendar month.
  function warzRange(year, month) {
    let py = year, pm = month - 1;
    if (pm < 1) { pm = 12; py -= 1; }
    return { start: Util.toISODate(py, pm, 26), end: Util.toISODate(year, month, 25) };
  }

  function rangeForGame(gameId, year, month) {
    return gameId === "warz" ? warzRange(year, month) : standardRange(year, month);
  }

  // Excludes "no_live" days entirely. "tournament" days count as a job but cost 0 (streamer works free).
  // WarZ uses its own 25th-to-25th billing window (see warzRange); every other game uses the
  // calendar month. Entries are gathered from the union of both windows, then each entry is
  // checked against the window that applies to its own game.
  function computeMonthSummary(year, month) {
    const std = standardRange(year, month);
    const warz = warzRange(year, month);
    const windowStart = warz.start < std.start ? warz.start : std.start;
    const windowEnd = warz.end > std.end ? warz.end : std.end;
    const entries = DB.listSchedule().filter((e) => e.date >= windowStart && e.date <= windowEnd);
    const byGame = {};
    let normalTotal = 0, actualTotal = 0, jobCount = 0;

    entries.forEach((e) => {
      const range = rangeForGame(e.gameId, year, month);
      if (e.date < range.start || e.date > range.end) return;
      const cost = DB.getEntryCost(e);
      if (cost.excluded) return;

      const g = DB.getGame(e.gameId);
      const s = DB.getStreamer(e.streamerId);
      if (!g || !s) return;

      const normal = cost.normal;
      const actual = cost.actual;

      if (!byGame[g.id]) byGame[g.id] = { game: g, range, jobCount: 0, normalTotal: 0, actualTotal: 0, streamers: {} };
      const gb = byGame[g.id];
      gb.jobCount++;
      gb.normalTotal += normal;
      gb.actualTotal += actual;

      if (!gb.streamers[s.id]) gb.streamers[s.id] = { streamer: s, jobCount: 0, normalTotal: 0, actualTotal: 0 };
      const sb = gb.streamers[s.id];
      sb.jobCount++;
      sb.normalTotal += normal;
      sb.actualTotal += actual;

      normalTotal += normal;
      actualTotal += actual;
      jobCount++;
    });

    return { byGame, normalTotal, actualTotal, jobCount, savings: normalTotal - actualTotal };
  }

  function formatRangeLabel(range) {
    const s = Util.parseISODate(range.start);
    const e = Util.parseISODate(range.end);
    return `${s.getDate()} ${Util.MONTH_NAMES_TH[s.getMonth()]} – ${e.getDate()} ${Util.MONTH_NAMES_TH[e.getMonth()]} ${e.getFullYear() + 543}`;
  }

  function render(container) {
    init();
    const summary = computeMonthSummary(state.year, state.month);
    const invoice = computeInvoice(summary.normalTotal);
    const monthTitle = `${Util.MONTH_NAMES_TH[state.month - 1]} ${state.year + 543}`;

    const gameSections = Object.values(summary.byGame)
      .sort((a, b) => b.actualTotal - a.actualTotal)
      .map((gb) => {
        const streamerRows = Object.values(gb.streamers)
          .sort((a, b) => b.actualTotal - a.actualTotal)
          .map((sb) => `<tr>
            <td>${Util.escapeHtml(sb.streamer.name)}</td>
            <td>${sb.jobCount}</td>
            <td>฿${Util.fmtMoney(sb.normalTotal)}</td>
            <td>฿${Util.fmtMoney(sb.actualTotal)}</td>
          </tr>`).join("");
        const gbInvoice = computeInvoice(gb.normalTotal);
        return `<details class="game-summary">
          <summary>
            <span class="color-dot" style="background:${gb.game.color}"></span>
            ${Util.escapeHtml(gb.game.name)}
            <span style="font-size:11px;color:var(--text-dim);font-weight:400;">(รอบบิล ${formatRangeLabel(gb.range)})</span>
            <span class="gs-totals">
              <span>จำนวน Content: ${gb.jobCount}</span>
              <span>ยอดเรียกเก็บลูกค้า: ฿${Util.fmtMoney(gbInvoice.grandTotal)}</span>
              <span>ราคาจ่ายสตรีมเมอร์: ฿${Util.fmtMoney(gb.actualTotal)}</span>
            </span>
          </summary>
          <table style="margin-top:10px;">
            <tbody>
              <tr><td>ยอดราคาปกติ (Streamer)</td><td style="text-align:right;">฿${Util.fmtMoney(gbInvoice.normalTotal)}</td></tr>
              <tr><td>Management Fee (${(MANAGEMENT_FEE_RATE * 100).toFixed(0)}%)</td><td style="text-align:right;">฿${Util.fmtMoney(gbInvoice.managementFee)}</td></tr>
              <tr><td>รวมก่อน VAT</td><td style="text-align:right;">฿${Util.fmtMoney(gbInvoice.beforeVat)}</td></tr>
              <tr><td>VAT (${(VAT_RATE * 100).toFixed(0)}%)</td><td style="text-align:right;">฿${Util.fmtMoney(gbInvoice.vat)}</td></tr>
              <tr><td><strong>ยอดเรียกเก็บลูกค้า (เกมนี้)</strong></td><td style="text-align:right;"><strong>฿${Util.fmtMoney(gbInvoice.grandTotal)}</strong></td></tr>
            </tbody>
          </table>
          <table style="margin-top:14px;">
            <thead><tr><th>Streamer</th><th>จำนวน Content</th><th>ราคาปกติรวม</th><th>ราคาจ่ายจริงรวม</th></tr></thead>
            <tbody>${streamerRows}</tbody>
          </table>
        </details>`;
      }).join("");

    container.innerHTML = `
      <div class="card">
        <div class="row between">
          <div class="month-select">
            <button class="secondary small" id="sm-prev">‹</button>
            <div class="cal-title">${monthTitle}</div>
            <button class="secondary small" id="sm-next">›</button>
          </div>
          <button class="secondary small" id="sm-reload-prices" title="ดึงตารางไลฟ์และราคา/ส่วนลด/ช่วงเวลาที่สะดวกล่าสุดจาก Google Sheet ทั้งหมด">↻ โหลดข้อมูลล่าสุด</button>
        </div>
      </div>

      <div class="card">
        <h2>สรุปรวมทั้งเดือน</h2>
        <div class="stat-grid">
          <div class="stat-tile"><div class="label">ยอดรวมราคาปกติ</div><div class="value">฿${Util.fmtMoney(summary.normalTotal)}</div></div>
          <div class="stat-tile"><div class="label">ยอดรวมที่จ่ายจริง</div><div class="value">฿${Util.fmtMoney(summary.actualTotal)}</div></div>
          <div class="stat-tile savings"><div class="label">ประหยัดได้</div><div class="value">฿${Util.fmtMoney(summary.savings)}</div></div>
          <div class="stat-tile"><div class="label">จำนวนงานทั้งหมด</div><div class="value">${summary.jobCount}</div></div>
        </div>
      </div>

      <div class="card">
        <h2>ยอดเรียกเก็บลูกค้า</h2>
        <table>
          <tbody>
            <tr><td>ยอดราคาปกติ (Streamer)</td><td style="text-align:right;">฿${Util.fmtMoney(invoice.normalTotal)}</td></tr>
            <tr><td>Management Fee (${(MANAGEMENT_FEE_RATE * 100).toFixed(0)}%)</td><td style="text-align:right;">฿${Util.fmtMoney(invoice.managementFee)}</td></tr>
            <tr><td><strong>รวมก่อน VAT</strong></td><td style="text-align:right;"><strong>฿${Util.fmtMoney(invoice.beforeVat)}</strong></td></tr>
            <tr><td>VAT (${(VAT_RATE * 100).toFixed(0)}%)</td><td style="text-align:right;">฿${Util.fmtMoney(invoice.vat)}</td></tr>
            <tr><td style="font-size:15px;"><strong>ยอดเรียกเก็บลูกค้าทั้งหมด</strong></td><td style="text-align:right;font-size:15px;color:var(--success);"><strong>฿${Util.fmtMoney(invoice.grandTotal)}</strong></td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>สรุปแยกตามเกม</h2>
        ${gameSections || `<div class="empty-state">ไม่มีข้อมูลคิวไลฟ์ในเดือนนี้</div>`}
      </div>
    `;

    container.querySelector("#sm-prev").addEventListener("click", () => shift(-1, container));
    container.querySelector("#sm-next").addEventListener("click", () => shift(1, container));
    const reloadBtn = container.querySelector("#sm-reload-prices");
    reloadBtn.addEventListener("click", async () => {
      reloadBtn.disabled = true;
      reloadBtn.textContent = "กำลังโหลด...";
      const scheduleResult = await DB.syncScheduleFromSheet().catch((err) => ({ error: err }));
      render(container);
      if (scheduleResult.error) {
        Util.showToast("โหลดข้อมูลไม่สำเร็จ: " + scheduleResult.error.message);
        return;
      }
      const failedNote = scheduleResult.failedTabs && scheduleResult.failedTabs.length ? ` (ดึงไม่ได้: ${scheduleResult.failedTabs.join(", ")})` : "";
      Util.showToast(`โหลดข้อมูลล่าสุดแล้ว — ตาราง ${scheduleResult.newCount} คิว${failedNote}`);
    });
  }

  function shift(dir, container) {
    state.month += dir;
    if (state.month > 12) { state.month = 1; state.year++; }
    if (state.month < 1) { state.month = 12; state.year--; }
    render(container);
  }

  return { render, computeMonthSummary };
})();
