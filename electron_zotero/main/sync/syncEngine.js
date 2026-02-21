const { EventEmitter } = require("events");

class SyncEngine extends EventEmitter {
  constructor({ app, db }) {
    super();
    this.app = app;
    this.db = db;
    this.running = false;
  }

  status() {
    return this.db.getSyncState(this.app);
  }

  async runNow() {
    if (this.running) {
      return { status: "ok", sync: this.status(), deduped: true };
    }
    this.running = true;

    const setState = (patch) => {
      const next = this.db.updateSyncState(this.app, patch);
      this.emit("status", next);
      return next;
    };

    try {
      setState({ state: "preparing", lastError: "" });
      await wait(150);
      setState({ state: "downloading" });
      await wait(180);
      setState({ state: "uploading" });
      await wait(180);
      const done = setState({ state: "completed", lastRunAt: Date.now() });
      return { status: "ok", sync: done };
    } catch (error) {
      const failed = setState({ state: "failed", lastError: error.message || "Unknown sync error" });
      return { status: "error", message: error.message || "Sync failed", sync: failed };
    } finally {
      this.running = false;
      setTimeout(() => {
        const current = this.db.getSyncState(this.app);
        if (current.state === "completed") {
          const idle = this.db.updateSyncState(this.app, { state: "idle" });
          this.emit("status", idle);
        }
      }, 800);
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  SyncEngine
};
