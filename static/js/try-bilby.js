// In-browser bilby runner and Python syntax highlighting.
//
// Markup (see templates/macros.html, `runner`):
//   [data-runner]            container; data-pyodide (version), data-packages (JSON)
//     [data-runner-examples] <script type="application/json"> [{name, code}, ...]
//     [data-runner-example]  <select> of examples
//     [data-runner-code]     <textarea>, overlaid on [data-runner-highlight]
//     [data-runner-run] [data-runner-stop] [data-runner-reset]  buttons
//     [data-runner-status] [data-runner-log] [data-runner-figures]  output
// Any element with [data-highlight] has its Python text highlighted.

(() => {
  const here = document.currentScript.src;
  const asset = (path) => new URL(path, here).href;

  // ------------------------------------------------------------ highlighting
  const KEYWORDS = new Set(("False None True and as assert async await break class continue def del elif else " +
    "except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" "));
  const BUILTINS = new Set("print range len dict list tuple set int float str enumerate zip min max sum abs open super isinstance".split(" "));
  const TOKEN = /(#[^\n]*)|([rbfRBF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b)|(@[\w.]+)|([A-Za-z_]\w*)/g;
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlight(code) {
    let out = "", last = 0, previous = "";
    for (const m of code.matchAll(TOKEN)) {
      out += escape(code.slice(last, m.index));
      const [text, comment, string, number, decorator, name] = m;
      let cls = null;
      if (comment) cls = "c";
      else if (string) cls = "s";
      else if (number) cls = "n";
      else if (decorator) cls = "d";
      else if (name && KEYWORDS.has(name)) cls = "k";
      else if (name && (previous === "def" || previous === "class")) cls = "f";
      else if (name && BUILTINS.has(name)) cls = "b";
      else if (name && code[m.index + name.length] === "(") cls = "f";
      out += cls ? `<span class="tok-${cls}">${escape(text)}</span>` : escape(text);
      if (name) previous = name;
      last = m.index + text.length;
    }
    return out + escape(code.slice(last));
  }

  document.querySelectorAll("[data-highlight]").forEach((el) => {
    el.innerHTML = highlight(el.textContent);
  });

  // ------------------------------------------------------------------ copy
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const source = button.dataset.copy ? document.querySelector(button.dataset.copy) : null;
    const text = source ? source.textContent : button.dataset.copyText;
    try {
      await navigator.clipboard.writeText(text.trim());
      const label = button.getAttribute("aria-label") || "";
      button.classList.add("copied");
      button.setAttribute("aria-label", "Copied");
      setTimeout(() => { button.classList.remove("copied"); button.setAttribute("aria-label", label); }, 1500);
    } catch { /* clipboard unavailable: nothing to do */ }
  });

  // ------------------------------------------------------------------ runner
  document.querySelectorAll("[data-runner]").forEach(setUpRunner);

  function setUpRunner(root) {
    const $ = (name) => root.querySelector(`[data-runner-${name}]`);
    const examples = JSON.parse($("examples").textContent);
    const select = $("example"), code = $("code"), shade = $("highlight");
    const runButton = $("run"), stopButton = $("stop"), resetButton = $("reset");
    const status = $("status"), log = $("log"), figures = $("figures");
    const packages = JSON.parse(root.dataset.packages);
    let worker = null, ready = false, running = false, timer = null, started = 0;

    const render = () => { shade.innerHTML = highlight(code.value) + "\n"; };
    const sync = () => { shade.scrollTop = code.scrollTop; shade.scrollLeft = code.scrollLeft; };
    const load = (i) => { code.value = examples[i].code; render(); sync(); };
    examples.forEach((ex, i) => select.add(new Option(ex.name, i)));
    load(0);

    code.addEventListener("input", render);
    code.addEventListener("scroll", sync);
    code.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        document.execCommand("insertText", false, "    ");
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        run();
      }
    });
    select.addEventListener("change", () => load(select.value));
    resetButton.addEventListener("click", () => load(select.value));
    runButton.addEventListener("click", run);
    stopButton.addEventListener("click", () => {
      stop();
      setStatus("Stopped. Python restarts on the next run.", "idle");
    });

    function setStatus(text, state) {
      status.textContent = text;
      root.dataset.state = state;
    }

    function setRunning(value) {
      running = value;
      runButton.hidden = value;
      stopButton.hidden = !value;
      clearInterval(timer);
      if (value) {
        started = performance.now();
        timer = setInterval(() => {
          const seconds = ((performance.now() - started) / 1000).toFixed(0);
          status.dataset.elapsed = `${seconds} s`;
        }, 500);
      } else {
        delete status.dataset.elapsed;
      }
    }

    function stop() {
      if (worker) worker.terminate();
      worker = null;
      ready = false;
      setRunning(false);
    }

    function append(text) {
      log.textContent += text + "\n";
      log.hidden = false;
      log.scrollTop = log.scrollHeight;
    }

    async function startWorker() {
      worker = new Worker(asset("worker.js"));
      worker.onmessage = ({ data }) => {
        if (data.type === "status") setStatus(`${data.text}…`, "loading");
        else if (data.type === "ready") { ready = true; setStatus(`Running with bilby ${data.version}…`, "running"); }
        else if (data.type === "stream") append(data.text);
        else if (data.type === "error") { append(data.text); setStatus("The code raised an error (see the log).", "error"); }
        else if (data.type === "image") {
          const img = new Image();
          img.src = `data:image/png;base64,${data.png}`;
          img.alt = "Figure produced by the example";
          figures.append(img);
        } else if (data.type === "done") {
          setRunning(false);
          if (root.dataset.state !== "error") setStatus(`Finished in ${data.seconds.toFixed(1)} s.`, "done");
        }
      };
      const runner = await (await fetch(asset("../py/_runner.py"))).text();
      worker.postMessage({ type: "init", pyodide: root.dataset.pyodide, bilby: root.dataset.bilby, packages, runner });
    }

    async function run() {
      if (running) return;
      log.textContent = "";
      log.hidden = true;
      figures.replaceChildren();
      setRunning(true);
      if (!worker) {
        setStatus("Downloading Python and bilby (about 40 MB, cached afterwards)…", "loading");
        await startWorker();
      } else {
        setStatus("Running…", "running");
      }
      worker.postMessage({ type: "run", code: code.value });
    }
  }
})();
