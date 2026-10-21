// Runs Pyodide + bilby off the main thread for static/js/try-bilby.js.
//   in:  {type: "init", pyodide, packages, runner}  (runner: source of static/py/_runner.py)
//        {type: "run", code}
//   out: {type: "status", text} | {type: "ready", version} | {type: "stream", text}
//        {type: "image", png} | {type: "done", seconds} | {type: "error", text}
// The page stops a run by terminating the worker and starting a new one.

let pyodide = null;
let ready = null;
const post = (type, data = {}) => postMessage({ type, ...data });

async function init({ pyodide: version, packages, runner }) {
  importScripts(`https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.js`);
  post("status", { text: "Starting Python" });
  pyodide = await loadPyodide();
  pyodide.setStdout({ batched: (text) => post("stream", { text }) });
  pyodide.setStderr({ batched: (text) => post("stream", { text }) });
  post("status", { text: "Loading numpy, scipy and matplotlib" });
  await pyodide.loadPackage(packages, { messageCallback: () => {} });
  post("status", { text: "Installing bilby from PyPI" });
  await pyodide.pyimport("micropip").install("bilby");
  post("status", { text: "Importing bilby" });
  await pyodide.runPythonAsync(runner);
  post("ready", { version: pyodide.globals.get("bilby_version")() });
}

async function run(code) {
  const start = performance.now();
  try {
    await pyodide.loadPackagesFromImports(code, { messageCallback: () => {} });
    await pyodide.runPythonAsync(code);
  } catch (error) {
    // Show only the Python traceback's tail, not Pyodide's internals
    const text = String(error.message || error);
    post("error", { text: text.slice(text.lastIndexOf('File "<exec>"')).trim() || text });
  }
  const images = pyodide.globals.get("collect_figures")().toJs();
  for (const png of images) post("image", { png });
  post("done", { seconds: (performance.now() - start) / 1000 });
}

onmessage = async ({ data }) => {
  if (data.type === "init") {
    ready = init(data).catch((error) => post("error", { text: `Could not start bilby: ${error}` }));
  } else if (data.type === "run") {
    await ready;
    if (pyodide) await run(data.code);
  }
};
