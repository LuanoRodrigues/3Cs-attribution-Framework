import type { RibbonCommand } from "../types";
import type { RetrieveProviderId, RetrieveQuery, RetrieveRecord } from "../shared/types/retrieve";

export interface RibbonCommandResponse {
  status: string;
  nav?: string;
  message?: string;
  provider?: RetrieveProviderId;
  items?: RetrieveRecord[];
  total?: number;
  nextCursor?: string | number | null;
  payload?: unknown;
}

type CommandPayload = Record<string, unknown> | RetrieveQuery;

const sanitizePayload = (payload?: CommandPayload): CommandPayload | undefined => {
  if (payload && Object.keys(payload).length === 0) {
    return undefined;
  }
  return payload;
};

export async function command(
  phase: string,
  action: string,
  payload?: CommandPayload
): Promise<RibbonCommandResponse | undefined> {
  document.dispatchEvent(new CustomEvent("ribbon:action", { detail: { phase } }));
  const envelope: RibbonCommand = {
    phase,
    action,
    payload: sanitizePayload(payload)
  };
  console.info(`command emitted phase=${phase} action=${action}`, envelope.payload ?? "(no payload)");
  if (phase === "project" && action === "export_project") {
    const projectPath = window.currentProjectPath;
    if (!projectPath) {
      return { status: "missing_project", message: "Open a project before exporting." };
    }
    if (!window.projectBridge) {
      return { status: "missing_bridge", message: "Unable to contact the project bridge." };
    }
    const result = await window.projectBridge.exportProject({ projectPath });
    return { status: "ok", message: result?.path ? `Exported to ${result.path}` : "Project exported." };
  }
  if (window.commandBridge?.dispatch) {
    const response = await window.commandBridge.dispatch(envelope);
    return response as RibbonCommandResponse;
  }
  console.warn("commandBridge unavailable, falling back to console only", envelope);
  return { status: "logged-stub" };
}
