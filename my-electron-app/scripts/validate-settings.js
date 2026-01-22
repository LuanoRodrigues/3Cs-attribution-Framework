const fs = require("fs");
const path = require("path");

const {
  initializeSettingsFacade,
  setSetting,
  getSetting,
  exportAllSettings,
  getSettingsFilePath
} = require("../dist/config/settingsFacade");

async function run() {
  const sandbox = path.join(__dirname, "..", ".cache", "settings-validation");
  fs.rmSync(sandbox, { recursive: true, force: true });

  initializeSettingsFacade(sandbox);
  setSetting("General/last_project_path", "C:/projects/sample");
  setSetting("APIs/llm_provider", "openai");

  if (getSetting("General/last_project_path") !== "C:/projects/sample") {
    throw new Error("Stored general setting mismatch");
  }

  const snapshot = exportAllSettings();
  if (snapshot["APIs/llm_provider"] !== "openai") {
    throw new Error("Snapshot did not include persisted API provider");
  }

  const storagePath = getSettingsFilePath();
  if (!fs.existsSync(storagePath)) {
    throw new Error("Settings file missing after save");
  }

  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log("Settings persistence validation passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
