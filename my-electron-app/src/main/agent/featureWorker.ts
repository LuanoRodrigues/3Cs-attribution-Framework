import path from "path";
import fs from "fs";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import readline from "readline";

type PendingEntry = { resolve: (value: any) => void };

const findScriptPath = (scriptName: string): string => {
  const candidates = [
    path.join(__dirname, "py", scriptName),
    path.join(process.cwd(), "my-electron-app", "src", "main", "py", scriptName),
    path.join(process.cwd(), "src", "main", "py", scriptName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
};

export class FeatureWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private seq = 1;
  private pending = new Map<number, PendingEntry>();
  private ready = false;
  private lastError = "";

  start(): void {
    if (this.child && !this.child.killed) return;
    const pythonCmd = process.env.PYTHON_BIN || "python3";
    const scriptPath = findScriptPath("run_zotero_feature_worker.py");
    this.child = spawn(pythonCmd, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.ready = true;

    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      let msg: any = null;
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

  async request(kind: "health" | "run", payload: Record<string, unknown>, timeoutMs = 10 * 60 * 1000): Promise<any> {
    this.start();
    if (!this.child || !this.child.stdin) {
      return { status: "error", message: "Feature worker unavailable." };
    }
    const id = this.seq++;
    const message = JSON.stringify({ id, kind, payload });
    return await new Promise((resolve) => {
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
        this.child!.stdin.write(message + "\n");
      } catch {
        clearTimeout(timeout);
        this.pending.delete(id);
        resolve({ status: "error", message: "Failed to write to feature worker." });
      }
    });
  }

  async health(): Promise<any> {
    const res = await this.request("health", {});
    return {
      ...res,
      workerReady: this.ready,
      workerError: this.lastError || ""
    };
  }

  async run(payload: Record<string, unknown>): Promise<any> {
    return await this.request("run", payload || {});
  }
}
