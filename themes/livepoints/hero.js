// Hero animation for the "livepoints" design: a toy nested sampler whose
// likelihood is the word "bilby", as in the script that drew the bilby logo.
// Live points start uniform over the canvas. Each iteration the lowest-
// likelihood point dies (and stays faintly drawn, like a posterior sample)
// and is replaced by a point at higher likelihood, so the cloud shrinks
// onto the letters.

(() => {
  const canvas = document.querySelector("[data-live-points]");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const hud = document.querySelector("[data-live-hud]");
  const replay = document.querySelector("[data-live-replay]");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SCALE = 3; // the likelihood grid is 1/SCALE of the canvas resolution
  const COLOURS = ["#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5"];

  let width, height, dpr, grid, gw, gh, live, dead, deadCtx, iteration, step, done, visible = true, frame;

  function likelihoodAt(x, y) {
    const i = (x / SCALE) | 0, j = (y / SCALE) | 0;
    return i < 0 || j < 0 || i >= gw || j >= gh ? 0 : grid[j * gw + i];
  }

  function buildLikelihood() {
    gw = Math.ceil(width / SCALE);
    gh = Math.ceil(height / SCALE);
    const off = new OffscreenCanvasOrCanvas(gw, gh);
    const o = off.getContext("2d", { willReadFrequently: true });
    const size = Math.min(gw * 0.28, gh * 0.46);
    // Blurred text via its shadow: the text itself is drawn off-canvas and
    // only the shadow lands on it (ctx.filter is not supported everywhere).
    const draw = (blur, alpha) => {
      o.shadowColor = `rgba(255,255,255,${alpha})`;
      o.shadowBlur = blur;
      o.shadowOffsetX = gw * 2;
      o.fillStyle = "#fff";
      o.font = `700 ${size}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillText("bilby", gw / 2 - gw * 2, gh * 0.27);
    };
    draw(size * 0.2, 0.35); // a faint, broad halo guides points towards the word
    draw(size * 0.012, 1); // the letters themselves: a plateau at the peak
    const pixels = o.getImageData(0, 0, gw, gh).data;
    grid = new Float32Array(gw * gh);
    let max = 0;
    for (let k = 0; k < grid.length; k++) max = Math.max(max, pixels[4 * k + 3]);
    // Normalised to a peak of 1, with a little noise so ties are broken
    for (let k = 0; k < grid.length; k++) grid[k] = (pixels[4 * k + 3] / (max || 1)) * 0.999 + 1e-3 * Math.random();
  }

  function OffscreenCanvasOrCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function reset() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.round(rect.width * dpr);
    height = Math.round(rect.height * dpr);
    canvas.width = width;
    canvas.height = height;
    buildLikelihood();
    const n = Math.round(Math.min(1400, Math.max(500, (rect.width * rect.height) / 700)));
    live = Array.from({ length: n }, () => {
      const x = Math.random() * width, y = Math.random() * height;
      return { x, y, l: likelihoodAt(x, y) };
    });
    const layer = OffscreenCanvasOrCanvas(width, height);
    deadCtx = layer.getContext("2d");
    dead = layer;
    iteration = 0;
    step = width / 8;
    done = false;
  }

  function iterate() {
    let worst = 0;
    for (let k = 1; k < live.length; k++) if (live[k].l < live[worst].l) worst = k;
    const threshold = live[worst].l;
    const p = live[worst];
    deadCtx.fillStyle = COLOURS[Math.min(COLOURS.length - 1, (threshold * COLOURS.length) | 0)];
    deadCtx.globalAlpha = 0.35 + 0.5 * threshold;
    deadCtx.fillRect(p.x - dpr * 0.6, p.y - dpr * 0.6, dpr * 1.2, dpr * 1.2);
    // Replace it: a short random walk from a random live point, constrained
    // to likelihood above the threshold (as a real nested sampler does).
    const start = live[(Math.random() * live.length) | 0];
    let x = start.x, y = start.y, l = start.l, accepted = 0;
    for (let t = 0; t < 12; t++) {
      const nx = x + gauss() * step, ny = y + gauss() * step;
      const nl = likelihoodAt(nx, ny);
      if (nl > threshold) { x = nx; y = ny; l = nl; accepted++; }
    }
    step *= accepted > 3 ? 1.02 : 0.97; // keep roughly a quarter of proposals accepted
    step = Math.max(dpr, Math.min(step, width / 6));
    live[worst] = { x, y, l };
    iteration++;
    return threshold;
  }

  function gauss() {
    return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
  }

  function draw(threshold) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(dead, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e8f3ff";
    const r = 1.35 * dpr;
    for (const p of live) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (hud) {
      hud.textContent = `iteration ${iteration.toLocaleString()} · ${live.length} live points · L* = ${threshold.toFixed(3)}`;
    }
  }

  let lastTime = 0, budget = 0;

  function tick(time) {
    frame = null;
    if (!visible || !live) return;
    let threshold = 0;
    // A fixed number of iterations per second, whatever the frame rate
    const dt = lastTime ? Math.min(50, time - lastTime) : 16;
    lastTime = time;
    budget += (dt / 1000) * live.length * 0.45;
    for (; budget >= 1 && !done; budget--) {
      threshold = iterate();
      if (threshold > 0.93) done = true;
    }
    if (done) {
      budget = 0;
      // Keep the live points gently moving within the final contour
      for (const p of live) {
        const nx = p.x + gauss() * dpr * 0.6, ny = p.y + gauss() * dpr * 0.6;
        const nl = likelihoodAt(nx, ny);
        if (nl > 0.9) { p.x = nx; p.y = ny; p.l = nl; }
      }
      threshold = Math.min(...live.map((p) => p.l));
    }
    draw(threshold);
    frame = requestAnimationFrame(tick);
  }

  function start() {
    cancelAnimationFrame(frame);
    reset();
    if (reduceMotion) {
      let threshold = 0;
      while (threshold < 0.93 && iteration < 60000) threshold = iterate();
      draw(threshold);
    } else {
      frame = requestAnimationFrame(tick);
    }
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame && !reduceMotion) frame = requestAnimationFrame(tick);
  }).observe(canvas);

  let resizeTimer;
  let lastWidth = canvas.getBoundingClientRect().width;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = canvas.getBoundingClientRect().width;
      if (Math.abs(w - lastWidth) > 40) { lastWidth = w; start(); }
    }, 250);
  });
  replay?.addEventListener("click", start);
  document.fonts.load('700 100px Fredoka').finally(start);
})();
