import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import ElectronStore from "electron-store";
import JSZip from "jszip";

import type { LayoutSnapshot } from "../../panels/PanelLayoutRoot";
import type { PanelId } from "../../layout/panelRegistry";
import type { SessionData, ProjectContext, ProjectMetadata, RecentProjectRecord } from "../../session/sessionTypes";
import { createEmptySessionData } from "../../session/sessionDefaults";
import {
  getSessionFilePath,
  getAssetsDirectory,
  getExportDirectory,
  getProjectMetadataPath,
  PROJECT_METADATA_FILE_NAME
} from "../../session/sessionPaths";
import { getSettingsFilePath } from "../../config/settingsFacade";
import { ANALYSE_DIR } from "../../analyse/backend";
import { absolutizeRunPath, computeSha256, createManifest, parseManifest } from "./projectManifest";
import { getCoderCacheDir, getAnalyseRoot } from "../../session/sessionPaths";

export interface ProjectManagerOptions {
  onRecentChange?: (recent: RecentProjectRecord[]) => void;
}

type ElectronStoreLike = {
  has(key: string): boolean;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  path?: string;
};

const RECENT_PROJECTS_KEY = "recentProjects";
const LAST_PROJECT_KEY = "lastOpenedProject";
const SESSION_CACHE_KEY = "sessionCache";
const MAX_RECENT_ITEMS = 6;

export class ProjectManager {
  private readonly store: ElectronStoreLike;
  private readonly onRecentChange?: (recent: RecentProjectRecord[]) => void;

  constructor(private readonly userDataPath: string, options?: ProjectManagerOptions) {
    const storageDir = path.join(this.userDataPath, "projects");
    void fs.mkdir(storageDir, { recursive: true });
    this.store = new ElectronStore({
      cwd: storageDir,
      name: "project-metadata",
      fileExtension: "json",
      watch: false,
      accessPropertiesByDotNotation: false
    }) as ElectronStoreLike;
    this.onRecentChange = options?.onRecentChange;
  }

