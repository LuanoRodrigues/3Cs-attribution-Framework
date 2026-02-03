import { Extension } from "@tiptap/core";
import { Plugin, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { dropPoint } from "@tiptap/pm/transform";

type DropCursorOptions = {
  color?: string | false;
  width?: number;
  class?: string;
};

class SafeDropCursorView {
  width: number;
  color: string | undefined;
  class: string | undefined;
  cursorPos: number | null = null;
  element: HTMLElement | null = null;
  timeout: number = -1;
  handlers: { name: string; handler: (event: Event) => void }[];

  constructor(
    readonly editorView: EditorView,
    options: DropCursorOptions
  ) {
    this.width = options.width ?? 1;
    this.color = options.color === false ? undefined : options.color || "black";
    this.class = options.class;

    this.handlers = ["dragover", "dragend", "drop", "dragleave"].map((name) => {
      const handler = (event: Event) => {
        (this as any)[name](event);
      };
      editorView.dom.addEventListener(name, handler);
      return { name, handler };
    });
  }

  destroy() {
    this.handlers.forEach(({ name, handler }) => this.editorView.dom.removeEventListener(name, handler));
    try {
      clearTimeout(this.timeout);
    } catch {
      // ignore
    }
    this.setCursor(null);
  }

  update(editorView: EditorView, prevState: EditorState) {
    if (this.cursorPos != null && prevState.doc !== editorView.state.doc) {
      if (this.cursorPos > editorView.state.doc.content.size) {
        this.setCursor(null);
      } else {
        this.updateOverlay();
      }
    }
  }

  setCursor(pos: number | null) {
    if (pos === this.cursorPos) return;
    this.cursorPos = pos;
    if (pos == null) {
      const el = this.element;
      const parent = el?.parentNode ?? null;
      if (el && parent) {
        try {
          parent.removeChild(el);
        } catch {
          // ignore
        }
      }
      this.element = null;
      return;
    }
    this.updateOverlay();
  }

  updateOverlay() {
    const cursorPos = this.cursorPos;
    if (cursorPos == null) return;

    const $pos = this.editorView.state.doc.resolve(cursorPos);
    const isBlock = !$pos.parent.inlineContent;
    let rect: { left: number; right: number; top: number; bottom: number } | undefined;

    const editorDOM = this.editorView.dom as HTMLElement;
    const editorRect = editorDOM.getBoundingClientRect();
    const scaleX = editorRect.width / editorDOM.offsetWidth;
    const scaleY = editorRect.height / editorDOM.offsetHeight;

    if (isBlock) {
      const before = $pos.nodeBefore;
      const after = $pos.nodeAfter;
      if (before || after) {
        const node = this.editorView.nodeDOM(cursorPos - (before ? before.nodeSize : 0)) as HTMLElement | null;
        if (node) {
          const nodeRect = node.getBoundingClientRect();
          let top = before ? nodeRect.bottom : nodeRect.top;
          if (before && after) {
            const midNode = this.editorView.nodeDOM(cursorPos) as HTMLElement | null;
            if (midNode) {
              top = (top + midNode.getBoundingClientRect().top) / 2;
            }
          }
          const halfWidth = (this.width / 2) * scaleY;
          rect = { left: nodeRect.left, right: nodeRect.right, top: top - halfWidth, bottom: top + halfWidth };
        }
      }
    }

    if (!rect) {
      const coords = this.editorView.coordsAtPos(cursorPos);
      const halfWidth = (this.width / 2) * scaleX;
      rect = { left: coords.left - halfWidth, right: coords.left + halfWidth, top: coords.top, bottom: coords.bottom };
    }

    const parent = (this.editorView.dom as HTMLElement).offsetParent as HTMLElement | null;
    if (!parent) return;

    if (!this.element) {
      this.element = parent.appendChild(document.createElement("div"));
      if (this.class) this.element.className = this.class;
      this.element.style.cssText = "position: absolute; z-index: 50; pointer-events: none;";
      if (this.color) this.element.style.backgroundColor = this.color;
    }

    this.element.classList.toggle("prosemirror-dropcursor-block", isBlock);
    this.element.classList.toggle("prosemirror-dropcursor-inline", !isBlock);

    let parentLeft: number;
    let parentTop: number;
    if (parent === document.body && getComputedStyle(parent).position === "static") {
      parentLeft = -pageXOffset;
      parentTop = -pageYOffset;
    } else {
      const parentRect = parent.getBoundingClientRect();
      const parentScaleX = parentRect.width / parent.offsetWidth;
      const parentScaleY = parentRect.height / parent.offsetHeight;
      parentLeft = parentRect.left - parent.scrollLeft * parentScaleX;
      parentTop = parentRect.top - parent.scrollTop * parentScaleY;
    }

    this.element.style.left = (rect.left - parentLeft) / scaleX + "px";
    this.element.style.top = (rect.top - parentTop) / scaleY + "px";
    this.element.style.width = (rect.right - rect.left) / scaleX + "px";
    this.element.style.height = (rect.bottom - rect.top) / scaleY + "px";
  }

  scheduleRemoval(timeout: number) {
    try {
      clearTimeout(this.timeout);
    } catch {
      // ignore
    }
    this.timeout = window.setTimeout(() => this.setCursor(null), timeout);
  }

  dragover(event: DragEvent) {
    if (!this.editorView.editable) return;
    const pos = this.editorView.posAtCoords({ left: event.clientX, top: event.clientY });

    const node = pos && pos.inside >= 0 && this.editorView.state.doc.nodeAt(pos.inside);
    const disableDropCursor = node && (node.type.spec as any).disableDropCursor;
    const disabled =
      typeof disableDropCursor === "function" ? disableDropCursor(this.editorView, pos, event) : disableDropCursor;

    if (pos && !disabled) {
      let target = pos.pos;
      const dragging = (this.editorView as any).dragging;
      if (dragging && dragging.slice) {
        const point = dropPoint(this.editorView.state.doc, target, dragging.slice);
        if (point != null) target = point;
      }
      this.setCursor(target);
      this.scheduleRemoval(5000);
    }
  }

  dragend() {
    this.scheduleRemoval(20);
  }

  drop() {
    this.scheduleRemoval(20);
  }

  dragleave(event: DragEvent) {
    if (!(this.editorView.dom as HTMLElement).contains((event as any).relatedTarget)) {
      this.setCursor(null);
    }
  }
}

const SafeDropcursorExtension = Extension.create<DropCursorOptions>({
  name: "safeDropcursor",
  addOptions() {
    return { width: 1, color: "black", class: undefined };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        view: (view) => new SafeDropCursorView(view, options)
      })
    ];
  }
});

export default SafeDropcursorExtension;

