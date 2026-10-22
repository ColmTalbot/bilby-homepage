// Small behaviours: the mobile menu and the dismissible announcement banner.

(() => {
  // Mobile navigation
  document.querySelectorAll("[data-nav-toggle]").forEach((button) => {
    const nav = document.getElementById(button.getAttribute("aria-controls"));
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", open);
      nav.classList.toggle("open", open);
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        button.setAttribute("aria-expanded", "false");
        nav.classList.remove("open");
      }
    });
  });

  // Banner: hidden once dismissed, until a different announcement is pinned
  document.querySelectorAll("[data-banner]").forEach((banner) => {
    const key = `bilby-banner-dismissed:${banner.dataset.banner}`;
    try {
      if (localStorage.getItem(key)) banner.remove();
    } catch { /* storage unavailable: always show */ }
    banner.querySelector("[data-banner-close]")?.addEventListener("click", () => {
      banner.remove();
      try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
    });
  });
})();
