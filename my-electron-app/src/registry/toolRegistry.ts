export interface ToolHandle {
  element: HTMLElement;
  focus?: () => void;
  destroy?: () => void;
  getMetadata?: () => Record<string, unknown> | undefined;
}

export interface ToolCreateContext {
  metadata?: Record<string, unknown>;
  onUpdate?: (metadata: Record<string, unknown>) => void;
}

export interface ToolDefinition {
  type: string;
  title: string;
  icon?: string;
  create: (ctx: ToolCreateContext) => ToolHandle;
}

export class ToolRegistry {
  private definitions = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  get(toolType: string): ToolDefinition | undefined {
    return this.definitions.get(toolType);
  }

  list(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }
}
