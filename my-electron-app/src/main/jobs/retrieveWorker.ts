import { parentPort, workerData } from "worker_threads";
import { executeRetrieveSearch } from "../ipc/retrieve_ipc";
import type { RetrieveQuery } from "../../shared/types/retrieve";
import { initializeSettingsFacade } from "../../config/settingsFacade";

try {
  const userDataPath = (workerData as any)?.userDataPath;
  if (typeof userDataPath === "string" && userDataPath.trim()) {
    initializeSettingsFacade(userDataPath);
  }
} catch {
  // best-effort; retrieve may still work with defaults
}

type WorkerRequest = { id: string; method: string; args: unknown[] };
type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

async function handle(method: string, args: unknown[]): Promise<unknown> {
  if (method === "retrieve:search") {
    return executeRetrieveSearch(args[0] as RetrieveQuery);
  }
  throw new Error(`Unknown method: ${method}`);
}

parentPort?.on("message", async (message: WorkerRequest) => {
  if (!message || typeof message !== "object") return;
  const id = message.id;
  try {
    const result = await handle(message.method, Array.isArray(message.args) ? message.args : []);
    const response: WorkerResponse = { id, ok: true, result };
    parentPort?.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    parentPort?.postMessage(response);
  }
});
