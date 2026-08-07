(async function () {
  await DB.load();
  await Auth.init();

  const app = document.getElementById("app");

  const logoutLink = document.getElementById("nav-logout");

  function setActiveNav(route) {
    document.querySelectorAll("#nav-tabs a[data-route]").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-route") === route);
    });
    logoutLink.style.display = Auth.isAuthed() ? "" : "none";
  }

  function router() {
    const hash = location.hash.replace(/^#/, "") || "dashboard";
    const parts = hash.split("/");
    const route = parts[0];

    if (route === "dashboard") {
      setActiveNav("dashboard");
      Calendar.render(app);
    } else if (route === "live") {
      setActiveNav("live");
      LiveStream.render(app);
    } else if (route === "setup") {
      setActiveNav("setup");
      SetupQueue.render(app);
    } else if (route === "summary") {
      setActiveNav("summary");
      if (Auth.isAuthed()) Summary.render(app);
      else Auth.renderLogin(app, () => { setActiveNav("summary"); Summary.render(app); });
    } else if (route === "admin") {
      setActiveNav("admin");
      if (Auth.isAuthed()) Admin.render(app, parts.slice(1));
      else Auth.renderLogin(app, () => { setActiveNav("admin"); Admin.render(app, parts.slice(1)); });
    } else if (route === "streamer" && parts[1]) {
      setActiveNav("");
      StreamerView.render(app, parts[1]);
    } else {
      setActiveNav("dashboard");
      Calendar.render(app);
    }
  }

  logoutLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await Auth.logout();
    location.hash = "#dashboard";
    router();
  });

  window.addEventListener("hashchange", router);
  router();

  // Live cross-device tournament-flag updates (see js/firebase-init.js) — re-render whatever
  // page is currently open whenever someone (this device or another) toggles a tournament flag,
  // so Dashboard and the cost totals it feeds into Summary stay correct for everyone watching.
  DB.listenTournamentFlags(() => router());
  // Same idea for streamer edits made through the Admin UI (name, price, availability, photo,
  // emergency status) — so other team members see them live too, not just after a manual sheet sync.
  DB.listenStreamerUpdates(() => router());

  // Background auto-sync: staff keep typing new KOL names into the Google Sheet throughout the
  // day, and the manual "↻ โหลดตารางไลฟ์ล่าสุด" button only catches up when someone remembers to
  // click it. Poll the sheet every few minutes instead, silently — no confirm popup, no error
  // alert on a flaky connection — and only bother the user with a toast when the pulled schedule
  // actually changed, so this doesn't nag every cycle when nothing's new.
  const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000;
  setInterval(async () => {
    const before = DB.listSchedule().length;
    try {
      await DB.syncScheduleFromSheet();
    } catch (err) {
      return;
    }
    const after = DB.listSchedule().length;
    if (after !== before) {
      router();
      Util.showToast(`อัปเดตตารางไลฟ์อัตโนมัติ — มีการเปลี่ยนแปลง`);
    }
  }, AUTO_SYNC_INTERVAL_MS);
})();
