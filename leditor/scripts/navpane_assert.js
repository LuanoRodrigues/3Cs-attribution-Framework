/**
 * Nav pane automated assertions.
 *
 * Usage in DevTools (renderer):
 *   await import("./scripts/navpane_assert.js");
 *   await window.navPaneAssert.run();
 */
(function () {
  if (window.navPaneAssert) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (msg, data) => console.info(`[nav-assert] ${msg}`, data ?? "");

  const getTwisties = () => Array.from(document.querySelectorAll(".leditor-navigation-twisty")).filter((b) => !b.disabled);
  const isCollapsed = (entryId) => {
    const entry = document.querySelector(`.leditor-navigation-entry[data-id="${CSS.escape(entryId)}"]`);
    if (!entry) return null;
    const group = entry.parentElement?.nextElementSibling;
    return !(group && group.classList.contains("leditor-navigation-group") && group.childElementCount > 0);
  };

  const clickTwisty = async (idx) => {
    const t = getTwisties()[idx];
    if (!t) throw new Error(`No twisty at index ${idx}`);
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, button: 0 });
    t.dispatchEvent(ev);
    await wait(80);
    return t.parentElement?.querySelector(".leditor-navigation-entry")?.dataset.id ?? null;
  };

  const clickHeading = async (id) => {
    const btn = document.querySelector(`.leditor-navigation-entry[data-id="${CSS.escape(id)}"]`);
    if (!btn) throw new Error(`Heading not found: ${id}`);
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, button: 0 });
    btn.dispatchEvent(ev);
    await wait(80);
    return true;
  };

  const run = async () => {
    log("start");
    const twisties = getTwisties();
    if (!twisties.length) throw new Error("No twisties found");
    const id = await clickTwisty(0);
    if (!id) throw new Error("Could not resolve entry id for twisty 0");
    const before = isCollapsed(id);
    await wait(80);
    await clickTwisty(0);
    const after = isCollapsed(id);
    if (before === after) throw new Error(`Toggle failed for ${id}`);
    log("twisty toggle ok", { id, before, after });
    const headings = Array.from(document.querySelectorAll(".leditor-navigation-entry")).slice(0, 1);
    if (!headings.length) throw new Error("No headings found");
    await clickHeading(headings[0].dataset.id);
    log("heading click ok", { id: headings[0].dataset.id });
    log("done");
  };

  window.navPaneAssert = { run, clickTwisty, clickHeading, isCollapsed };
})();