  getRecentProjects(): RecentProjectRecord[] {
    const raw = this.store.get<RecentProjectRecord[]>(RECENT_PROJECTS_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw;
  }

  getLastProjectPath(): string | null {
    const value = this.store.get<string>(LAST_PROJECT_KEY);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    return null;
  }

  async createProject(projectPath: string, projectName: string): Promise<ProjectContext> {
    const resolved = path.resolve(projectPath);
    const sessionFile = getSessionFilePath(resolved);
    if (await this.pathExists(sessionFile)) {
      throw new Error("Project already contains a session file");
    }
    await fs.mkdir(resolved, { recursive: true });
    await fs.mkdir(getAssetsDirectory(resolved), { recursive: true });
    const projectId = randomUUID();
    const session = createEmptySessionData(projectName, projectId);
    await this.writeSession(resolved, session);
    await this.writeProjectMetadata(resolved, session);
    this.cacheSession(session);
    const metadata = this.buildMetadata(resolved, session);
    this.registerProject(metadata);
    return { metadata, session };
  }

  async openProject(projectPath: string): Promise<ProjectContext> {
    const resolved = path.resolve(projectPath);
    await fs.mkdir(resolved, { recursive: true });
    const sessionFile = getSessionFilePath(resolved);
    let session: SessionData;
    if (await this.pathExists(sessionFile)) {
      const raw = await fs.readFile(sessionFile, "utf-8");
      session = JSON.parse(raw) as SessionData;
    } else {
      const cached = this.restoreSessionFromCache(resolved);
      if (cached) {
        session = cached;
      } else {
        const name = path.basename(resolved) || "Untitled Project";
        const cachedId = this.findProjectIdByPath(resolved) ?? randomUUID();
        session = createEmptySessionData(name, cachedId);
      }
      await this.writeSession(resolved, session);
    }
    session = this.migrateLegacyPanels(this.migrateAnalysePaths(session));
    session.projectName = session.projectName || path.basename(resolved) || "Untitled Project";
    session.projectId = session.projectId || randomUUID();
    session.createdAt = session.createdAt || new Date().toISOString();
    await this.writeProjectMetadata(resolved, session);
    await this.writeSession(resolved, session);
    const metadata = this.buildMetadata(resolved, session);
    this.cacheSession(session);
    this.registerProject(metadata);
    return { metadata, session };
  }

  async saveSession(projectPath: string, session: SessionData): Promise<void> {
    const resolved = path.resolve(projectPath);
    await fs.mkdir(resolved, { recursive: true });
    const migrated = this.migrateLegacyPanels(this.migrateAnalysePaths(session));
    migrated.updatedAt = new Date().toISOString();
    await this.writeSession(resolved, migrated);
    await this.writeProjectMetadata(resolved, migrated);
    const metadata = this.buildMetadata(resolved, migrated);
    this.cacheSession(migrated);
    this.registerProject(metadata);
  }

  async exportProject(projectPath: string, targetPath?: string, appVersion?: string): Promise<string> {
    const resolved = path.resolve(projectPath);
    const exportDir = await this.ensureExportDirectory();
    const baseName = path.basename(resolved) || "project";
    const fileName = targetPath ? path.basename(targetPath) : `${baseName}-${Date.now()}.zip`;
    const destination = targetPath ? path.resolve(targetPath) : path.join(exportDir, fileName);

    const zip = new JSZip();
    const projectFolder = zip.folder("project");
    if (!projectFolder) {
      throw new Error("Unable to create project folder in archive");
    }
    await this.addDirectoryToZip(projectFolder, resolved, resolved);

    const sessionPath = getSessionFilePath(resolved);
    const sessionBuffer = await fs.readFile(sessionPath);
    const session: SessionData = JSON.parse(sessionBuffer.toString("utf-8"));

    const settingsPath = getSettingsFilePath();
    const settingsBuffer = await fs.readFile(settingsPath);
    zip.file("settings/settings.json", settingsBuffer);

    const projectStorePath = this.getStorePath();
    const projectStoreBuffer = await fs.readFile(projectStorePath);
    zip.file("metadata/project-store.json", projectStoreBuffer);

    const projectMetadataPath = getProjectMetadataPath(resolved);
    const projectMetadataBuffer = await fs.readFile(projectMetadataPath);
    zip.file(path.join("project", PROJECT_METADATA_FILE_NAME), projectMetadataBuffer);

    let coderArchivePath: string | undefined;
    const coderDir = getCoderCacheDir();
    if (await this.pathExists(coderDir)) {
      const coderFolder = zip.folder("coder");
      if (!coderFolder) {
        throw new Error("Unable to create coder folder in archive");
      }
      await this.addDirectoryToZip(coderFolder, coderDir, coderDir);
      coderArchivePath = "coder";
    }

    let analyseInfo:
      | {
          baseDir: string;
          archivePath: string;
        }
      | undefined;
    if (session.analyse?.baseDir) {
      if (!(await this.pathExists(session.analyse.baseDir))) {
        throw new Error(`Analyse base directory is missing: ${session.analyse.baseDir}`);
      }
      const baseDirName = path.basename(session.analyse.baseDir);
      const archivePath = path.join("analyse", baseDirName);
      const analyseFolder = zip.folder(archivePath);
      if (!analyseFolder) {
        throw new Error("Unable to create analyse folder in archive");
      }
      await this.addDirectoryToZip(analyseFolder, session.analyse.baseDir, session.analyse.baseDir);
      analyseInfo = { baseDir: session.analyse.baseDir, archivePath };
    }

    const manifest = createManifest({
      session,
      appVersion,
      platform: process.platform,
      sessionSha256: computeSha256(sessionBuffer),
      paths: {
        sessionFile: path.join("project", path.basename(sessionPath)),
        projectMetadataFile: path.join("project", PROJECT_METADATA_FILE_NAME),
        assetsDir: "project/assets",
        settingsFile: "settings/settings.json",
        projectStoreFile: "metadata/project-store.json",
        coderCacheDir: coderArchivePath,
        analyse: analyseInfo
          ? {
              baseDir: analyseInfo.baseDir,
              archivePath: analyseInfo.archivePath,
              runs: session.analyse?.runs,
              activeRunPath: session.analyse?.activeRunPath
            }
          : undefined
      }
    });

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const content = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(destination, content);
    return destination;
  }

  async importProject(archivePath: string, targetDirectory: string): Promise<ProjectContext> {
    const resolvedArchive = path.resolve(archivePath);
    const targetRoot = path.resolve(targetDirectory);
    await fs.mkdir(targetRoot, { recursive: true });

    const buffer = await fs.readFile(resolvedArchive);
    const zip = await JSZip.loadAsync(buffer);

    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) {
      throw new Error("Archive is missing manifest.json");
    }
    const manifest = parseManifest(await manifestEntry.async("string"));

    await this.extractDirectory(zip, "project", targetRoot);
    await this.extractFile(zip, manifest.paths.projectMetadataFile, getProjectMetadataPath(targetRoot));

    const settingsDest = getSettingsFilePath();
    await this.extractFile(zip, manifest.paths.settingsFile, settingsDest);

    const storeDest = this.getStorePath();
    await this.extractFile(zip, manifest.paths.projectStoreFile, storeDest);

    if (manifest.paths.coderCacheDir) {
      const coderDest = path.join(this.userDataPath, "coder");
      await fs.rm(coderDest, { recursive: true, force: true });
      await this.extractDirectory(zip, manifest.paths.coderCacheDir, coderDest);
    }

    if (manifest.paths.analyse) {
      const analyseDest = path.join(ANALYSE_DIR, manifest.paths.analyse.baseDirName);
      await fs.rm(analyseDest, { recursive: true, force: true });
      await this.extractDirectory(zip, manifest.paths.analyse.archivePath, analyseDest);
      await this.rewriteAnalysePaths(targetRoot, analyseDest, manifest);
    }

    const restoredContext = await this.openProject(targetRoot);
    return restoredContext;
  }

