import type { CoderState } from "../panels/coder/coderTypes";

export interface CoderBridgePayload {
  scopeId?: string;
  nodeId: string;
  data: Record<string, unknown>;
}

export interface CoderBridgeStateRequest {
  scopeId?: string;
}

export interface CoderBridgeStateResult {
  state: CoderState | null;
  baseDir: string;
  statePath: string;
}

export interface CoderBridgeStateSaveRequest {
  scopeId?: string;
  state: CoderState;
}

export interface CoderBridgeStateSaveResult {
  baseDir: string;
  statePath: string;
}

export interface CoderBridge {
  savePayload(payload: CoderBridgePayload): Promise<{ baseDir: string; nodeId: string }>;
  loadState(payload: CoderBridgeStateRequest): Promise<CoderBridgeStateResult | null>;
  saveState(payload: CoderBridgeStateSaveRequest): Promise<CoderBridgeStateSaveResult | null>;
}

declare global {
  interface Window {
    coderBridge?: CoderBridge;
  }
}
