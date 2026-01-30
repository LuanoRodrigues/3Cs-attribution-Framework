import { WritePanel } from "../panels/write/WritePanel";
import { getDefaultCoderScope } from "../analyse/collectionScope";

const HOST_ID = "write-leditor-host";
const LEDITOR_MOUNT_ID = "editor";
const STATUS_CLASS = "write-leditor-status";
const HOST_CLASS = "write-leditor-shell";
const LIB_STYLE_ENTRY = "lib/leditor.global.css";
const LIB_MODULE_ENTRY = "lib/leditor.global.mjs";
const LEGACY_STYLE_ENTRY = "renderer/bootstrap.bundle.css";
const LEGACY_SCRIPT_ENTRY = "renderer/bootstrap.bundle.js";
const LEGACY_SCRIPT_PRELUDE = "renderer/prelude.js";
const LEGACY_SCRIPT_VENDOR = "renderer/vendor-leditor.js";
let writePanelScopeId: string | null = null;
const BODY_WRITE_CLASS = "write-leditor-active";

type HostPackage = {
  host: HTMLElement;
  status: HTMLElement;
  mountPoint: HTMLElement;
};

let sharedHost: HostPackage | undefined;
let leditorReadyPromise: Promise<void> | undefined;
let destroyApp: (() => void) | null = null;

function getProjectBase(): { hostRoot: HostPackage; scriptUrl: string } {
  if (!sharedHost) {
    sharedHost = createHostPackage();
  }
  const base = new URL("../leditor/", window.location.href);
  const scriptUrl = new URL(LEGACY_SCRIPT_ENTRY, base).href;
  return { hostRoot: sharedHost, scriptUrl };
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

async function waitForEditorMount(mountId: string): Promise<HTMLElement> {
  const start = Date.now();
  while (true) {
    const mount = document.getElementById(mountId) as HTMLElement | null;
    if (mount?.isConnected) {
      return mount;
    }
    if (Date.now() - start > HOST_READY_TIMEOUT_MS) {
      throw new Error(`LEditor mount "${mountId}" never appeared`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, HOST_READY_CHECK_INTERVAL_MS));
  }
}

function appendScript(scriptUrl: string, asModule = false): Promise<void> {
  const script = document.createElement("script");
  script.type = asModule ? "module" : "text/javascript";
  script.src = scriptUrl;
  document.body.appendChild(script);
  return new Promise<void>((resolve, reject) => {
    script.addEventListener("load", () => {
      setHostStatus("", false);
      resolve();
    });
    script.addEventListener("error", () => {
      const failure = `Unable to load Write editor assets (${scriptUrl})`;
      setHostStatus(failure, true);
      reject(new Error(failure));
    });
  });
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

async function seedLeditorScope(): Promise<void> {
  try {
    const base = new URL("../resources/leditor/", window.location.href);
    const scopeId = writePanelScopeId ?? getDefaultCoderScope();
    localStorage.setItem("leditor.scopeId", scopeId);
    if (window.coderBridge?.loadState) {
      void window.coderBridge
        .loadState({ scopeId })
        .then((result) => {
          if (result?.statePath) {
            localStorage.setItem("leditor.coderStatePath", String(result.statePath));
          }
        })
        .catch(() => {
          // ignore
        });
    } else {
      localStorage.setItem("leditor.coderStatePath", new URL("content/coder_state.json", base).pathname);
    }
  } catch {
    // best-effort; ignore storage failures
  }
}

async function ensureLibraryLeditorLoaded(): Promise<void> {
  const hostPackage = sharedHost;
  if (!hostPackage) {
    throw new Error("Write host missing");
  }
  const host = hostPackage.host;
  await waitForHostReady(host);
  ensureMountPoint(hostPackage);
  await seedLeditorScope();
  const w = window as typeof window & { codexLog?: { write: (line: string) => void } };
  if (!w.codexLog) {
    w.codexLog = {
      write: (line: string) => console.info("[write][leditor][codexLog]", line)
    };
  }

  const base = new URL("../leditor/", window.location.href);
  const styleUrl = new URL(LIB_STYLE_ENTRY, base).href;
  const moduleUrl = new URL(LIB_MODULE_ENTRY, base).href;
  ensureStyleLoaded(styleUrl, "lib");

  const mod: any = await import(moduleUrl);
  const api = mod?.createLeditorApp ? mod : (globalThis as any).LEditor;
  if (!api?.createLeditorApp) {
    throw new Error("LEditor library API missing after module load");
  }

  const instance = await api.createLeditorApp({
    container: hostPackage.host,
    elementId: LEDITOR_MOUNT_ID,
    requireHostContract: true,
    enableCoderStateImport: true
  });
  destroyApp = typeof instance?.destroy === "function" ? instance.destroy : api.destroyLeditorApp ?? null;
}

async function ensureLegacyLeditorLoaded(): Promise<void> {
  const { scriptUrl } = getProjectBase();
  const hostPackage = sharedHost;
  if (!hostPackage) {
    throw new Error("Write host missing");
  }
  const host = hostPackage.host;
  const base = new URL("../leditor/", window.location.href);
  const styleUrl = new URL(LEGACY_STYLE_ENTRY, base).href;
  ensureStyleLoaded(styleUrl, "legacy");
  const vendorUrl = new URL(LEGACY_SCRIPT_VENDOR, base).href;
  const preludeUrl = new URL(LEGACY_SCRIPT_PRELUDE, base).href;

  await waitForHostReady(host);
  const mount = ensureMountPoint(hostPackage);
  await waitForEditorMount(mount.id);
  await seedLeditorScope();
  console.info("[write][mount-check]", { hasEditor: Boolean(mount.isConnected) });
  await appendScript(preludeUrl, false);
  await appendScript(vendorUrl, false);
  window.__leditorAutoMount = false;
  await appendScript(scriptUrl, true);
  window.__leditorMountEditor?.();
}

function ensureLeditorLoaded(): Promise<void> {
  if (leditorReadyPromise) return leditorReadyPromise;
  setHostStatus("Loading Write editor…", false);
  const ready = (async () => {
    try {
      await ensureLibraryLeditorLoaded();
      setHostStatus("", false);
    } catch (error) {
      console.warn("[write][leditor][fallback]", error);
      await ensureLegacyLeditorLoaded();
      setHostStatus("", false);
    }
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
    __leditorMountEditor?: () => void;
    __leditorAutoMount?: boolean;
  }
}

export class WritePage {
  private container: HTMLElement;
  private hostPackage: HostPackage;
  private sync?: WritePanel;
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
    const panelScope = getDefaultCoderScope();
    writePanelScopeId = panelScope;
    const ready = this.waitForHostConnection().then(() => ensureLeditorLoaded());
    this.sync = new WritePanel({ scopeId: panelScope, scriptReady: ready });
    void this.sync.init();
  }

  focus(): void {
    window.leditor?.focus?.();
  }

  destroy(): void {
    this.cleanupHostConnectionWatcher();
    this.sync?.destroy();
    try {
      destroyApp?.();
    } catch {
      // ignore
    }
    destroyApp = null;
    leditorReadyPromise = undefined;
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
