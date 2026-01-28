import { Worker } from "worker_threads";

type WorkerRequest = {
  id: string;
  method: string;
  args: unknown[];
};

type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<string, Pending>();
  private nextWorker = 0;
  private seq = 0;

  constructor(workerScriptPath: string, options?: { size?: number; workerData?: unknown }) {
    const size = Math.max(1, Math.floor(options?.size ?? 1));
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(workerScriptPath, { workerData: options?.workerData });
      worker.on("message", (message: WorkerResponse) => {
        if (!message || typeof message !== "object") return;
        const id = (message as WorkerResponse).id;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (message.ok) {
          entry.resolve(message.result);
        } else {
          entry.reject(new Error(message.error || "worker error"));
        }
      });
      worker.on("error", (error) => {
        // Reject any pending requests if a worker crashes.
        const snapshot = Array.from(this.pending.entries());
        snapshot.forEach(([id, entry]) => {
          this.pending.delete(id);
          entry.reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
      worker.on("exit", (code) => {
        const snapshot = Array.from(this.pending.entries());
        snapshot.forEach(([id, entry]) => {
          this.pending.delete(id);
          entry.reject(new Error(`worker exited (${code ?? "unknown"})`));
        });
      });
      this.workers.push(worker);
    }
  }

  async run<T>(method: string, args: unknown[]): Promise<T> {
    const id = `w_${Date.now().toString(16)}_${(this.seq++).toString(16)}`;
    const request: WorkerRequest = { id, method, args };
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker += 1;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as any, reject });
      worker.postMessage(request);
    });
  }

  async dispose(): Promise<void> {
    await Promise.all(
      this.workers.map(async (worker) => {
        try {
          await worker.terminate();
        } catch {
          // ignore
        }
      })
    );
    this.workers.length = 0;
    this.pending.clear();
  }
}
