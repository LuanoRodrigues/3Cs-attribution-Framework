const { Menu, BrowserWindow } = require("electron");

function sendMenuCommand(commandId) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  win.webContents.send("app:menu-command", { commandId });
}

function buildAppMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Refresh Tree", accelerator: "CmdOrCtrl+R", click: () => sendMenuCommand("refresh-tree") },
        { label: "Sync Now", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand("sync-now") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Advanced Search", accelerator: "CmdOrCtrl+Shift+F", click: () => sendMenuCommand("advanced-search") },
        { label: "Reset Layout", click: () => sendMenuCommand("layout-reset") },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Tools",
      submenu: [
        { label: "Agent Command", accelerator: "CmdOrCtrl+Shift+A", click: () => sendMenuCommand("agent-command") },
        { type: "separator" },
        { label: "Start Voice Mode", accelerator: "CmdOrCtrl+Alt+V", click: () => sendMenuCommand("voice-mode-start") },
        { label: "Stop Voice Mode", click: () => sendMenuCommand("voice-mode-stop") },
        { label: "Start Dictation", accelerator: "CmdOrCtrl+Alt+D", click: () => sendMenuCommand("dictation-start") },
        { label: "Stop Dictation", click: () => sendMenuCommand("dictation-stop") },
        { type: "separator" },
        { label: "Open Reader", accelerator: "CmdOrCtrl+Shift+O", click: () => sendMenuCommand("open-reader") },
        { label: "Command Palette", accelerator: "CmdOrCtrl+Shift+P", click: () => sendMenuCommand("command-palette") }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }]
    },
    {
      label: "Help",
      submenu: [{ label: "About", click: () => sendMenuCommand("about") }]
    }
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = {
  buildAppMenu
};
