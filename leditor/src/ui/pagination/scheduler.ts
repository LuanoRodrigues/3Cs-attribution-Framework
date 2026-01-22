export type PaginationSchedulerOptions = {
  root: HTMLElement;
  onRun: () => void;
};

export class PaginationScheduler {
  private scheduled = false;
  private pending = false;
  private composing = false;
  private rafId = 0;

  constructor(private options: PaginationSchedulerOptions) {
    if (!options.root) {
      throw new Error("PaginationScheduler requires a root element.");
    }
    if (!options.onRun) {
      throw new Error("PaginationScheduler requires a run callback.");
    }
    this.options.root.addEventListener("compositionstart", this.handleCompositionStart);
    this.options.root.addEventListener("compositionend", this.handleCompositionEnd);
    this.options.root.addEventListener("compositionupdate", this.handleCompositionUpdate);
  }

  request(): void {
    if (this.composing) {
      this.pending = true;
      return;
    }
    if (this.scheduled) {
      this.pending = true;
      return;
    }
    this.scheduled = true;
    this.rafId = window.requestAnimationFrame(() => {
      this.scheduled = false;
      if (this.composing) {
        this.pending = true;
        return;
      }
      if (this.pending) {
        this.pending = false;
      }
      this.options.onRun();
    });
  }

  dispose(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.options.root.removeEventListener("compositionstart", this.handleCompositionStart);
    this.options.root.removeEventListener("compositionend", this.handleCompositionEnd);
    this.options.root.removeEventListener("compositionupdate", this.handleCompositionUpdate);
  }

  private handleCompositionStart = () => {
    this.composing = true;
  };

  private handleCompositionEnd = () => {
    this.composing = false;
    if (this.pending) {
      this.pending = false;
      this.request();
    }
  };

  private handleCompositionUpdate = () => {
    this.composing = true;
  };
}
