/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--table" || a === "-t") {
      out.table = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--python") {
      out.python = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--mode") {
      out.mode = args[i + 1];
      i += 1;
      continue;
    }
  }
  return out;
};

const splitLines = (text) =>
  String(text || "")
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

const parsePythonJson = (stdout) => {
  const raw = String(stdout || "").trim();
  if (!raw) return { parsed: {}, extraLogs: [] };
  try {
    return { parsed: JSON.parse(raw), extraLogs: [] };
  } catch {
    const lines = splitLines(raw);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const candidate = lines[i].trim();
      if (!(candidate.startsWith("{") && candidate.endsWith("}"))) continue;
      try {
        const parsed = JSON.parse(candidate);
        const extraLogs = lines.slice(0, i);
        return { parsed, extraLogs };
      } catch {
        // continue
      }
    }
    return { parsed: undefined, extraLogs: lines };
  }
};

const main = () => {
  const { table: tableArg, python, mode } = parseArgs();
  const tablePath =
    tableArg ||
    path.join(process.env.HOME || "", ".config", "my-electron-app", "visualiser", "datahub-table.json");
  if (!fs.existsSync(tablePath)) {
    console.error(`[visualiser-smoke] missing table file: ${tablePath}`);
    process.exit(2);
  }

  const hostScript = path.join(__dirname, "..", "shared", "python_backend", "visualise", "visualise_host.py");
  if (!fs.existsSync(hostScript)) {
    console.error(`[visualiser-smoke] missing python host: ${hostScript}`);
    process.exit(2);
  }

  const table = JSON.parse(fs.readFileSync(tablePath, "utf-8"));
  const req = {
    action: "preview",
    table,
    include: [],
    params: {},
    collectionName: "Collection",
    mode: mode || "run_inputs"
  };

  const py = python || process.env.PYTHON || process.env.PYTHON3 || (process.platform === "win32" ? "python" : "python3");
  const logsMaxBytes = 80 * 1024 * 1024;

  const run = () =>
    new Promise((resolve) => {
      const child = spawn(py, [hostScript], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > logsMaxBytes) {
          stdout = stdout.slice(stdout.length - logsMaxBytes);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > logsMaxBytes) {
          stderr = stderr.slice(stderr.length - logsMaxBytes);
        }
      });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.write(JSON.stringify(req));
      child.stdin.end();
    });

  return run().then(({ stdout, stderr, code }) => {
    const { parsed, extraLogs } = parsePythonJson(stdout);
    const stderrLogs = splitLines(stderr);
    const logs = [...extraLogs, ...((parsed && parsed.logs) || []), ...stderrLogs];

    if (!parsed || parsed.status !== "ok") {
      console.error("[visualiser-smoke] status != ok", { code });
      console.error(parsed);
      logs.slice(0, 60).forEach((l) => console.error(l));
      process.exit(1);
    }

    const slides = ((parsed.deck || {}).slides || []).filter((s) => s && typeof s === "object");
    const bySection = new Map();
    const bump = (sec, key) => {
      if (!bySection.has(sec)) bySection.set(sec, { slides: 0, fig: 0, table: 0, img: 0, types: new Map() });
      const rec = bySection.get(sec);
      rec[key] += 1;
    };
    const bumpType = (sec, type) => {
      if (!bySection.has(sec)) bySection.set(sec, { slides: 0, fig: 0, table: 0, img: 0, types: new Map() });
      const rec = bySection.get(sec);
      rec.types.set(type, (rec.types.get(type) || 0) + 1);
    };

    slides.forEach((s) => {
      const sec = String(s.section || "").trim() || "(none)";
      bump(sec, "slides");
      if (s.fig_json) {
        bump(sec, "fig");
        const fig = s.fig_json;
        const data = fig && typeof fig === "object" ? fig.data : null;
        if (Array.isArray(data)) {
          data.forEach((t) => {
            if (t && typeof t === "object") bumpType(sec, String(t.type || "scatter"));
          });
        }
      }
      if (String(s.table_html || "").trim()) bump(sec, "table");
      if (String(s.img || "").trim() || String(s.thumb_img || "").trim()) bump(sec, "img");
    });

    console.log(`[visualiser-smoke] slides=${slides.length} sections=${bySection.size} table=${tablePath}`);
    Array.from(bySection.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([sec, rec]) => {
        const types = Array.from(rec.types.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t, n]) => `${t}:${n}`)
          .join(", ");
        console.log(
          `${sec} slides=${rec.slides} fig=${rec.fig} table=${rec.table} img=${rec.img}${types ? ` types=${types}` : ""}`
        );
      });

    const bad = Array.from(bySection.entries()).filter(
      ([, rec]) => rec.slides > 0 && rec.fig === 0 && rec.table === 0 && rec.img === 0
    );
    if (bad.length) {
      console.error("[visualiser-smoke] sections with no renderable content:");
      bad.forEach(([sec]) => console.error(`- ${sec}`));
      process.exit(1);
    }
  });
};

void main();
