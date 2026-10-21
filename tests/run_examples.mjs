// Runs every example in content/site.yaml `try_examples` under Pyodide in
// Node, the same way static/js/worker.js does in the browser, and fails if
// any raises or produces no figure. Needs `npm install pyodide@<version>`
// (the version in site.yaml) and Python with PyYAML to read the config.
//
//   node tests/run_examples.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadPyodide } from "pyodide";

const root = new URL("..", import.meta.url).pathname;
const config = JSON.parse(execFileSync("python3", ["-c",
  "import json, yaml; print(json.dumps(yaml.safe_load(open('content/site.yaml'))))"], { cwd: root }));
const { version, pyodide_packages: packages } = config.pyodide;

const pyodide = await loadPyodide({ packageBaseUrl: `https://cdn.jsdelivr.net/pyodide/v${version}/full/` });
let output = "";
pyodide.setStdout({ batched: (s) => (output += s + "\n") });
pyodide.setStderr({ batched: (s) => (output += s + "\n") });
await pyodide.loadPackage(packages, { messageCallback: () => {} });
await pyodide.pyimport("micropip").install("bilby");
pyodide.runPython(readFileSync(root + "static/py/_runner.py", "utf8"));
console.log(`Pyodide ${version}, bilby ${pyodide.globals.get("bilby_version")()}`);

let failures = 0;
for (const example of config.try_examples) {
  output = "";
  const start = Date.now();
  try {
    await pyodide.runPythonAsync(readFileSync(root + example.file, "utf8"));
    const figures = pyodide.globals.get("collect_figures")().toJs();
    if (!figures.length) throw new Error("no figure was produced");
    console.log(`ok    ${example.name} (${((Date.now() - start) / 1000).toFixed(1)} s, ${figures.length} figure(s))`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${example.name}\n${output.slice(-2000)}\n${String(error).slice(-2000)}`);
  }
}
process.exit(failures ? 1 : 0);
