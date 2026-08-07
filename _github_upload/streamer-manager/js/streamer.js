const StreamerView = (() => {
  function render(container, streamerId) {
    const s = DB.getStreamer(streamerId);
    if (!s) {
      container.innerHTML = `<div class="card empty-state">ไม่พบ Streamer นี้</div>`;
      return;
    }
    const availRaw = s.availability || {};
    const availability = { timeSlots: availRaw.timeSlots || [], days: availRaw.days || [] };
    const prices = s.prices || [];
    const priceRows = prices.map((p) => {
      const g = DB.getGame(p.gameId);
      const hasDiscount = p.discountPrice !== null && p.discountPrice !== undefined && p.discountPrice !== "";
      return `<tr>
        <td><span class="badge" style="background:${g ? g.color : "#666"}">${g ? Util.escapeHtml(g.name) : "?"}</span></td>
        <td>฿${Util.fmtMoney(p.normalPrice)}</td>
        <td>${hasDiscount ? "฿" + Util.fmtMoney(p.discountPrice) : "—"}</td>
        <td><strong>฿${Util.fmtMoney(hasDiscount ? p.discountPrice : p.normalPrice)}</strong></td>
      </tr>`;
    }).join("");

    const now = new Date();
    const monthEntries = DB.listScheduleByMonth(now.getFullYear(), now.getMonth() + 1).filter((e) => e.streamerId === s.id);
    const upcoming = DB.listSchedule()
      .filter((e) => e.streamerId === s.id && e.date >= Util.todayISO())
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .slice(0, 8);

    container.innerHTML = `
      <div class="card">
        <div class="row"><button class="secondary small" id="back-btn">‹ กลับ</button></div>
        <div class="streamer-detail-header" style="margin-top:12px;">
          ${Util.avatarHTML(s, "large")}
          <div>
            <h2 style="margin:0;">${Util.escapeHtml(s.name)}</h2>
            <div style="color:var(--text-dim);font-size:12px;">รับงาน ${prices.length} เกม · เดือนนี้ ${monthEntries.length} คิว</div>
          </div>
          <div class="spacer"></div>
          <button class="secondary" id="edit-in-admin">แก้ไขในหลังบ้าน</button>
        </div>

        <h3>เกม &amp; ราคา</h3>
        ${prices.length ? `<table>
          <thead><tr><th>เกม</th><th>ราคาปกติ</th><th>ราคาพิเศษ</th><th>ราคาที่ใช้จริง</th></tr></thead>
          <tbody>${priceRows}</tbody>
        </table>` : `<div class="empty-state">ยังไม่มีข้อมูลเกม/ราคา — เพิ่มได้ในหลังบ้าน</div>`}
      </div>

      <div class="card">
        <h3>ช่วงเวลาที่สะดวก</h3>
        ${(availability.timeSlots.length || availability.days.length) ? `
          <div class="row" style="gap:6px;margin-bottom:8px;">
            ${availability.timeSlots.length ? Util.TIME_SLOTS.map((t) => {
              const isAvail = availability.timeSlots.includes(t.key);
              return `<span class="badge" style="background:${isAvail ? "var(--success)" : "rgba(192,57,43,0.12)"};color:${isAvail ? "white" : "var(--danger)"};border:1px solid ${isAvail ? "var(--success)" : "var(--danger)"};">${Util.escapeHtml(t.label)}</span>`;
            }).join("") : `<span style="color:var(--text-dim);font-size:12px;">ยังไม่ระบุช่วงเวลา</span>`}
          </div>
          <div class="row" style="gap:6px;">
            ${availability.days.length ? Util.AVAIL_DAYS.map((d) => {
              const isAvail = availability.days.includes(d.key);
              return `<span class="badge" style="background:${isAvail ? "var(--success)" : "rgba(192,57,43,0.12)"};color:${isAvail ? "white" : "var(--danger)"};border:1px solid ${isAvail ? "var(--success)" : "var(--danger)"};">${Util.escapeHtml(d.label)}</span>`;
            }).join("") : `<span style="color:var(--text-dim);font-size:12px;">ยังไม่ระบุวัน</span>`}
          </div>
        ` : `<div class="empty-state">ยังไม่มีข้อมูลช่วงเวลาที่สะดวก — เพิ่มได้ในหลังบ้าน</div>`}
      </div>

      <div class="card">
        <h3>คิวไลฟ์ที่จะถึง</h3>
        ${upcoming.length ? upcoming.map((e) => {
          const g = DB.getGame(e.gameId);
          const status = DB.getDayStatus(e.date);
          return `<div class="session-row">
            <span class="badge" style="background:${g ? g.color : "#666"}">${g ? Util.escapeHtml(g.name) : "?"}</span>
            <span class="time">${e.date}</span>
            <span>${Util.escapeHtml(e.time)}</span>
            ${status === "no_live" ? `<span class="status-tag no_live">ไม่ไลฟ์</span>` : e.isTournament ? `<span class="status-tag tournament">🏆 ทัวร์นาเมนต์</span>` : ""}
          </div>`;
        }).join("") : `<div class="empty-state">ไม่มีคิวที่จะถึง</div>`}
      </div>
    `;

    container.querySelector("#back-btn").addEventListener("click", () => history.back());
    container.querySelector("#edit-in-admin").addEventListener("click", () => {
      location.hash = `#admin/streamers/${s.id}`;
    });
  }

  return { render };
})();
