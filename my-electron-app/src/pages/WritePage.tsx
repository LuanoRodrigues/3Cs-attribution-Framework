import { WritePanel } from "../panels/write/WritePanel";
import { getDefaultCoderScope } from "../analyse/collectionScope";

const HOST_ID = "write-leditor-host";
const LEDITOR_MOUNT_ID = "editor";
const STATUS_CLASS = "write-leditor-status";
const HOST_CLASS = "write-leditor-shell";
const STYLE_ENTRY = "renderer/bootstrap.bundle.css";
const SCRIPT_ENTRY = "renderer/bootstrap.bundle.js";
const SCRIPT_PRELUDE = "renderer/prelude.js";
const SCRIPT_VENDOR = "renderer/vendor-leditor.js";
let writePanelScopeId: string | null = null;
const BODY_WRITE_CLASS = "write-leditor-active";

type HostPackage = {
  host: HTMLElement;
  status: HTMLElement;
  mountPoint: HTMLElement;
};

let sharedHost: HostPackage | undefined;
let scriptPromise: Promise<void> | undefined;

function getProjectBase(): { hostRoot: HostPackage; scriptUrl: string } {
  if (!sharedHost) {
    sharedHost = createHostPackage();
  }
  const base = new URL("../leditor/", window.location.href);
  const scriptUrl = new URL(SCRIPT_ENTRY, base).href;
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

function ensureStyleLoaded(styleUrl: string): void {
  const existing = document.querySelector<HTMLLinkElement>("link[data-leditor-style]");
  if (existing) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = styleUrl;
  link.dataset.leditorStyle = "true";
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

function ensureScriptLoaded(): Promise<void> {
  if (scriptPromise) {
    return scriptPromise;
  }
  const { scriptUrl } = getProjectBase();
  setHostStatus("Loading Write editor…", false);
  const hostPackage = sharedHost;
  if (!hostPackage) {
    const error = new Error("Write host missing");
    setHostStatus(error.message, true);
    return Promise.reject(error);
  }
  const host = hostPackage.host;
  const base = new URL("../leditor/", window.location.href);
  const resourceBase = new URL("../resources/leditor/", window.location.href);
  const styleUrl = new URL(STYLE_ENTRY, base).href;
  try {
    localStorage.setItem("leditor.coderStatePath", new URL("content/coder_state.json", resourceBase).pathname);
    localStorage.setItem("leditor.scopeId", writePanelScopeId ?? getDefaultCoderScope());
  } catch {
    // best-effort; ignore storage failures
  }
  ensureStyleLoaded(styleUrl);
  const vendorUrl = new URL(SCRIPT_VENDOR, new URL("../leditor/", window.location.href)).href;
  const preludeUrl = new URL(SCRIPT_PRELUDE, new URL("../leditor/", window.location.href)).href;
  const ready = (async () => {
    await waitForHostReady(host);
    const mount = ensureMountPoint(hostPackage);
    await waitForEditorMount(mount.id);
    console.info("[write][mount-check]", { hasEditor: Boolean(mount.isConnected) });
    await appendScript(preludeUrl, false);
    await appendScript(vendorUrl, false);
    window.__leditorAutoMount = false;
    await appendScript(scriptUrl, true);
    window.__leditorMountEditor?.();
  })();
  scriptPromise = ready;
  ready.catch(() => {
    scriptPromise = undefined;
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
    const ready = ensureScriptLoaded();
    this.sync = new WritePanel({ scopeId: panelScope, scriptReady: ready });
    void this.sync.init();
  }

  focus(): void {
    window.leditor?.focus?.();
  }

  destroy(): void {
    this.sync?.destroy();
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
}
