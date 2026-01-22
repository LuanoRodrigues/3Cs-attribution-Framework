import type { AnalyseAction } from "./types";

export async function dispatchAnalyseCommand(
  phase: string,
  action: AnalyseAction,
  payload?: Record<string, unknown>
): Promise<void> {
  const envelope = { phase, action, payload };
  console.info(`command received phase=${phase} action=${action}`, payload ?? "");
  if (window.commandBridge?.dispatch) {
    await window.commandBridge.dispatch(envelope);
    return;
  }
  if (window.analyseBridge?.dispatch) {
    await window.analyseBridge.dispatch(envelope);
  }
}
