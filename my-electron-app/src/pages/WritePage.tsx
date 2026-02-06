// Write now uses leditor's LEDOC import/export (no coder_state.json bootstrapping).

const HOST_ID = "write-leditor-host";
const LEDITOR_MOUNT_ID = "editor";
const STATUS_CLASS = "write-leditor-status";
const HOST_CLASS = "write-leditor-shell";
// Prefer the canonical ESM entry used by the leditor build (avoids legacy globals).
const LIB_STYLE_ENTRY = "lib/index.css";
const LIB_MODULE_ENTRY = "lib/index.js";
const BODY_WRITE_CLASS = "write-leditor-active";
const dbg = (fn: string, msg: string, extra?: Record<string, unknown>) => {
  const line = `[WritePage.tsx][${fn}][debug] ${msg}`;
  if (extra) {
    console.debug(line, extra);
  } else {
    console.debug(line);
  }
};

type HostPackage = {
  host: HTMLElement;
  status: HTMLElement;
  mountPoint: HTMLElement;
};

let sharedHost: HostPackage | undefined;
let leditorReadyPromise: Promise<void> | undefined;
let destroyApp: (() => void) | null = null;
let ledocPath: string | null = null;

function getProjectBase(): { hostRoot: HostPackage } {
  if (!sharedHost) {
    sharedHost = createHostPackage();
  }
  return { hostRoot: sharedHost };
}

function createHostPackage(): HostPackage {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.className = HOST_CLASS;
  const status = document.createElement("div");
  status.className = STATUS_CLASS;
  status.textContent = "Loading Write editor…";
  const mountPoint = document.createElement("div");
  mountPoint.id = LEDITOR_MOUNT_ID;
  mountPoint.className = "write-leditor-mount";
  host.appendChild(status);
  host.appendChild(mountPoint);
  return { host, status, mountPoint };
}

function setHostStatus(message: string, isError = false): void {
  const packageRef = sharedHost;
  if (!packageRef) {
    return;
  }
  packageRef.status.textContent = message;
  packageRef.host.classList.toggle(`${HOST_CLASS}--error`, isError);
  packageRef.host.classList.toggle(`${HOST_CLASS}--ready`, !message && !isError);
}

const HOST_READY_CHECK_INTERVAL_MS = 40;
const HOST_READY_TIMEOUT_MS = 5000;

async function waitForHostReady(host: HTMLElement): Promise<void> {
  const start = Date.now();
  while (!host.isConnected) {
    if (Date.now() - start > HOST_READY_TIMEOUT_MS) {
      throw new Error("Write host did not connect to the DOM in time");
    }
    await new Promise((resolve) => window.setTimeout(resolve, HOST_READY_CHECK_INTERVAL_MS));
  }
}

function ensureStyleLoaded(styleUrl: string, id: string): void {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-leditor-style="${id}"]`);
  if (existing) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = styleUrl;
  link.dataset.leditorStyle = id;
  document.head.appendChild(link);
}

function ensureMountPoint(packageRef: HostPackage): HTMLElement {
  let mount = packageRef.host.querySelector(`#${LEDITOR_MOUNT_ID}`) as HTMLElement | null;
  if (!mount) {
    mount = document.createElement("div");
    mount.id = LEDITOR_MOUNT_ID;
    mount.className = "write-leditor-mount";
  }
  if (mount.parentElement !== packageRef.host) {
    packageRef.host.appendChild(mount);
  }
  packageRef.mountPoint = mount;
  return mount;
}

const waitForGlobal = async <T,>(getter: () => T | null | undefined, timeoutMs: number): Promise<T> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = getter();
    if (value) return value;
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error("Timeout waiting for editor API");
};


