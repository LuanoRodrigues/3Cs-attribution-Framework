
type PhaseFlags = {
  entered: boolean;
  exited: boolean;
  logged: boolean;
};

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

const phaseFlags: PhaseFlags = {
  entered: false,
  exited: false,
  logged: false
};

let rootElement: HTMLElement | null = null;
let keyHandler: ((event: KeyboardEvent) => void) | null = null;
let previousOverflow: string | null = null;

const maybeLogPhase = () => {
  if (phaseFlags.logged) return;
  if (phaseFlags.entered && phaseFlags.exited) {
    window.codexLog?.write("[PHASE15_OK]");
    phaseFlags.logged = true;
  }
};

const isFullscreen = () => rootElement?.classList.contains("leditor-app--fullscreen") ?? false;

const enterFullscreen = () => {
  if (!rootElement || isFullscreen()) return;
  rootElement.classList.add("leditor-app--fullscreen");
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  phaseFlags.entered = true;
};

const exitFullscreen = () => {
  if (!rootElement || !isFullscreen()) return;
  rootElement.classList.remove("leditor-app--fullscreen");
  document.body.style.overflow = previousOverflow ?? "";
  previousOverflow = null;
  phaseFlags.exited = true;
  maybeLogPhase();
};

export const toggleFullscreen = () => {
  if (!rootElement) return;
  if (isFullscreen()) {
    exitFullscreen();
    return;
  }
  enterFullscreen();
};

export const isFullscreenActive = () => isFullscreen();

export const initFullscreenController = (root: HTMLElement) => {
  rootElement = root;
  rootElement.classList.add("leditor-app");
  if (!keyHandler) {
    keyHandler = (event) => {
      if (event.key === "Escape" && isFullscreen()) {
        exitFullscreen();
      }
    };
    document.addEventListener("keydown", keyHandler);
  }
};