  private buildMetadata(projectPath: string, session: SessionData): ProjectMetadata {
    const now = new Date().toISOString();
    return {
      projectId: session.projectId,
      name: session.projectName,
      path: projectPath,
      createdAt: session.createdAt,
      lastOpenedAt: now
    };
  }

  private registerProject(metadata: ProjectMetadata): void {
    const current = this.getRecentProjects().filter((item) => item.projectId !== metadata.projectId && item.path !== metadata.path);
    current.unshift({
      projectId: metadata.projectId,
      name: metadata.name,
      path: metadata.path,
      lastOpened: metadata.lastOpenedAt
    });
    const trimmed = current.slice(0, MAX_RECENT_ITEMS);
    this.store.set(RECENT_PROJECTS_KEY, trimmed);
    this.store.set(LAST_PROJECT_KEY, metadata.path);
    this.onRecentChange?.(trimmed);
  }

  private async writeSession(projectPath: string, session: SessionData): Promise<void> {
    const sessionFile = getSessionFilePath(projectPath);
    const payload = JSON.stringify(session, null, 2);
    await fs.writeFile(sessionFile, payload, "utf-8");
  }

  private cacheSession(session: SessionData): void {
    if (!session.projectId) {
      return;
    }
    const cache = this.readSessionCache();
    cache[session.projectId] = session;
    this.store.set(SESSION_CACHE_KEY, cache);
  }

  private restoreSessionFromCache(projectPath: string): SessionData | null {
    const projectId = this.findProjectIdByPath(projectPath);
    if (!projectId) {
      return null;
    }
    const cache = this.readSessionCache();
    return cache[projectId] ?? null;
  }

  private readSessionCache(): Record<string, SessionData> {
    const raw = this.store.get<Record<string, SessionData>>(SESSION_CACHE_KEY, {});
    if (raw && typeof raw === "object") {
      return raw;
    }
    return {};
  }

  private findProjectIdByPath(projectPath: string): string | null {
    const entry = this.getRecentProjects().find((item) => item.path === projectPath);
    return entry ? entry.projectId : null;
  }

  private async ensureExportDirectory(): Promise<string> {
    const exportsPath = getExportDirectory();
    await fs.mkdir(exportsPath, { recursive: true });
    return exportsPath;
  }

  private getStorePath(): string {
    const candidate = (this.store as { path?: string }).path;
    if (!candidate) {
      throw new Error("Project metadata store path unavailable");
    }
    return candidate;
  }

