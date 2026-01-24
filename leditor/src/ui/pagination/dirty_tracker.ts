export type DirtyTrackerOptions = {
  root: HTMLElement;
  blockSelectors: string[];
};

export class DirtyTracker {
  private observer: MutationObserver;
  private dirtyBlock: HTMLElement | null = null;

  constructor(private options: DirtyTrackerOptions) {
    if (!options.root) {
      throw new Error("DirtyTracker requires a root element.");
    }
    if (!options.blockSelectors || options.blockSelectors.length === 0) {
      throw new Error("DirtyTracker requires block selectors.");
    }
    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
  }

  start(): void {
    this.observer.observe(this.options.root, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  stop(): void {
    this.observer.disconnect();
  }

  consumeDirtyBlock(): HTMLElement | null {
    const block = this.dirtyBlock;
    this.dirtyBlock = null;
    return block;
  }

  private handleMutations(mutations: MutationRecord[]): void {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") {
        this.markDirtyFromNode(mutation.target);
        return;
      }
      if (mutation.type === "childList") {
        this.markDirtyFromNode(mutation.target);
        mutation.addedNodes.forEach((node) => this.markDirtyFromNode(node));
        mutation.removedNodes.forEach((node) => this.markDirtyFromNode(node));
      }
    });
  }

  private markDirtyFromNode(node: Node): void {
    if (!(node instanceof HTMLElement)) {
      const parent = node.parentElement;
      if (parent) {
        this.markDirtyFromElement(parent);
      }
      return;
    }
    this.markDirtyFromElement(node);
  }

  private markDirtyFromElement(element: HTMLElement): void {
    const block = this.findBlockAncestor(element);
    if (!block) return;
    if (!this.dirtyBlock) {
      this.dirtyBlock = block;
      return;
    }
    if (block === this.dirtyBlock) return;
    const position = block.compareDocumentPosition(this.dirtyBlock);
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      this.dirtyBlock = block;
    }
  }

  private findBlockAncestor(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current) {
      const candidate = current;
      if (this.options.blockSelectors.some((selector) => candidate.matches(selector))) {
        return candidate;
      }
      current = current.parentElement;
    }
    return null;
  }
}
