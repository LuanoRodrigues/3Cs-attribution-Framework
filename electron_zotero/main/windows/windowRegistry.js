class WindowRegistry {
  constructor() {
    this.windows = new Map();
  }

  set(key, win) {
    this.windows.set(String(key), win);
    win.on("closed", () => {
      this.windows.delete(String(key));
    });
  }

  get(key) {
    return this.windows.get(String(key)) || null;
  }

  values() {
    return Array.from(this.windows.values()).filter(Boolean);
  }
}

module.exports = {
  WindowRegistry
};
