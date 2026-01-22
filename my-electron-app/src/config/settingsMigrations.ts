export const SETTINGS_VERSION_KEY = "Settings/version";
export const CURRENT_SETTINGS_VERSION = 1;

type Migration = (snapshot: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  1: (snapshot) => {
    const updated = { ...snapshot };
    if (updated["General/author_contact"] === undefined) {
      updated["General/author_contact"] = "";
    }
    return updated;
  }
};

export function applyMigrations(snapshot: Record<string, unknown>): Record<string, unknown> {
  const rawVersionValue = snapshot[SETTINGS_VERSION_KEY];
  const currentVersion = typeof rawVersionValue === "number" ? rawVersionValue : 0;
  let next = { ...snapshot };
  for (let target = currentVersion + 1; target <= CURRENT_SETTINGS_VERSION; target++) {
    const migration = MIGRATIONS[target];
    if (migration) {
      next = migration(next);
    }
  }
  next[SETTINGS_VERSION_KEY] = CURRENT_SETTINGS_VERSION;
  return next;
}
