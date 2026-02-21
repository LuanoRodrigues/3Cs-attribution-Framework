const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

class FeatureWorker {
  constructor() {
    this.child = null;
    this.rl = null;
    this.seq = 1;
    this.pending = new Map();
    this.ready = false;
    this.lastError = "";
  }

  start() {
    if (this.child && !this.child.killed) return;
    const pythonCmd = process.env.PYTHON_BIN || "python3";
    const scriptPath = path.join(__dirname, "py", "run_zotero_feature_worker.py");
    this.child = spawn(pythonCmd, [scriptPath], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.ready = true;

    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      let msg = null;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const id = Number(msg?.id || 0);
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      entry.resolve(msg);
    });

    this.child.stderr.on("data", (buf) => {
      this.lastError = String(buf || "").slice(-4000);
    });

    this.child.on("exit", (code) => {
      this.ready = false;
      const err = `Feature worker exited (${code}).`;
      this.lastError = err;
      for (const pending of this.pending.values()) {
        pending.resolve({ status: "error", message: err });
      }
      this.pending.clear();
      this.child = null;
      this.rl = null;
    });
  }

  stop() {
    if (!this.child) return;
    this.child.kill("SIGKILL");
  }

  async request(kind, payload, timeoutMs = 10 * 60 * 1000) {
    this.start();
    if (!this.child || !this.child.stdin) {
      return { status: "error", message: "Feature worker unavailable." };
    }

    const id = this.seq++;
    const message = JSON.stringify({ id, kind, payload });

    const response = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ status: "error", message: `Feature worker timeout (${timeoutMs} ms).` });
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        }
      });

      try {
        this.child.stdin.write(message + "\n");
      } catch {
        clearTimeout(timeout);
        this.pending.delete(id);
        resolve({ status: "error", message: "Failed to write to feature worker." });
      }
    });

    return response;
  }

  async health() {
    const res = await this.request("health", {});
    return {
      ...res,
      workerReady: this.ready,
      workerError: this.lastError || ""
    };
  }

  async run(payload) {
    return this.request("run", payload || {});
  }
}

module.exports = {
  FeatureWorker
};
