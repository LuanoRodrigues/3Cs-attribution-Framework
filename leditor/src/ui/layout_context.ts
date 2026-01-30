import type { A4LayoutController } from "./a4_layout.ts";

let layoutController: A4LayoutController | null = null;

export const setLayoutController = (controller: A4LayoutController | null) => {
  if (layoutController && layoutController !== controller) {
    try {
      layoutController.destroy();
    } catch {
      // ignore destroy failures
    }
  }
  layoutController = controller;
};

export const getLayoutController = (): A4LayoutController | null => layoutController;
