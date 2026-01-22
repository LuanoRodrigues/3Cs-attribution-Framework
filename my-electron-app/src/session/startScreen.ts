import type { RecentProjectRecord } from "../session/sessionTypes";

export interface StartScreenHandlers {
  onPickLocation: (options?: { defaultPath?: string }) => Promise<string | null>;
  onCreateProject: (payload: { directory: string; name: string; useParent?: boolean }) => Promise<void>;
  onOpenExisting: () => Promise<void>;
  onOpenRecent: (projectPath: string) => Promise<void>;
  onExportProject: () => Promise<void>;
  onPickArchive: () => Promise<string | null>;
  onImportArchive: (payload: { archivePath: string }) => Promise<void>;
}

export class StartScreen {
  private readonly nameInput: HTMLInputElement;
  private readonly chooseButton: HTMLButtonElement;
  private readonly createButton: HTMLButtonElement;
  private readonly openButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly importButton: HTMLButtonElement;
  private readonly chooseArchiveButton: HTMLButtonElement;
  private readonly locationValue: HTMLElement;
  private readonly archiveValue: HTMLElement;
  private readonly recentList: HTMLElement;
  private readonly statusEl: HTMLElement;
  private selectedDirectory: string | null = null;
  private fallbackDirectory: string | null = null;
  private selectedArchive: string | null = null;
  private busy = false;

  constructor(private readonly overlay: HTMLElement, private readonly handlers: StartScreenHandlers) {
    this.nameInput = overlay.querySelector("#session-new-name") as HTMLInputElement;
    this.chooseButton = overlay.querySelector("#session-choose-dir") as HTMLButtonElement;
    this.createButton = overlay.querySelector("#session-create") as HTMLButtonElement;
    this.openButton = overlay.querySelector("#session-open-existing") as HTMLButtonElement;
    this.exportButton = overlay.querySelector("#session-export-project") as HTMLButtonElement;
    this.importButton = overlay.querySelector("#session-import-archive") as HTMLButtonElement;
    this.chooseArchiveButton = overlay.querySelector("#session-choose-archive") as HTMLButtonElement;
    this.locationValue = overlay.querySelector("#session-location-value") as HTMLElement;
    this.archiveValue = overlay.querySelector("#session-archive-value") as HTMLElement;
    this.recentList = overlay.querySelector("#session-recent-list") as HTMLElement;
    this.statusEl = overlay.querySelector("#session-status") as HTMLElement;
    this.setupListeners();
  }

  show(): void {
    this.overlay.classList.remove("hidden");
  }

  hide(): void {
    this.overlay.classList.add("hidden");
  }

  setLocation(directory: string | null, options?: { isDefault?: boolean }): void {
    this.selectedDirectory = directory;
    this.locationValue.textContent = directory ? directory : "Not selected";
    if (options?.isDefault) {
      this.fallbackDirectory = directory;
    }
  }

  setArchive(path: string | null): void {
    this.selectedArchive = path;
    this.archiveValue.textContent = path ?? "None";
  }

  setStatus(message: string, tone: "info" | "error" = "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.style.color = tone === "error" ? "#fda4af" : "var(--muted)";
  }

  focusProjectNameInput(): void {
    this.nameInput.focus();
    const length = this.nameInput.value.length;
    this.nameInput.setSelectionRange(length, length);
  }

  updateRecentProjects(entries: RecentProjectRecord[]): void {
    this.recentList.innerHTML = "";
    if (entries.length === 0) {
      const row = document.createElement("li");
      row.textContent = "No recent projects yet.";
      row.style.fontSize = "13px";
      row.style.color = "var(--muted)";
      this.recentList.appendChild(row);
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement("li");
      const label = document.createElement("div");
      label.className = "session-recent-label";
      label.innerHTML = `<strong>${entry.name}</strong><span>${new Date(entry.lastOpened).toLocaleString()}</span>`;
      row.appendChild(label);
      row.addEventListener("click", () => this.handlers.onOpenRecent(entry.path));
      this.recentList.appendChild(row);
    });
  }

  private setupListeners(): void {
    this.chooseButton.addEventListener("click", () => this.handleChooseDirectory());
    this.createButton.addEventListener("click", () => this.handleCreateProject());
    this.openButton.addEventListener("click", () => this.handleOpenExisting());
    this.exportButton.addEventListener("click", () => this.handleExportProject());
    this.importButton.addEventListener("click", () => this.handleImportArchive());
    this.chooseArchiveButton.addEventListener("click", () => this.handleChooseArchive());
  }

  private async handleChooseDirectory(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.setStatus("Selecting location...");
    try {
      const result = await this.handlers.onPickLocation({ defaultPath: this.fallbackDirectory ?? undefined });
      if (result) {
        this.setLocation(result);
        this.setStatus("Location selected.");
      } else {
        this.setStatus("Location selection canceled.");
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Unable to pick location", "error");
    }
  }

  private async handleCreateProject(): Promise<void> {
    if (this.busy) {
      return;
    }
    const directory = this.selectedDirectory ?? this.fallbackDirectory;
    if (!directory) {
      this.setStatus("Choose a directory before creating a project.", "error");
      return;
    }
    const projectName = this.nameInput.value.trim() || "Untitled project";
    this.setBusy(true);
    this.setStatus("Creating project...");
    try {
      const useParent = !Boolean(this.selectedDirectory);
      await this.handlers.onCreateProject({ directory, name: projectName, useParent });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Unable to create project", "error");
    } finally {
      this.setBusy(false);
    }
  }

  private async handleOpenExisting(): Promise<void> {
    await this.performOpenExisting();
  }

  private async handleExportProject(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.setBusy(true);
    this.setStatus("Exporting project...");
    try {
      await this.handlers.onExportProject();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Export failed", "error");
    } finally {
      this.setBusy(false);
    }
  }

  private async handleChooseArchive(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.setStatus("Selecting archive...");
    try {
      const result = await this.handlers.onPickArchive();
      if (result) {
        this.setArchive(result);
        this.setStatus("Archive selected.");
      } else {
        this.setStatus("Archive selection canceled.");
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Unable to pick archive", "error");
    }
  }

  private async handleImportArchive(): Promise<void> {
    if (this.busy) {
      return;
    }
    if (!this.selectedArchive) {
      this.setStatus("Choose an archive before importing.", "error");
      return;
    }
    this.setBusy(true);
    this.setStatus("Importing archive...");
    try {
      await this.handlers.onImportArchive({ archivePath: this.selectedArchive });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Import failed", "error");
    } finally {
      this.setBusy(false);
    }
  }

  async requestOpenExisting(): Promise<void> {
    await this.performOpenExisting();
  }

  private async performOpenExisting(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.setBusy(true);
    this.setStatus("Opening project...");
    try {
      await this.handlers.onOpenExisting();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Unable to open project", "error");
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    this.chooseButton.disabled = value;
    this.createButton.disabled = value;
    this.openButton.disabled = value;
    this.exportButton.disabled = value;
    this.importButton.disabled = value;
    this.chooseArchiveButton.disabled = value;
  }

  getFallbackDirectory(): string | null {
    return this.fallbackDirectory;
  }

  getSelectedDirectory(): string | null {
    return this.selectedDirectory;
  }

  getSelectedArchive(): string | null {
    return this.selectedArchive;
  }
}
