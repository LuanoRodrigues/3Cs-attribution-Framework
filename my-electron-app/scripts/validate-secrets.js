const fs = require("fs");
const path = require("path");

const { SecretsVault } = require("../dist/config/secretsVault");

async function run() {
  const sandbox = path.join(__dirname, "..", ".cache", "secrets-validation");
  fs.rmSync(sandbox, { recursive: true, force: true });

  const vault = new SecretsVault(sandbox);
  try {
    vault.getSecret("test");
    throw new Error("Should not read secrets while locked");
  } catch (err) {
    if (err.message.indexOf("locked") === -1) {
      throw err;
    }
  }

  await vault.unlockSecrets("vault-pass");
  await vault.setSecret("openai_api_key", "secret-value");

  const reopened = new SecretsVault(sandbox);
  await reopened.unlockSecrets("vault-pass");
  if (reopened.getSecret("openai_api_key") !== "secret-value") {
    throw new Error("Secret did not survive unlock");
  }

  console.log("Secrets vault validation passed");
  fs.rmSync(sandbox, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
