// Small behaviours shared by every theme: tabs, the mobile menu and the
// dismissible announcement banner.

(() => {
  // Tabs: [data-tabs] containing [role=tab][aria-controls] buttons
  document.querySelectorAll("[data-tabs]").forEach((tabs) => {
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const select = (button) => {
      for (const b of buttons) {
        const selected = b === button;
        b.setAttribute("aria-selected", selected);
        b.tabIndex = selected ? 0 : -1;
        document.getElementById(b.getAttribute("aria-controls")).hidden = !selected;
      }
    };
    buttons.forEach((button, i) => {
      button.addEventListener("click", () => select(button));
      button.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        const next = buttons[(i + step + buttons.length) % buttons.length];
        next.focus();
        select(next);
      });
    });
  });

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
