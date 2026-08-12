// Real login via the app's own server (see server/index.js). The password is verified there,
// server-side — this file only ever sends the plain password once over HTTPS to /api/login and
// gets back a session cookie (or a 401). It never contains, computes, or checks a credential
// itself, which is the difference from the old version: the old ID/password were plain strings
// sitting in this file, visible to anyone who read the shipped JS (View Source / DevTools).
const Auth = (() => {
  let authed = false;
  let userEmail = null;

  // Call once on app startup, before the first route render, so isAuthed() below has a real
  // answer immediately instead of racing the session check.
  async function init() {
    try {
      const res = await fetch("/api/session", { credentials: "include" });
      const data = await res.json();
      authed = !!data.authed;
      userEmail = data.email || null;
    } catch (e) {
      authed = false;
    }
  }

  function isAuthed() {
    return authed;
  }

  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch (e) {}
    authed = false;
    userEmail = null;
  }

  function renderLogin(container, onSuccess) {
    container.innerHTML = `
      <div class="card" style="max-width:340px;margin:60px auto 0;">
        <h2>เข้าสู่ระบบ</h2>
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">หน้านี้เป็นข้อมูลภายใน กรุณาเข้าสู่ระบบก่อนใช้งาน</p>
        <div class="field" style="margin-bottom:10px;">
          <label>Email</label>
          <input id="auth-id" type="email" autocomplete="username" style="width:100%;">
        </div>
        <div class="field" style="margin-bottom:10px;">
          <label>Password</label>
          <input id="auth-pw" type="password" autocomplete="current-password" style="width:100%;">
        </div>
        <div id="auth-error" style="color:var(--danger);font-size:12px;margin-bottom:10px;display:none;">Email หรือรหัสผ่านไม่ถูกต้อง</div>
        <button id="auth-submit" style="width:100%;">เข้าสู่ระบบ</button>
      </div>
    `;
    const idInput = container.querySelector("#auth-id");
    const pwInput = container.querySelector("#auth-pw");
    const errorEl = container.querySelector("#auth-error");
    const submitBtn = container.querySelector("#auth-submit");

    const submit = async () => {
      errorEl.style.display = "none";
      submitBtn.disabled = true;
      submitBtn.textContent = "กำลังเข้าสู่ระบบ...";
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: idInput.value.trim(), password: pwInput.value }),
        });
        submitBtn.disabled = false;
        submitBtn.textContent = "เข้าสู่ระบบ";
        if (!res.ok) {
          errorEl.style.display = "block";
          return;
        }
        const data = await res.json();
        authed = true;
        userEmail = data.email || null;
        // Pulls real streamer/tournament data immediately instead of leaving the page to wait
        // on the next background poll (up to 20s away) — see DB.refreshAfterLogin's comment.
        await DB.refreshAfterLogin();
        onSuccess();
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = "เข้าสู่ระบบ";
        errorEl.textContent = "เชื่อมต่อ server ไม่ได้ ลองใหม่อีกครั้ง";
        errorEl.style.display = "block";
      }
    };
    submitBtn.addEventListener("click", submit);
    [idInput, pwInput].forEach((el) => el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    }));
    idInput.focus();
  }

  return { init, isAuthed, logout, renderLogin };
})();
