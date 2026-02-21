const { BrowserWindow } = require("electron");
const path = require("path");

function createReaderWindow({ parent, url, itemKey, page = 1 }) {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    parent,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    title: `Reader ${itemKey ? `- ${itemKey}` : ""}`
  });

  const target = encodeURIComponent(String(url || ""));
  const key = encodeURIComponent(String(itemKey || ""));
  const p = encodeURIComponent(String(page || 1));
  const filePath = path.join(__dirname, "..", "..", "renderer", "reader.html");
  win.loadFile(filePath, { query: { url: target, itemKey: key, page: p } });
  return win;
}

module.exports = {
  createReaderWindow
};