  private async addDirectoryToZip(zip: JSZip, dir: string, root: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, entryPath);
      if (entry.isDirectory()) {
        const folder = zip.folder(relativePath);
        if (folder) {
          await this.addDirectoryToZip(folder, entryPath, root);
        }
        continue;
      }
      if (entry.isFile()) {
        const content = await fs.readFile(entryPath);
        zip.file(relativePath, content);
      }
    }
  }

  private async extractFile(zip: JSZip, archivePath: string, destination: string): Promise<void> {
    const entry = zip.file(archivePath);
    if (!entry) {
      throw new Error(`Archive missing required file: ${archivePath}`);
    }
    const buffer = await entry.async("nodebuffer");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);
  }

  private async extractDirectory(zip: JSZip, prefix: string, destination: string): Promise<void> {
    const entries = Object.values(zip.files).filter((file) => file.name === prefix || file.name.startsWith(`${prefix}/`));
    if (entries.length === 0) {
      throw new Error(`Archive missing required directory: ${prefix}`);
    }
    for (const entry of entries) {
      const relative = path.relative(prefix, entry.name);
      const target = path.join(destination, relative);
      if (entry.dir) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      const buffer = await entry.async("nodebuffer");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
    }
  }

  private async rewriteAnalysePaths(projectRoot: string, analyseDest: string, manifest: ReturnType<typeof parseManifest>): Promise<void> {
    const sessionPath = getSessionFilePath(projectRoot);
    const sessionRaw = await fs.readFile(sessionPath, "utf-8");
    const session: SessionData = JSON.parse(sessionRaw);
    if (!session.analyse) {
      throw new Error("Session missing analyse state");
    }
    session.analyse.baseDir = analyseDest;
    if (manifest.paths.analyse?.runs) {
      if (!session.analyse.runs || session.analyse.runs.length === 0) {
        throw new Error("Session missing analyse runs to rewrite");
      }
      session.analyse.runs = session.analyse.runs.map((run, index) => {
        const manifestRun = manifest.paths.analyse?.runs?.[index];
        if (!manifestRun) {
          return run;
        }
        const nextPath = absolutizeRunPath(analyseDest, manifestRun.relativePath);
        return { ...run, path: nextPath ?? run.path };
      });
    }
    if (manifest.paths.analyse?.activeRunRelativePath) {
      session.analyse.activeRunPath = absolutizeRunPath(analyseDest, manifest.paths.analyse.activeRunRelativePath);
    }
    const migrated = this.migrateAnalysePaths(session);
    await this.writeSession(projectRoot, migrated);
    await this.writeProjectMetadata(projectRoot, migrated);
  }

  private migrateAnalysePaths(session: SessionData): SessionData {
    if (!session.analyse) return session;
    const legacy = path.join(process.env.HOME ?? "", "annotarium", "evidence_coding_outputs");
    const newRoot = getAnalyseRoot();
    const mapPath = (candidate?: string): string | undefined => {
      if (!candidate) return candidate;
      const resolved = path.resolve(candidate);
      const legacyResolved = path.resolve(legacy);
      if (resolved === legacyResolved) return newRoot;
      if (resolved.startsWith(legacyResolved + path.sep)) {
        const suffix = path.relative(legacyResolved, resolved);
        return path.join(newRoot, suffix);
      }
      return candidate;
    };

    const next = { ...session, analyse: { ...session.analyse } };
    next.analyse.baseDir = mapPath(session.analyse.baseDir);
    if (next.analyse.runs) {
      next.analyse.runs = next.analyse.runs.map((run) => ({
        ...run,
        path: mapPath(run.path) ?? run.path
      }));
    }
    if (next.analyse.activeRunPath) {
      next.analyse.activeRunPath = mapPath(next.analyse.activeRunPath);
    }
    return next;
  }

  private migrateLegacyPanels(session: SessionData): SessionData {
    const next = { ...session };
    next.layout = this.sanitizeLayoutSnapshot(next.layout);
    if (next.panelLayouts) {
      const layouts = { ...next.panelLayouts };
      (Object.keys(layouts) as PanelId[]).forEach((panelId) => {
        layouts[panelId] = this.sanitizeLayoutSnapshot(layouts[panelId]);
      });
      next.panelLayouts = layouts;
    }
    return next;
  }

  private sanitizeLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
    const filteredTabs = snapshot.tabs.filter((tab) => tab.toolType !== "settings-panel");
    const activeToolId = filteredTabs.some((tab) => tab.id === snapshot.activeToolId)
      ? snapshot.activeToolId
      : filteredTabs[0]?.id;
    return { tabs: filteredTabs, activeToolId };
  }

  private async writeProjectMetadata(projectRoot: string, session: SessionData): Promise<void> {
    const payload = {
      projectId: session.projectId,
      name: session.projectName,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      appVersion: process.env.npm_package_version,
      manifestVersion: 1
    };
    const target = getProjectMetadataPath(projectRoot);
    await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf-8");
  }

  private async pathExists(candidate: string): Promise<boolean> {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      return false;
    }
  }
}
