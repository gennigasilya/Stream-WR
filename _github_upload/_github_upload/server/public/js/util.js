const Util = (() => {
  function fmtMoney(n) {
    return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toISODate(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
  function parseISODate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const MONTH_NAMES_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const DOW_TH = ["อา","จ","อ","พ","พฤ","ศ","ส"];
  const TIME_SLOTS = [
    { key: "afternoon", label: "บ่าย" },
    { key: "evening", label: "เย็น" },
    { key: "night", label: "ดึก" },
  ];
  const AVAIL_DAYS = [
    { key: "mon", label: "จ" },
    { key: "tue", label: "อ" },
    { key: "wed", label: "พ" },
    { key: "thu", label: "พฤ" },
    { key: "fri", label: "ศ" },
    { key: "sat", label: "ส" },
    { key: "sun", label: "อา" },
  ];
  // Special value the "List Streamer" sheet's days column uses to mean "available every day".
  const EVERY_DAY_LABEL = "ทุกวัน";
  // Special value the same days column uses to mean "not confirmed yet, need to ask".
  const NEEDS_CHECK_LABEL = "ต้องเช็ค";
  // Value the "List Streamer" sheet's last column uses to flag a streamer as available for
  // emergency (last-minute) fill-in shifts.
  const EMERGENCY_LABEL = "ฉุกเฉินได้";
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Turns http(s):// URLs in already-escaped text into clickable links. Must run AFTER
  // escapeHtml (operates on the escaped string) so it never reintroduces raw HTML from the
  // source text.
  function linkify(escapedText) {
    return String(escapedText ?? "").replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  }
  // "Today" is always computed in Thailand time (Asia/Bangkok, UTC+7), regardless of the
  // viewer's own device timezone, so the highlighted date matches Thailand's clock.
  function todayISO() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;
    return `${y}-${m}-${d}`;
  }
  // A photo failing to load once doesn't mean it's broken — flaky mobile connections (weak
  // signal, iOS Low Power Mode throttling background loads) can cause a transient failure that
  // would succeed a second later. Retry a couple of times (cache-busted, with backoff) before
  // giving up and falling back to initials.
  function handleAvatarImgError(img, initials) {
    const retries = Number(img.dataset.retries || "0");
    if (retries < 2) {
      img.dataset.retries = String(retries + 1);
      if (!img.dataset.baseSrc) img.dataset.baseSrc = img.src;
      const baseSrc = img.dataset.baseSrc;
      setTimeout(() => {
        img.src = baseSrc + (baseSrc.includes("?") ? "&" : "?") + "r=" + Date.now();
      }, 700 * (retries + 1));
    } else if (img.parentElement) {
      img.parentElement.textContent = initials;
    }
  }
  function avatarHTML(streamer, sizeClass) {
    const cls = "avatar-circle" + (sizeClass ? " " + sizeClass : "");
    const initials = streamer ? streamer.name.slice(0, 2).toUpperCase() : "?";
    if (streamer && streamer.photo) {
      return `<div class="${cls}"><img src="${streamer.photo}" alt="${escapeHtml(streamer.name)}" onerror="Util.handleAvatarImgError(this, '${escapeHtml(initials)}')"></div>`;
    }
    return `<div class="${cls}">${escapeHtml(initials)}</div>`;
  }
  // Downscales/recompresses an uploaded image file through a canvas so a normal phone-camera
  // photo (routinely 3-8MB) fits comfortably under Firebase's practical per-value write size —
  // rejecting those outright was why photo uploads kept failing for anyone shooting from a phone.
  // Never upscales a smaller image; retries at lower quality on the rare case it's still too big.
  function resizeImageToDataURL(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length > 1500000) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
        if (dataUrl.length > 1500000) { reject(new Error("ไฟล์รูปใหญ่เกินไป ลองใช้รูปที่เล็กลง")); return; }
        resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพที่เปิดได้")); };
      img.src = objectUrl;
    });
  }
  function showToast(msg) {
    const root = document.getElementById("toast-root");
    root.innerHTML = `<div class="toast">${escapeHtml(msg)}</div>`;
    setTimeout(() => { root.innerHTML = ""; }, 2200);
  }
  function openModal(html) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal">${html}</div></div>`;
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
  }
  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }
  return { fmtMoney, pad2, toISODate, parseISODate, MONTH_NAMES_TH, DOW_TH, TIME_SLOTS, AVAIL_DAYS, EVERY_DAY_LABEL, NEEDS_CHECK_LABEL, EMERGENCY_LABEL, escapeHtml, linkify, todayISO, avatarHTML, handleAvatarImgError, resizeImageToDataURL, showToast, openModal, closeModal };
})();
