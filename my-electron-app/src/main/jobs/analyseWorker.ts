import { parentPort, workerData } from "worker_threads";
import {
  buildDatasetHandles,
  discoverRuns,
  getDefaultBaseDir,
  loadBatches,
  loadDirectQuoteLookup,
  loadSectionsPage,
  loadSections,
  querySections,
  loadBatchPayloadsPage,
  getDirectQuoteEntries,
  summariseRun
} from "../../analyse/backend";
import type { SectionLevel } from "../../analyse/types";
import { initializeSettingsFacade } from "../../config/settingsFacade";

try {
  const userDataPath = (workerData as any)?.userDataPath;
  if (typeof userDataPath === "string" && userDataPath.trim()) {
    initializeSettingsFacade(userDataPath);
  }
} catch {
  // best-effort; analyse falls back to defaults if settings cannot load
}

type WorkerRequest = { id: string; method: string; args: unknown[] };
type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

async function handle(method: string, args: unknown[]): Promise<unknown> {
  if (method === "analyse:getDefaultBaseDir") {
    return getDefaultBaseDir();
  }
  if (method === "analyse:discoverRuns") {
    return discoverRuns(args[0] as string | undefined);
  }
  if (method === "analyse:buildDatasets") {
    return buildDatasetHandles(String(args[0] ?? ""));
  }
  if (method === "analyse:loadBatches") {
    return loadBatches(String(args[0] ?? ""));
  }
  if (method === "analyse:loadSections") {
    return loadSections(String(args[0] ?? ""), args[1] as SectionLevel);
  }
  if (method === "analyse:loadSectionsPage") {
    return loadSectionsPage(String(args[0] ?? ""), args[1] as SectionLevel, Number(args[2] ?? 0), Number(args[3] ?? 10));
  }
  if (method === "analyse:querySections") {
    return querySections(String(args[0] ?? ""), args[1] as SectionLevel, (args[2] || {}) as any, Number(args[3] ?? 0), Number(args[4] ?? 10));
  }
  if (method === "analyse:loadBatchPayloadsPage") {
    return loadBatchPayloadsPage(String(args[0] ?? ""), Number(args[1] ?? 0), Number(args[2] ?? 10));
  }
  if (method === "analyse:getDirectQuotes") {
    return getDirectQuoteEntries(String(args[0] ?? ""), (args[1] as string[]) || []);
  }
  if (method === "analyse:loadDqLookup") {
    return loadDirectQuoteLookup(String(args[0] ?? ""));
  }
  if (method === "analyse:summariseRun") {
    return summariseRun(String(args[0] ?? ""));
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