async function ensureLibraryLeditorLoaded(): Promise<void> {
  const hostPackage = sharedHost;
  if (!hostPackage) {
    throw new Error("Write host missing");
  }
  const host = hostPackage.host;
  await waitForHostReady(host);
  ensureMountPoint(hostPackage);
  const w = window as typeof window & { codexLog?: { write: (line: string) => void } };
  if (!w.codexLog) {
    w.codexLog = {
      write: (line: string) => console.info("[write][leditor][codexLog]", line)
    };
  }

  const base = new URL("../leditor/", window.location.href);
  const styleUrl = new URL(LIB_STYLE_ENTRY, base).href;
  const moduleUrl = new URL(LIB_MODULE_ENTRY, base);
  // Bust ESM caching so reopening Write after updating leditor on disk uses the latest bits.
  moduleUrl.searchParams.set("v", String(Date.now()));
  ensureStyleLoaded(styleUrl, "lib-index");

  const mod: any = await import(moduleUrl.href);
  const api = mod;
  if (!api?.createLeditorApp) throw new Error("LEditor library API missing after module load");

  const instance = await api.createLeditorApp({
    container: hostPackage.host,
    elementId: LEDITOR_MOUNT_ID,
    requireHostContract: true,
    enableCoderStateImport: false,
    uiScale: 1
  });
  destroyApp = typeof instance?.destroy === "function" ? instance.destroy : api.destroyLeditorApp ?? null;

  const appRoot = hostPackage.host.querySelector(".leditor-app") as HTMLElement | null;
  if (appRoot) {
    const hostRect = hostPackage.host.getBoundingClientRect();
    const appRect = appRoot.getBoundingClientRect();
    const ribbonHost = appRoot.querySelector(".leditor-ribbon-host") as HTMLElement | null;
    const ribbonRect = ribbonHost?.getBoundingClientRect() ?? null;
    const uiScale = getComputedStyle(appRoot).getPropertyValue("--ui-scale").trim();
    dbg("ensureLibraryLeditorLoaded", "layout probe", { hostRect, appRect, ribbonRect, uiScale });
    const topLeft = document.elementFromPoint(12, 12) as HTMLElement | null;
    dbg("ensureLibraryLeditorLoaded", "top-left element", {
      tag: topLeft?.tagName,
      id: topLeft?.id,
      className: topLeft?.className
    });
  }

  // Load the persisted LEDOC document (coder_state.ledoc) and autosave back into it.
  ledocPath = await (window.leditorHost as any)?.getDefaultLEDOCPath?.().catch(() => null);
  if (!ledocPath) {
    ledocPath = "coder_state.ledoc";
  }
  try {
    const importer = await waitForGlobal(
      () => (window as any).__leditorAutoImportLEDOC as
        | ((options?: { sourcePath?: string; prompt?: boolean }) => Promise<any>)
        | undefined,
      8000
    );
    await importer({ sourcePath: ledocPath, prompt: false });
  } catch (error) {
    console.warn("[write][ledoc][import] skipped", { ledocPath, error });
  }
  // Autosave is handled inside leditor itself (debounced, non-prompting).
}

function ensureLeditorLoaded(): Promise<void> {
  if (leditorReadyPromise) return leditorReadyPromise;
  setHostStatus("Loading Write editor…", false);
  const ready = (async () => {
    await ensureLibraryLeditorLoaded();
    setHostStatus("", false);
  })();
  leditorReadyPromise = ready;
  ready.catch(() => {
    leditorReadyPromise = undefined;
  });
  return ready;
}

declare global {
  interface Window {
    leditor?: { focus?: () => void };
    __writeEditorHost?: HTMLElement;
  }
}

export class WritePage {
  private container: HTMLElement;
  private hostPackage: HostPackage;
  private hostConnectionPromise: Promise<void> | null = null;
  private hostConnectionObserver: MutationObserver | null = null;
  private hostConnectionTimeout: number | null = null;

  constructor(mount: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "write-page-shell";
    mount.innerHTML = "";
    mount.appendChild(this.container);
    this.hostPackage = getProjectBase().hostRoot;
    this.attachHost();
    window.__writeEditorHost = this.hostPackage.host;
    this.addWriteBodyClass();
    void this.waitForHostConnection().then(() => ensureLeditorLoaded());
  }

  focus(): void {
    window.leditor?.focus?.();
  }

  destroy(): void {
    this.cleanupHostConnectionWatcher();
    try {
      destroyApp?.();
    } catch {
      // ignore
    }
    destroyApp = null;
    leditorReadyPromise = undefined;
    ledocPath = null;
    const host = this.hostPackage.host;
    if (host.parentElement === this.container) {
      this.container.removeChild(host);
    }
    this.removeWriteBodyClass();
  }

  private attachHost(): void {
    const host = this.hostPackage.host;
    if (host.parentElement !== this.container) {
      this.container.appendChild(host);
    }
  }

  private addWriteBodyClass(): void {
    document.documentElement?.classList.add(BODY_WRITE_CLASS);
    document.body?.classList.add(BODY_WRITE_CLASS);
  }

  private removeWriteBodyClass(): void {
    document.documentElement?.classList.remove(BODY_WRITE_CLASS);
    document.body?.classList.remove(BODY_WRITE_CLASS);
  }

  private waitForHostConnection(): Promise<void> {
    if (this.hostConnectionPromise) {
      return this.hostConnectionPromise;
    }
    const host = this.hostPackage.host;
    if (host.isConnected) {
      this.hostConnectionPromise = Promise.resolve();
      return this.hostConnectionPromise;
    }
    this.hostConnectionPromise = new Promise((resolve) => {
      const root = document.body ?? document.documentElement;
      if (!root) {
        resolve();
        return;
      }
      const settle = (): void => {
        this.cleanupHostConnectionWatcher();
        resolve();
      };
      this.hostConnectionObserver = new MutationObserver(() => {
        if (host.isConnected) {
          settle();
        }
      });
      this.hostConnectionObserver.observe(root, { childList: true, subtree: true });
      this.hostConnectionTimeout = window.setTimeout(() => {
        console.warn("[write][host] host attachment wait timed out");
        settle();
      }, HOST_READY_TIMEOUT_MS);
    });
    return this.hostConnectionPromise;
  }

  private cleanupHostConnectionWatcher(): void {
    if (this.hostConnectionObserver) {
      this.hostConnectionObserver.disconnect();
      this.hostConnectionObserver = null;
    }
    if (this.hostConnectionTimeout !== null) {
      window.clearTimeout(this.hostConnectionTimeout);
      this.hostConnectionTimeout = null;
    }
  }
}
