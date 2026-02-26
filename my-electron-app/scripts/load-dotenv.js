const fs = require("fs");
const path = require("path");

(function loadLocalEnv() {
  const candidates = [
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", "..", ".env")
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    const raw = fs.readFileSync(candidate, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key) continue;
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key.toLowerCase() === "export") {
        const maybePair = value.split("=", 2);
        if (maybePair.length !== 2) continue;
        const exportKey = maybePair[0].trim();
        const exportValue = maybePair[1].trim();
        if (exportKey && process.env[exportKey] === undefined) {
          process.env[exportKey] = exportValue.replace(/^['"]|['"]$/g, "");
        }
        continue;
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    break;
  }
})();
