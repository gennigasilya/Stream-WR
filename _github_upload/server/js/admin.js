const Admin = (() => {
  let state = { tab: "streamers", editingStreamerId: null, streamerSearch: "", streamerGameFilter: "", streamerTimeFilter: "", streamerEmergencyFilter: false };

  // Background events (the Firebase real-time listeners in app.js) call the router on ANY
  // cross-device data change, which re-invokes this render function even while the user is
  // sitting on the Admin page doing something else entirely. If every call tore down and
  // rebuilt the tab buttons from scratch, a click already in flight could fire on a button
  // that's just been detached and replaced — leaving the tab highlight and the actual body
  // content pointing at two different tabs (exactly the "Streamers highlighted but เกม content
  // showing" bug this was built to fix). So the tab shell (buttons + their listeners) is only
  // ever built once per visit to #admin; every later call just refreshes #admin-body and syncs
  // the active-tab highlight onto the SAME button elements, never replacing them.
  function render(container, subroute) {
    if (subroute && subroute[0] === "streamers" && subroute[1]) {
      state.tab = "streamers";
      state.editingStreamerId = subroute[1];
    }
    let tabsEl = container.querySelector(".admin-tabs");
    if (!tabsEl) {
      container.innerHTML = `
        <div class="admin-tabs">
          <button data-tab="streamers" class="${state.tab === "streamers" ? "active" : ""}">Streamers</button>
          <button data-tab="games" class="${state.tab === "games" ? "active" : ""}">เกม</button>
        </div>
        <div id="admin-body"></div>
      `;
      container.querySelectorAll(".admin-tabs button").forEach((b) => {
        b.addEventListener("click", () => {
          state.tab = b.getAttribute("data-tab");
          if (state.tab !== "streamers") state.editingStreamerId = null;
          container.querySelectorAll(".admin-tabs button").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-tab") === state.tab);
          });
          renderBody(container);
        });
      });
    } else {
      tabsEl.querySelectorAll("button").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-tab") === state.tab);
      });
    }
    renderBody(container);
  }

  function renderBody(container) {
    const body = container.querySelector("#admin-body");
    if (state.tab === "streamers") renderStreamers(body);
    else if (state.tab === "games") renderGames(body);
  }

  // ---------------- Streamers ----------------
  function renderStreamers(body) {
    const allStreamers = DB.listStreamers().slice().sort((a, b) => a.name.localeCompare(b.name));
    const games = DB.listGames();
    const searchLower = state.streamerSearch.trim().toLowerCase();
    const streamers = allStreamers.filter((s) => {
      if (searchLower && !s.name.toLowerCase().includes(searchLower)) return false;
      if (state.streamerGameFilter && !(s.prices || []).some((p) => p.gameId === state.streamerGameFilter)) return false;
      if (state.streamerTimeFilter) {
        const avail = s.availability || {};
        if (!(avail.timeSlots || []).includes(state.streamerTimeFilter)) return false;
      }
      if (state.streamerEmergencyFilter && !s.emergencyAvailable) return false;
      return true;
    });
    const filtersActive = searchLower || state.streamerGameFilter || state.streamerTimeFilter || state.streamerEmergencyFilter;
    body.innerHTML = `
      <div class="card">
        <div class="row between">
          <h2>Streamers (${streamers.length}${filtersActive ? ` / ${allStreamers.length}` : ""})</h2>
          <div class="row" style="gap:8px;">
            <button class="secondary small" id="sync-photos-seed" title="เติมรูปเริ่มต้นให้ Streamer ที่ยังไม่มีรูป (ไม่ทับรูปที่ตั้งไว้แล้ว)">↻ ซิงค์รูปเริ่มต้น</button>
            <button id="add-streamer">+ เพิ่ม Streamer</button>
          </div>
        </div>
        <div class="row" style="gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
          <input type="text" id="streamer-search" placeholder="ค้นหาชื่อ Streamer..." value="${Util.escapeHtml(state.streamerSearch)}" style="flex:1;min-width:180px;">
          <select id="streamer-game-filter">
            <option value="">ทุกเกม</option>
            ${games.map((g) => `<option value="${g.id}" ${state.streamerGameFilter === g.id ? "selected" : ""}>${Util.escapeHtml(g.name)}</option>`).join("")}
          </select>
          <select id="streamer-time-filter">
            <option value="">ทุกช่วงเวลา</option>
            ${Util.TIME_SLOTS.map((t) => `<option value="${t.key}" ${state.streamerTimeFilter === t.key ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
          <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="streamer-emergency-filter" ${state.streamerEmergencyFilter ? "checked" : ""}> 🚨 เฉพาะที่ฉุกเฉินได้
          </label>
        </div>
        <div style="overflow-x:auto;">
        <table>
          <thead><tr><th></th><th>ชื่อ</th><th>เกม &amp; ราคา</th><th>ช่วงเวลาที่สะดวก</th><th>วันที่สะดวก</th><th>ฉุกเฉิน</th><th></th></tr></thead>
          <tbody>
            ${streamers.length === 0 ? `<tr><td colspan="7"><div class="empty-state">ไม่พบ Streamer ที่ตรงกับตัวกรอง</div></td></tr>` : ""}
            ${streamers.map((s) => {
              const row = `<tr>
                <td>${Util.avatarHTML(s, "tiny")}</td>
                <td style="white-space:nowrap;">${Util.escapeHtml(s.name)}</td>
                <td>${gamePriceCell(s)}</td>
                <td style="white-space:nowrap;">${timeSlotCell(s)}</td>
                <td style="white-space:nowrap;">${dayCell(s)}</td>
                <td style="white-space:nowrap;">${emergencyCell(s)}</td>
                <td class="row" style="gap:6px;">
                  <button class="secondary small" data-edit="${s.id}">แก้ไข</button>
                  <button class="danger small" data-del="${s.id}">ลบ</button>
                </td>
              </tr>`;
              const editorRow = state.editingStreamerId === s.id
                ? `<tr class="editor-row" id="editor-row-${s.id}"><td colspan="7">${renderStreamerEditor(s)}</td></tr>`
                : "";
              return row + editorRow;
            }).join("")}
          </tbody>
        </table>
        </div>
      </div>
    `;

    body.querySelector("#streamer-search").addEventListener("input", (e) => {
      state.streamerSearch = e.target.value;
      const cursorPos = e.target.selectionStart;
      renderBody(body.closest("main"));
      const newInput = body.querySelector("#streamer-search");
      if (newInput) { newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
    });
    body.querySelector("#streamer-game-filter").addEventListener("change", (e) => {
      state.streamerGameFilter = e.target.value;
      renderBody(body.closest("main"));
    });
    body.querySelector("#streamer-time-filter").addEventListener("change", (e) => {
      state.streamerTimeFilter = e.target.value;
      renderBody(body.closest("main"));
    });
    body.querySelector("#streamer-emergency-filter").addEventListener("change", (e) => {
      state.streamerEmergencyFilter = e.target.checked;
      renderBody(body.closest("main"));
    });
    const syncPhotosBtn = body.querySelector("#sync-photos-seed");
    syncPhotosBtn.addEventListener("click", async () => {
      syncPhotosBtn.disabled = true;
      syncPhotosBtn.textContent = "กำลังซิงค์...";
      try {
        const result = await DB.syncPhotosFromSeed();
        renderBody(body.closest("main"));
        Util.showToast(`ซิงค์รูปแล้ว — เติมรูปให้ ${result.updated} คน`);
      } catch (err) {
        syncPhotosBtn.disabled = false;
        syncPhotosBtn.textContent = "↻ ซิงค์รูปเริ่มต้น";
        alert("ซิงค์ไม่สำเร็จ: " + err.message);
      }
    });
    body.querySelector("#add-streamer").addEventListener("click", () => {
      const name = prompt("ชื่อ Streamer:");
      if (!name || !name.trim()) return;
      const s = DB.addStreamer(name.trim());
      state.editingStreamerId = s.id;
      renderBody(body.closest("main"));
      Util.showToast("เพิ่ม Streamer แล้ว");
    });
    body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      state.editingStreamerId = b.getAttribute("data-edit");
      renderBody(body.closest("main"));
      const row = body.querySelector(`#editor-row-${state.editingStreamerId}`);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
    body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-del");
      const s = DB.getStreamer(id);
      if (!confirm(`ลบ Streamer "${s.name}" และคิวไลฟ์ที่เกี่ยวข้องทั้งหมด?`)) return;
      DB.deleteStreamer(id);
      if (state.editingStreamerId === id) state.editingStreamerId = null;
      renderBody(body.closest("main"));
      Util.showToast("ลบแล้ว");
    }));

    if (state.editingStreamerId) attachStreamerEditorEvents(body);
  }

  function gamePriceCell(s) {
    const prices = s.prices || [];
    if (!prices.length) return `<span style="color:var(--text-dim);font-size:12px;">—</span>`;
    return prices.map((p) => {
      const g = DB.getGame(p.gameId);
      const hasDiscount = p.discountPrice !== null && p.discountPrice !== undefined && p.discountPrice !== "";
      const priceText = hasDiscount
        ? `฿${Util.fmtMoney(p.normalPrice)} → <strong style="color:var(--success);">฿${Util.fmtMoney(p.discountPrice)}</strong>`
        : `฿${Util.fmtMoney(p.normalPrice)}`;
      return `<div style="white-space:nowrap;margin-bottom:2px;"><span class="badge" style="background:${g ? g.color : "#666"};margin-right:6px;">${g ? Util.escapeHtml(g.name) : "?"}</span><span style="font-size:12px;">${priceText}</span></div>`;
    }).join("");
  }

  function timeSlotCell(s) {
    const avail = s.availability || {};
    const timeSlots = avail.timeSlots || [];
    if (!timeSlots.length) return `<span style="color:var(--text-dim);font-size:12px;">—</span>`;
    return Util.TIME_SLOTS.map((t) => {
      const isAvail = timeSlots.includes(t.key);
      return `<span class="badge" style="background:${isAvail ? "var(--success)" : "rgba(192,57,43,0.12)"};color:${isAvail ? "white" : "var(--danger)"};border:1px solid ${isAvail ? "var(--success)" : "var(--danger)"};margin-right:3px;">${t.label}</span>`;
    }).join("");
  }

  function dayCell(s) {
    const avail = s.availability || {};
    const days = avail.days || [];
    const checkBadge = avail.needsCheck ? `<span class="badge" style="background:#3b82f6;color:white;margin-right:3px;">❓ ต้องเช็ค</span>` : "";
    if (!days.length) return checkBadge || `<span style="color:var(--text-dim);font-size:12px;">—</span>`;
    const dayBadges = Util.AVAIL_DAYS.map((d) => {
      const isAvail = days.includes(d.key);
      return `<span class="badge" style="background:${isAvail ? "var(--success)" : "rgba(192,57,43,0.12)"};color:${isAvail ? "white" : "var(--danger)"};border:1px solid ${isAvail ? "var(--success)" : "var(--danger)"};margin-right:3px;">${d.label}</span>`;
    }).join("");
    return checkBadge + dayBadges;
  }

  function emergencyCell(s) {
    return s.emergencyAvailable
      ? `<span class="badge" style="background:var(--danger);">🚨 ฉุกเฉินได้</span>`
      : `<span style="color:var(--text-dim);font-size:12px;">—</span>`;
  }

  function renderStreamerEditor(s) {
    if (!s) return "";
    const games = DB.listGames();
    const prices = s.prices || [];
    const usedGameIds = new Set(prices.map((p) => p.gameId));
    const availableGames = games.filter((g) => !usedGameIds.has(g.id));
    const avail = s.availability || {};
    const availTimeSlots = avail.timeSlots || [];
    const availDays = avail.days || [];
    return `
      <div class="card editor-card" id="streamer-editor">
        <div class="row between"><h2>แก้ไข: ${Util.escapeHtml(s.name)}</h2><button class="modal-close" id="close-editor">✕</button></div>

        <div class="photo-upload-row">
          ${Util.avatarHTML(s, "large")}
          <div class="field">
            <label>รูปภาพ Streamer (อัปโหลดจากเครื่อง หรือวางลิงก์รูปภาพ)</label>
            <input type="file" id="streamer-photo-file" accept="image/*">
            <input id="streamer-photo-url" placeholder="หรือวางลิงก์รูปภาพ เช่น https://..." value="${s.photo && s.photo.startsWith("http") ? Util.escapeHtml(s.photo) : ""}" style="margin-top:6px;width:100%;">
            <p style="color:var(--text-dim);font-size:11px;margin:4px 0 0;">ลิงก์ต้องเป็นลิงก์รูปโดยตรง (เปิดแล้วเห็นแต่รูป ไม่ใช่หน้าเว็บ) — ลิงก์แชร์จาก Google Drive/Facebook มักใช้ไม่ได้ ถ้าไม่แน่ใจแนะนำอัปโหลดไฟล์แทน</p>
          </div>
          ${s.photo ? `<button class="secondary small" id="remove-photo">ลบรูป</button>` : ""}
        </div>

        <div class="field" style="max-width:300px;margin-bottom:14px;">
          <label>ชื่อ Streamer</label>
          <input id="streamer-name" value="${Util.escapeHtml(s.name)}">
        </div>

        <h3>เกม &amp; ราคา</h3>
        <table>
          <thead><tr><th>เกม</th><th>ราคาปกติ</th><th>ราคาพิเศษ (ถ้ามี)</th><th></th></tr></thead>
          <tbody>
            ${prices.map((p) => {
              const g = DB.getGame(p.gameId);
              return `<tr>
                <td><span class="badge" style="background:${g ? g.color : "#666"}">${g ? Util.escapeHtml(g.name) : "?"}</span></td>
                <td><input type="number" min="0" class="price-normal" data-game="${p.gameId}" value="${p.normalPrice}" style="width:100px;"></td>
                <td><input type="number" min="0" class="price-discount" data-game="${p.gameId}" value="${p.discountPrice ?? ""}" placeholder="—" style="width:100px;"></td>
                <td><button class="danger small" data-del-price="${p.gameId}">ลบ</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>

        ${availableGames.length ? `
        <div class="row" style="margin-top:12px;">
          <select id="new-price-game">
            ${availableGames.map((g) => `<option value="${g.id}">${Util.escapeHtml(g.name)}</option>`).join("")}
          </select>
          <button id="add-price-row" class="secondary">+ เพิ่มเกม</button>
        </div>` : ""}

        <h3 style="margin-top:20px;">ช่วงเวลาที่สะดวก</h3>
        <div class="avail-day-row">
          ${Util.TIME_SLOTS.map((t) => `<button type="button" class="avail-day-chip ${availTimeSlots.includes(t.key) ? "active" : ""}" data-slot="${t.key}">${t.label}</button>`).join("")}
        </div>

        <h3 style="margin-top:16px;">วันที่สะดวก</h3>
        <div class="avail-day-row">
          ${Util.AVAIL_DAYS.map((d) => `<button type="button" class="avail-day-chip ${availDays.includes(d.key) ? "active" : ""}" data-day="${d.key}">${d.label}</button>`).join("")}
        </div>

        <div class="row" style="margin-top:16px;">
          <button id="save-streamer">บันทึก</button>
        </div>
      </div>
    `;
  }

  // Saves whatever is currently sitting in the name/price/availability fields, so that any
  // action which re-renders the editor (photo change, add/remove a price row, etc.) never
  // silently discards edits the admin hasn't clicked "บันทึก" for yet.
  function commitDraft(editor) {
    const name = editor.querySelector("#streamer-name").value.trim();
    const timeSlots = Array.from(editor.querySelectorAll("[data-slot].active")).map((el) => el.getAttribute("data-slot"));
    const days = Array.from(editor.querySelectorAll("[data-day].active")).map((el) => el.getAttribute("data-day"));
    const patch = { availability: { timeSlots, days } };
    if (name) patch.name = name;
    DB.updateStreamer(state.editingStreamerId, patch);
    editor.querySelectorAll(".price-normal").forEach((inp) => {
      const gameId = inp.getAttribute("data-game");
      const normal = Number(inp.value) || 0;
      const discInp = editor.querySelector(`.price-discount[data-game="${gameId}"]`);
      const disc = discInp.value === "" ? null : Number(discInp.value);
      DB.setPrice(state.editingStreamerId, gameId, normal, disc);
    });
  }

  function attachStreamerEditorEvents(body) {
    const editor = body.querySelector("#streamer-editor");
    if (!editor) return;
    editor.querySelector("#close-editor").addEventListener("click", () => {
      state.editingStreamerId = null;
      renderBody(body.closest("main"));
    });
    const photoFile = editor.querySelector("#streamer-photo-file");
    if (photoFile) photoFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Phone camera photos routinely land at 3-8MB — rejecting those outright ("ไฟล์รูปใหญ่เกินไป")
      // was the actual reason uploads kept failing for anyone shooting straight from their phone.
      // Downscale/recompress through a canvas instead of rejecting, so a normal phone photo just works.
      Util.resizeImageToDataURL(file, 1000, 0.85).then((dataUrl) => {
        commitDraft(editor);
        DB.updateStreamer(state.editingStreamerId, { photo: dataUrl });
        renderBody(body.closest("main"));
        Util.showToast("อัปเดตรูปภาพแล้ว");
      }).catch((err) => {
        alert("อัปโหลดรูปไม่สำเร็จ: " + err.message);
      });
    });
    const photoUrl = editor.querySelector("#streamer-photo-url");
    if (photoUrl) photoUrl.addEventListener("change", () => {
      const val = photoUrl.value.trim();
      if (!val) return;
      commitDraft(editor);
      DB.updateStreamer(state.editingStreamerId, { photo: val });
      renderBody(body.closest("main"));
      Util.showToast("อัปเดตรูปภาพแล้ว");
    });
    const removePhoto = editor.querySelector("#remove-photo");
    if (removePhoto) removePhoto.addEventListener("click", () => {
      commitDraft(editor);
      DB.updateStreamer(state.editingStreamerId, { photo: null });
      renderBody(body.closest("main"));
      Util.showToast("ลบรูปแล้ว");
    });
    editor.querySelectorAll(".avail-day-chip").forEach((chip) => chip.addEventListener("click", () => {
      chip.classList.toggle("active");
    }));
    const addBtn = editor.querySelector("#add-price-row");
    if (addBtn) addBtn.addEventListener("click", () => {
      commitDraft(editor);
      const gameId = editor.querySelector("#new-price-game").value;
      DB.setPrice(state.editingStreamerId, gameId, 0, null);
      renderBody(body.closest("main"));
    });
    editor.querySelectorAll("[data-del-price]").forEach((b) => b.addEventListener("click", () => {
      commitDraft(editor);
      DB.deletePrice(state.editingStreamerId, b.getAttribute("data-del-price"));
      renderBody(body.closest("main"));
      Util.showToast("ลบราคาแล้ว");
    }));
    editor.querySelector("#save-streamer").addEventListener("click", () => {
      commitDraft(editor);
      state.editingStreamerId = null;
      renderBody(body.closest("main"));
      Util.showToast("บันทึกแล้ว — Dashboard และหน้าสรุปอัปเดตอัตโนมัติ");
    });
  }

  // ---------------- Games ----------------
  function renderGames(body) {
    const games = DB.listGames();
    body.innerHTML = `
      <div class="card">
        <div class="row between"><h2>เกม (${games.length})</h2><button id="add-game">+ เพิ่มเกม</button></div>
        <div style="overflow-x:auto;">
        <p style="color:var(--text-dim);font-size:12px;margin-top:-4px;">Channel ID ใช้สำหรับหน้า "ไลฟ์สด" (แสดงภาพสดจริง) — ถ้าไม่รู้ Channel ID ส่งลิงก์ช่อง YouTube มาให้ทีมพัฒนาหาให้ได้</p>
        <table>
          <thead><tr><th>สี</th><th>ชื่อย่อ</th><th>ชื่อเต็ม</th><th>ช่องไลฟ์ (YouTube)</th><th>Channel ID</th><th></th></tr></thead>
          <tbody>
            ${games.map((g) => `<tr data-row="${g.id}">
              <td><input type="color" class="g-color" data-id="${g.id}" value="${g.color}" style="width:40px;padding:2px;"></td>
              <td><input class="g-name" data-id="${g.id}" value="${Util.escapeHtml(g.name)}" style="width:140px;"></td>
              <td><input class="g-fullname" data-id="${g.id}" value="${Util.escapeHtml(g.fullName)}" style="width:200px;"></td>
              <td><input class="g-youtube" data-id="${g.id}" value="${g.youtubeUrl ? Util.escapeHtml(g.youtubeUrl) : ""}" placeholder="https://www.youtube.com/@channel/streams" style="width:260px;"></td>
              <td><input class="g-channelid" data-id="${g.id}" value="${g.channelId ? Util.escapeHtml(g.channelId) : ""}" placeholder="UCxxxxxxxxxxxxxxxxxxxxxx" style="width:220px;"></td>
              <td><button class="secondary small" data-save="${g.id}">บันทึก</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
        </div>
      </div>

      <div class="card">
        <div class="row between">
          <h2>Brief สำหรับหน้าไลฟ์สด</h2>
        </div>
        <p style="color:var(--text-dim);font-size:12px;margin-top:-4px;">โน้ตสิ่งที่อยากให้ Streamer โปรโมทของแต่ละเกม พร้อมช่วงวันที่ — จะไปแสดงเป็นกล่องในหน้า "ไลฟ์สด"</p>
        ${games.map((g) => {
          const brief = g.brief || { text: "", startDate: null, endDate: null };
          return `<div class="brief-row" data-brief-row="${g.id}">
            <div class="row between" style="margin-bottom:6px;">
              <strong style="color:${g.color};">${Util.escapeHtml(g.name)}</strong>
            </div>
            <textarea class="brief-text" placeholder="เช่น โปรโมทอีเวนต์ล่าสมบัติ, พูดถึงโค้ดส่วนลด...">${Util.escapeHtml(brief.text || "")}</textarea>
            <div class="row" style="gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;">
              <label style="font-size:12px;color:var(--text-dim);">ตั้งแต่</label>
              <input type="date" class="brief-start" value="${brief.startDate || ""}">
              <label style="font-size:12px;color:var(--text-dim);">ถึง</label>
              <input type="date" class="brief-end" value="${brief.endDate || ""}">
              <button class="secondary small" data-save-brief="${g.id}">บันทึก Brief</button>
            </div>
          </div>`;
        }).join("")}
      </div>
    `;
    body.querySelector("#add-game").addEventListener("click", () => {
      const name = prompt("ชื่อย่อเกม (เช่น TOSM):");
      if (!name || !name.trim()) return;
      DB.addGame({ name: name.trim(), fullName: name.trim(), color: "#6366f1" });
      renderBody(body.closest("main"));
      Util.showToast("เพิ่มเกมแล้ว");
    });
    body.querySelectorAll("[data-save]").forEach((btn) => btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-save");
      const row = body.querySelector(`tr[data-row="${id}"]`);
      const youtubeUrl = row.querySelector(".g-youtube").value.trim();
      const channelId = row.querySelector(".g-channelid").value.trim();
      DB.updateGame(id, {
        color: row.querySelector(".g-color").value,
        name: row.querySelector(".g-name").value.trim(),
        fullName: row.querySelector(".g-fullname").value.trim(),
        youtubeUrl: youtubeUrl || null,
        channelId: channelId || null,
      });
      Util.showToast("บันทึกแล้ว — Dashboard และหน้าสรุปอัปเดตอัตโนมัติ");
      renderBody(body.closest("main"));
    }));
    body.querySelectorAll("[data-save-brief]").forEach((btn) => btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-save-brief");
      const row = body.querySelector(`[data-brief-row="${id}"]`);
      const text = row.querySelector(".brief-text").value.trim();
      const startDate = row.querySelector(".brief-start").value || null;
      const endDate = row.querySelector(".brief-end").value || null;
      DB.updateGame(id, { brief: { text, startDate, endDate } });
      Util.showToast("บันทึก Brief แล้ว — หน้าไลฟ์สดอัปเดตอัตโนมัติ");
    }));
  }

  return { render };
})();
