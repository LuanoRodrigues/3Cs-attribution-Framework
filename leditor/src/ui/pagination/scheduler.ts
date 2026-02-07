export type PaginationSchedulerOptions = {
  root: HTMLElement;
  onRun: () => void;
  onSettled?: () => void;
  throttleMs?: number;
  settleMs?: number;
};

export class PaginationScheduler {
  private scheduled = false;
  private pending = false;
  private composing = false;
  private rafId = 0;
  private throttleTimer = 0;
  private settleTimer = 0;
  private lastRunAt = 0;

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
    if (this.settleTimer) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = 0;
    }
    const throttleMs = typeof this.options.throttleMs === "number" ? this.options.throttleMs : 0;
    if (throttleMs > 0) {
      const now = performance.now();
      const elapsed = now - this.lastRunAt;
      if (elapsed < throttleMs) {
        if (!this.throttleTimer) {
          const delay = Math.max(0, throttleMs - elapsed);
          this.throttleTimer = window.setTimeout(() => {
            this.throttleTimer = 0;
            this.request();
          }, delay);
        }
        return;
      }
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
      this.lastRunAt = performance.now();
      this.options.onRun();
      this.scheduleSettled();
    });
  }

  dispose(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.throttleTimer) {
      window.clearTimeout(this.throttleTimer);
      this.throttleTimer = 0;
    }
    if (this.settleTimer) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = 0;
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

  private scheduleSettled = () => {
    if (!this.options.onSettled) return;
    if (this.settleTimer) {
      window.clearTimeout(this.settleTimer);
    }
    const settleMs = typeof this.options.settleMs === "number" ? this.options.settleMs : 160;
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = 0;
      if (this.scheduled || this.pending || this.composing) return;
      this.options.onSettled?.();
    }, Math.max(0, settleMs));
  };
}
