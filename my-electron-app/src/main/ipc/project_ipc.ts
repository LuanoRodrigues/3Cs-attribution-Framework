import { app, dialog, ipcMain } from "electron";
import path from "path";

import type { ProjectContext, ProjectInitialization, SessionData, RecentProjectRecord } from "../../session/sessionTypes";
import { ProjectManager } from "../services/projectManager";

const DEFAULT_PROJECT_DIR_NAME = "Annotarium Projects";

export function registerProjectIpcHandlers(manager: ProjectManager): void {
  ipcMain.handle("project:initialize", async () => {
    const recent = manager.getRecentProjects();
    const defaultDir = path.join(app.getPath("documents"), DEFAULT_PROJECT_DIR_NAME);
    let project: ProjectContext | undefined;
    const lastPath = manager.getLastProjectPath();
    if (lastPath) {
      try {
        project = await manager.openProject(lastPath);
      } catch (error) {
        console.error("Unable to restore last project", error);
      }
    }
    return {
      project,
      recentProjects: recent,
      defaultSaveDirectory: defaultDir
    } as ProjectInitialization;
  });

  ipcMain.handle(
    "project:create",
    (_event, payload: { directory: string; name: string; useParent?: boolean }) => {
      const basePath = path.resolve(payload.directory);
      const targetPath = payload.useParent ? path.join(basePath, payload.name) : basePath;
      return manager.createProject(targetPath, payload.name);
    }
  );

  ipcMain.handle("project:open", (_event, projectPath: string) => manager.openProject(projectPath));

  ipcMain.handle("project:list-recent", () => manager.getRecentProjects());

  ipcMain.handle("project:save", async (_event, payload: { projectPath: string; session: SessionData }) => {
    await manager.saveSession(payload.projectPath, payload.session);
    return { status: "ok" };
  });

  ipcMain.handle(
    "project:export",
    async (_event, payload: { projectPath: string; destination?: string }) => {
      const exported = await manager.exportProject(payload.projectPath, payload.destination, app.getVersion());
      return { path: exported };
    }
  );

  ipcMain.handle(
    "project:import",
    async (_event, payload: { archivePath: string; destination: string }) => {
      const context = await manager.importProject(payload.archivePath, payload.destination);
      return context;
    }
  );

  ipcMain.handle("project:get-default-directory", () => path.join(app.getPath("documents"), DEFAULT_PROJECT_DIR_NAME));

  ipcMain.handle("project:pick-directory", async (_event, options?: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog({
      title: "Select project folder",
      buttonLabel: "Select",
      defaultPath: options?.defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("project:pick-archive", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select project archive",
      buttonLabel: "Import",
      properties: ["openFile"],
      filters: [{ name: "Archive", extensions: ["zip"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
}
