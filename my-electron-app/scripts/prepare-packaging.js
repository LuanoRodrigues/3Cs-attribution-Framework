const fs = require("fs");
const os = require("os");
const path = require("path");

if (process.platform !== "win32") {
  console.log(`prepare-packaging is Windows-only; skipping setup on ${process.platform}`);
  process.exit(0);
}

// Mirror Electron's Windows `userData` location when packaging outside the app.
const windowsLocalAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const userDataBase = path.join(windowsLocalAppData, "Annotarium");
const configDir = path.join(userDataBase, "config");
const exportDir = path.join(configDir, "exports");

[configDir, exportDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

console.log("Packaging paths prepared:");
console.log(`  userData: ${userDataBase}`);
console.log(`  configDir: ${configDir}`);
console.log(`  exportDir: ${exportDir}`);
console.log(`  app.asar writes avoided (only user data directories were touched).`);
