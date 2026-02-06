import type { CoderState } from "../panels/coder/coderTypes";

export interface CoderBridgePayload {
  scopeId?: string;
  nodeId: string;
  data: Record<string, unknown>;
  projectPath?: string;
  statePath?: string;
}

export interface CoderBridgeStateRequest {
  scopeId?: string;
  projectPath?: string;
  statePath?: string;
  name?: string;
}

export interface CoderBridgeStateResult {
  state: CoderState | null;
  baseDir: string;
  statePath: string;
  metaTitle?: string;
}

export interface CoderBridgeStateSaveRequest {
  scopeId?: string;
  state: CoderState;
  projectPath?: string;
  statePath?: string;
  name?: string;
}

export interface CoderBridgeStateSaveResult {
  baseDir: string;
  statePath: string;
}

export interface CoderBridgeStateListRequest {
  scopeId?: string;
  projectPath?: string;
}

export interface CoderBridgeStateListResult {
  baseDir: string;
  files: Array<{ name: string; fileName: string; path: string; updatedUtc: string }>;
}

export interface CoderBridgeStatePathRequest {
  scopeId?: string;
  projectPath?: string;
  name?: string;
}

export interface CoderBridgeStatePathResult {
  baseDir: string;
  statePath: string;
}

export interface CoderBridgePickSaveRequest {
  scopeId?: string;
  projectPath?: string;
  statePath?: string;
  name?: string;
}

export interface CoderBridgePickSaveResult {
  baseDir: string;
  statePath: string;
}

export interface CoderBridge {
  savePayload(payload: CoderBridgePayload): Promise<{ baseDir: string; nodeId: string }>;
  loadState(payload: CoderBridgeStateRequest): Promise<CoderBridgeStateResult | null>;
  saveState(payload: CoderBridgeStateSaveRequest): Promise<CoderBridgeStateSaveResult | null>;
  pickSavePath(payload: CoderBridgePickSaveRequest): Promise<CoderBridgePickSaveResult | null>;
  listStates(payload: CoderBridgeStateListRequest): Promise<CoderBridgeStateListResult>;
  resolveStatePath(payload: CoderBridgeStatePathRequest): Promise<CoderBridgeStatePathResult>;
}

declare global {
  interface Window {
    coderBridge?: CoderBridge;
  }
}
