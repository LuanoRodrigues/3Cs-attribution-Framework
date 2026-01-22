import { ToolDefinition, ToolHandle } from "../registry/toolRegistry";

export interface ToolPanelConfig {
  id: string;
  toolType: string;
  title: string;
  metadata?: Record<string, unknown>;
  definition: ToolDefinition;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
}

export class ToolPanel {
  readonly id: string;
  readonly toolType: string;
  private metadata?: Record<string, unknown>;
  private definition: ToolDefinition;
  private handle: ToolHandle;
  readonly wrapper: HTMLElement;
  readonly body: HTMLElement;

  constructor(config: ToolPanelConfig) {
    this.id = config.id;
    this.toolType = config.toolType;
    this.metadata = config.metadata;
    this.definition = config.definition;

    this.body = document.createElement("div");
    this.body.className = "tool-surface";

    this.handle = this.definition.create({
      metadata: this.metadata,
      onUpdate: (meta) => {
        this.metadata = meta;
      }
    });

    this.wrapper = document.createElement("div");
    this.wrapper.className = "tab-body";
    this.wrapper.appendChild(this.handle.element);
    this.wrapper.addEventListener("mousedown", () => config.onFocus(this.id));
  }

  getMetadata(): Record<string, unknown> | undefined {
    if (this.handle.getMetadata) {
      return this.handle.getMetadata();
    }
    return this.metadata;
  }

  focus(): void {
    if (this.handle.focus) {
      this.handle.focus();
    }
  }

  destroy(): void {
    if (this.handle.destroy) {
      this.handle.destroy();
    }
  }
}
