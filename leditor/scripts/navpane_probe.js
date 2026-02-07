/**
 * Navigation Pane click probe for LEditor renderer.
 *
 * Usage (DevTools console inside the running renderer):
 *   await import("./scripts/navpane_probe.js");
 *   window.navPaneProbe.attach();
 *   // Now click chevrons/headings and watch the console sequence.
 *   // To simulate a chevron click programmatically:
 *   window.navPaneProbe.simulateTwistyClick(0);
 *   // When done:
 *   window.navPaneProbe.detach();
 */
(function () {
  if (window.navPaneProbe) return;

  const ns = {
    attached: false,
    listeners: [],
    log(msg, extra) {
      const t = (performance.now() / 1000).toFixed(3);
      console.info(`[nav-probe ${t}] ${msg}`, extra ?? "");
    },
    attach() {
      if (this.attached) {
        this.log("already attached");
        return;
      }
      const panel = document.getElementById("leditor-navigation-panel");
      if (!panel) {
        this.log("panel not found");
        return;
      }
      const tree = panel.querySelector(".leditor-navigation-tree");
      const targets = [panel, tree].filter(Boolean);
      const events = ["pointerdown", "pointerup", "click"];
      targets.forEach((el) => {
        events.forEach((evName) => {
          const fn = (ev) => {
            const target = ev.target;
            this.log(evName, {
              tag: target?.tagName,
              className: (target?.getAttribute?.("class") || "").slice(0, 120),
              type: target?.dataset?.hasChildren ? "entry" : target?.classList?.contains("leditor-navigation-twisty") ? "twisty" : "other",
              id: target?.dataset?.id || target?.closest?.(".leditor-navigation-entry")?.dataset?.id || null,
              button: ev.button
            });
          };
          el.addEventListener(evName, fn, true);
          this.listeners.push({ el, evName, fn });
        });
      });
      this.attached = true;
      this.log("attached");
    },
    detach() {
      this.listeners.forEach(({ el, evName, fn }) => el.removeEventListener(evName, fn, true));
      this.listeners = [];
      this.attached = false;
      this.log("detached");
    },
    simulateTwistyClick(index = 0, delay = 30) {
      const twisties = Array.from(document.querySelectorAll(".leditor-navigation-twisty")).filter((b) => !b.disabled);
      const btn = twisties[index];
      if (!btn) {
        this.log("simulateTwistyClick: no twisty at index", index);
        return;
      }
      const fire = (type) => {
        const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 });
        btn.dispatchEvent(ev);
      };
      fire("pointerdown");
      setTimeout(() => {
        fire("pointerup");
        setTimeout(() => fire("click"), delay);
      }, delay);
      this.log("simulateTwistyClick", { index, id: btn.parentElement?.querySelector(".leditor-navigation-entry")?.dataset?.id });
    }
  };

  window.navPaneProbe = ns;
})();
