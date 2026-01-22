import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { getAppDataPath } from "../../../config/settingsFacade";
import type { RetrievePaperSnapshot } from "../../../shared/types/retrieve";

let dbInstance: Database | null = null;

const ensureDatabase = (): Database => {
  if (dbInstance) {
    return dbInstance;
  }
  const dbPath = path.join(getAppDataPath(), "retrieve", "tags.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id TEXT NOT NULL UNIQUE,
      doi TEXT,
      url TEXT,
      title TEXT,
      source TEXT,
      year INTEGER
    );
    CREATE TABLE IF NOT EXISTS paper_tags (
      paper_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE (paper_id, tag_id),
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);
  dbInstance = database;
  return database;
};

const ensurePaperRow = (database: Database, paper: RetrievePaperSnapshot): number => {
  if (!paper.paperId) {
    throw new Error("Paper snapshot missing paperId");
  }
  const stmt = database.prepare(`
    INSERT INTO papers (paper_id, doi, url, title, source, year)
    VALUES (@paperId, @doi, @url, @title, @source, @year)
    ON CONFLICT(paper_id) DO UPDATE SET
      doi = excluded.doi,
      url = excluded.url,
      title = excluded.title,
      source = excluded.source,
      year = excluded.year
  `);
  stmt.run({
    paperId: paper.paperId,
    doi: paper.doi ?? null,
    url: paper.url ?? null,
    title: paper.title ?? null,
    source: paper.source ?? null,
    year: paper.year ?? null
  });
  const row = database.prepare<{ id: number }>("SELECT id FROM papers WHERE paper_id = ?").get(paper.paperId);
  return row?.id ?? 0;
};

const getOrCreateTagId = (database: Database, name: string): number => {
  const trimmed = name.trim();
  const insert = database.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  insert.run(trimmed);
  const row = database.prepare<{ id: number }>("SELECT id FROM tags WHERE name = ?").get(trimmed);
  return row?.id ?? 0;
};

const fetchPaperRowId = (database: Database, paperId: string): number | undefined => {
  const row = database.prepare<{ id: number }>("SELECT id FROM papers WHERE paper_id = ?").get(paperId);
  return row?.id;
};

export const listTagsForPaper = (paperId: string): string[] => {
  if (!paperId) {
    return [];
  }
  const database = ensureDatabase();
  const paperRowId = fetchPaperRowId(database, paperId);
  if (!paperRowId) {
    return [];
  }
  const rows = database.prepare<{ name: string }>(`
    SELECT t.name FROM tags t
    JOIN paper_tags pt ON pt.tag_id = t.id
    WHERE pt.paper_id = ?
    ORDER BY t.name COLLATE NOCASE
  `).all(paperRowId);
  return rows.map((row) => row.name);
};

export const addTagToPaper = (paper: RetrievePaperSnapshot, tag: string): string[] => {
  const normalized = tag.trim();
  if (!normalized || !paper.paperId) {
    return listTagsForPaper(paper.paperId);
  }
  const database = ensureDatabase();
  const paperRowId = ensurePaperRow(database, paper);
  const tagId = getOrCreateTagId(database, normalized);
  database.prepare("INSERT OR IGNORE INTO paper_tags (paper_id, tag_id) VALUES (?, ?)").run(paperRowId, tagId);
  return listTagsForPaper(paper.paperId);
};

export const removeTagFromPaper = (paperId: string, tag: string): string[] => {
  const normalized = tag.trim();
  if (!normalized || !paperId) {
    return listTagsForPaper(paperId);
  }
  const database = ensureDatabase();
  const paperRowId = fetchPaperRowId(database, paperId);
  if (!paperRowId) {
    return [];
  }
  const tagRow = database.prepare<{ id: number }>("SELECT id FROM tags WHERE name = ?").get(normalized);
  if (!tagRow) {
    return listTagsForPaper(paperId);
  }
  database.prepare("DELETE FROM paper_tags WHERE paper_id = ? AND tag_id = ?").run(paperRowId, tagRow.id);
  return listTagsForPaper(paperId);
};
