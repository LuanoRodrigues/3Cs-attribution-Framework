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

function waitForConnection(element: HTMLElement): Promise<void> {
  if (element.isConnected) {
    return Promise.resolve();
  }
  const root = document.body ?? document.documentElement;
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (element.isConnected) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  });
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

function ensureScriptLoaded(): Promise<void> {
  if (scriptPromise) {
    return scriptPromise;
  }
  const { scriptUrl } = getProjectBase();
  setHostStatus("Loading Write editor…", false);
  const host = sharedHost?.host;
  if (!host) {
    const error = new Error("Write host missing");
    setHostStatus(error.message, true);
    return Promise.reject(error);
  }
  const base = new URL("../leditor/", window.location.href);
  const styleUrl = new URL(STYLE_ENTRY, base).href;
  ensureStyleLoaded(styleUrl);
  const vendorUrl = new URL(SCRIPT_VENDOR, new URL("../leditor/", window.location.href)).href;
  const preludeUrl = new URL(SCRIPT_PRELUDE, new URL("../leditor/", window.location.href)).href;
  const ready = waitForConnection(host)
    .then(() => appendScript(preludeUrl, false))
    .then(() => appendScript(vendorUrl, false))
    .then(() => appendScript(scriptUrl, true));
  scriptPromise = ready;
  ready.catch(() => {
    scriptPromise = undefined;
  });
  return ready;
}

declare global {
  interface Window {
    leditor?: { focus?: () => void };
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
    const ready = ensureScriptLoaded();
    this.sync = new WritePanel({ scopeId: getDefaultCoderScope(), scriptReady: ready });
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
  }

  private attachHost(): void {
    const host = this.hostPackage.host;
    if (host.parentElement !== this.container) {
      this.container.appendChild(host);
    }
  }
}
