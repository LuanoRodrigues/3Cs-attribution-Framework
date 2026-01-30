import type { EditorCommandId } from "../api/editor_commands.ts";
import { setPressedState } from "./ribbon_controls.ts";
import {
  RibbonStateBus,
  type RibbonStateSnapshot,
  type RibbonStateKey,
  isMixed,
  readBinding
} from "./ribbon_state.ts";
import { type AlignmentVariant } from "./ribbon_selection_helpers.ts";

export type RibbonSelectionTargets = {
  toggles: Array<{ commandId: EditorCommandId; bindingKey?: RibbonStateKey; element: HTMLButtonElement }>;
  alignmentButtons: Partial<Record<AlignmentVariant, HTMLButtonElement>>;
};

type ToggleResolver = (state: RibbonStateSnapshot) => boolean | "mixed";

const TOGGLE_STATE_RESOLVERS: Partial<Record<EditorCommandId, ToggleResolver>> = {
  Bold: (state) => Boolean(state.bold),
  Italic: (state) => Boolean(state.italic),
  Underline: (state) => Boolean(state.underline),
  Strikethrough: (state) => Boolean(state.strikethrough),
  Superscript: (state) => Boolean(state.superscript),
  Subscript: (state) => Boolean(state.subscript),
  BulletList: (state) => state.listType === "bulleted",
  NumberList: (state) => state.listType === "numbered",
  SetReadMode: (state) => Boolean(state.readMode),
  SetPrintLayout: (state) => !Boolean(state.readMode),
  ViewSinglePage: (state) => (state.viewMode as string | undefined) === "single",
  ViewTwoPage: (state) => (state.viewMode as string | undefined) === "two-page",
  ViewFitWidth: (state) => (state.viewMode as string | undefined) === "fit-width"
};

export const watchRibbonSelectionState = (
  stateBus: RibbonStateBus,
  targets: RibbonSelectionTargets
): (() => void) => {
  const editorHandle: any = (stateBus as any)?.editorHandle;
  const editor = editorHandle?.getEditor?.();
  if (!editor) {
    // Debug: silenced noisy ribbon logs.
    return () => {};
  }
  const update = (state: RibbonStateSnapshot): void => {
    const alignment = (state.alignment as AlignmentVariant) ?? "left";
    for (const [variantKey, button] of Object.entries(targets.alignmentButtons)) {
      if (!button) continue;
      const variant = variantKey as AlignmentVariant;
      const isActive = variant === alignment;
      setPressedState(button, isActive);
    }
    targets.toggles.forEach(({ commandId, bindingKey, element }) => {
      const resolver = TOGGLE_STATE_RESOLVERS[commandId];
      const boundValue = bindingKey ? readBinding(state, bindingKey) : undefined;
      if (bindingKey && isMixed(boundValue)) {
        setPressedState(element, "mixed");
        return;
      }
      const pressed = resolver ? resolver(state) : Boolean(boundValue ?? state[commandId as RibbonStateKey]);
      setPressedState(element, pressed ?? false);
    });
  };
  const unsubscribe = stateBus.subscribe(update);
  update(stateBus.getState());
  return unsubscribe;
};
