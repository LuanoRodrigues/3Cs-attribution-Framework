type PerfOverlayState = {
  longTasks: number;
  lastLongTaskMs: number;
  fps: number;
};

export function initPerfOverlay(): void {
  const enabled =
    window.location.hash.includes("perf") ||
    window.localStorage.getItem("perf.overlay") === "1";
  if (!enabled) return;

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.right = "10px";
  overlay.style.bottom = "10px";
  overlay.style.zIndex = "9999";
  overlay.style.background = "rgba(10, 12, 18, 0.85)";
  overlay.style.color = "#f2f4f8";
  overlay.style.border = "1px solid rgba(255,255,255,0.12)";
  overlay.style.borderRadius = "8px";
  overlay.style.padding = "8px 10px";
  overlay.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  overlay.style.fontSize = "12px";
  overlay.style.minWidth = "160px";
  overlay.style.pointerEvents = "none";

  const state: PerfOverlayState = { longTasks: 0, lastLongTaskMs: 0, fps: 0 };

  const render = () => {
    overlay.textContent =
      `FPS: ${state.fps.toFixed(0)}\n` +
      `Long tasks: ${state.longTasks}\n` +
      `Last long task: ${state.lastLongTaskMs.toFixed(0)}ms`;
  };

  render();
  document.body.appendChild(overlay);

  let frames = 0;
  let last = performance.now();
  const tick = () => {
    frames += 1;
    const now = performance.now();
    const delta = now - last;
    if (delta >= 1000) {
      state.fps = (frames * 1000) / delta;
      frames = 0;
      last = now;
      render();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks += 1;
          state.lastLongTaskMs = entry.duration;
        }
        render();
      });
      observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    } catch {
      // ignore if longtask not supported
    }
  }
}
