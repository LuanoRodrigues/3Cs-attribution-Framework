const fs = require("fs");
const path = require("path");

const {
  initializeSettingsFacade,
  setSetting,
  getSetting
} = require("../dist/config/settingsFacade");
const { SecretsVault } = require("../dist/config/secretsVault");
const { exportConfigBundle, importConfigBundle } = require("../dist/config/bundle");

async function run() {
  const sandbox = path.join(__dirname, "..", ".cache", "bundle-roundtrip");
  const bundlePath = path.join(__dirname, "..", ".cache", "settings-bundle.zip");
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(bundlePath, { force: true });

  initializeSettingsFacade(sandbox);
  setSetting("General/last_project_path", "C:/projects/foo");
  setSetting("APIs/llm_provider", "openai");

  const secrets = new SecretsVault(sandbox);
  await secrets.unlockSecrets("bundle-pass");
  await secrets.setSecret("zotero_api_key", "bundle-secret");

  await exportConfigBundle(bundlePath, true);

  fs.rmSync(sandbox, { recursive: true, force: true });

  initializeSettingsFacade(sandbox);
  await importConfigBundle(bundlePath);

  if (getSetting("General/last_project_path") !== "C:/projects/foo") {
    throw new Error("Restored general settings are wrong");
  }

  const reopened = new SecretsVault(sandbox);
  await reopened.unlockSecrets("bundle-pass");
  if (reopened.getSecret("zotero_api_key") !== "bundle-secret") {
    throw new Error("Restored secret mismatch");
  }

  console.log("Bundle import/export validation passed");
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(bundlePath, { force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
