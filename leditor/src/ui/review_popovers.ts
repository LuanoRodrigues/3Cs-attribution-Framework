import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";

type ReviewCardAction = {
  label: string;
  onSelect: () => void | boolean;
};

type ReviewCardOptions = {
  anchor: HTMLElement;
  title: string;
  content: string | HTMLElement;
  actions?: ReviewCardAction[];
};

let activePopover: {
  cleanup: () => void;
} | null = null;

const closeActivePopover = (): void => {
  if (!activePopover) {
    return;
  }
  activePopover.cleanup();
  activePopover = null;
};

export const showReviewCard = (options: ReviewCardOptions): void => {
  if (typeof document === "undefined") {
    return;
  }
  closeActivePopover();

  const card = document.createElement("div");
  card.className = "card leditor-review-card";
  card.tabIndex = -1;
  const title = document.createElement("h1");
  title.textContent = options.title;
  card.appendChild(title);
  const body = document.createElement("div");
  body.className = "card-body";
  if (typeof options.content === "string") {
    body.textContent = options.content;
  } else {
    body.appendChild(options.content);
  }
  card.appendChild(body);

  if (options.actions && options.actions.length) {
    const footer = document.createElement("div");
    footer.className = "card-actions";
    options.actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "leditor-review-card-action";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        const result = action.onSelect();
        if (result === false) return;
        closeActivePopover();
      });
      footer.appendChild(button);
    });
    card.appendChild(footer);
  }

  document.body.appendChild(card);
  computePosition(options.anchor, card, {
    placement: "bottom-start",
    middleware: [offset(6), flip(), shift({ padding: 8 })]
  }).then(({ x, y }) => {
    card.style.position = "fixed";
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    card.style.zIndex = "2200";
  });

  card.focus();

  const handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (!target || !card.contains(target)) {
      closeActivePopover();
    }
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeActivePopover();
      options.anchor.focus();
    }
  };

  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("keydown", handleKeydown);

  const cleanupAutoUpdate = autoUpdate(options.anchor, card, () => {
    computePosition(options.anchor, card, {
      placement: "bottom-start",
      middleware: [offset(6), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      card.style.left = `${Math.round(x)}px`;
      card.style.top = `${Math.round(y)}px`;
    });
  });

  const cleanup = (): void => {
    cleanupAutoUpdate();
    document.removeEventListener("click", handleDocumentClick, true);
    document.removeEventListener("keydown", handleKeydown);
    if (card.isConnected) {
      card.remove();
    }
    options.anchor.focus();
  };

  activePopover = { cleanup };
};
