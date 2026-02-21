const fs = require("fs");
const path = require("path");

const DB_FILE = "zotero_local_db.json";

function dbPath(app) {
  return path.join(app.getPath("userData"), DB_FILE);
}

function defaultDb() {
  return {
    version: 1,
    savedSearches: [],
    sync: {
      lastRunAt: 0,
      state: "idle",
      lastError: ""
    },
    oplog: []
  };
}

function ensureDb(app) {
  const file = dbPath(app);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultDb(), null, 2), "utf-8");
  }
}

function readDb(app) {
  ensureDb(app);
  const file = dbPath(app);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return defaultDb();
  }
}

function writeDb(app, payload) {
  const file = dbPath(app);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
}

function listSavedSearches(app) {
  return readDb(app).savedSearches || [];
}

function upsertSavedSearch(app, row) {
  const db = readDb(app);
  const id = String(row?.id || `ss_${Date.now()}`);
  const next = {
    id,
    name: String(row?.name || "Unnamed search"),
    query: row?.query || {},
    updatedAt: Date.now(),
    createdAt: Number(row?.createdAt || Date.now())
  };
  const idx = db.savedSearches.findIndex((x) => String(x.id) === id);
  if (idx >= 0) db.savedSearches[idx] = next;
  else db.savedSearches.push(next);
  db.oplog.push({ ts: Date.now(), type: "saved_search_upsert", id });
  writeDb(app, db);
  return next;
}

function deleteSavedSearch(app, id) {
  const db = readDb(app);
  const before = db.savedSearches.length;
  db.savedSearches = db.savedSearches.filter((x) => String(x.id) !== String(id));
  db.oplog.push({ ts: Date.now(), type: "saved_search_delete", id: String(id) });
  writeDb(app, db);
  return before !== db.savedSearches.length;
}

function updateSyncState(app, patch) {
  const db = readDb(app);
  db.sync = {
    ...db.sync,
    ...patch
  };
  writeDb(app, db);
  return db.sync;
}

function getSyncState(app) {
  return readDb(app).sync || defaultDb().sync;
}

module.exports = {
  ensureDb,
  listSavedSearches,
  upsertSavedSearch,
  deleteSavedSearch,
  updateSyncState,
  getSyncState
};
