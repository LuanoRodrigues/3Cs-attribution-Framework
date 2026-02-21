const { globalShortcut, BrowserWindow } = require("electron");

function sendCommand(commandId) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  win.webContents.send("app:menu-command", { commandId });
}

function registerShortcuts() {
  const map = [
    ["CommandOrControl+Shift+F", "advanced-search"],
    ["CommandOrControl+Shift+S", "sync-now"],
    ["CommandOrControl+Shift+O", "open-reader"]
  ];

  map.forEach(([accel, commandId]) => {
    globalShortcut.register(accel, () => sendCommand(commandId));
  });
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = {
  registerShortcuts,
  unregisterShortcuts
};
