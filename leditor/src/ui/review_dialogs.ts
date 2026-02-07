import Swal from "sweetalert2";

const baseSwal = () =>
  Swal.mixin({
    customClass: {
      popup: "leditor-review-swal",
      confirmButton: "leditor-review-swal__confirm",
      cancelButton: "leditor-review-swal__cancel",
      denyButton: "leditor-review-swal__deny",
      input: "leditor-review-swal__input"
    },
    buttonsStyling: false,
    focusConfirm: false
  });

export const openAccessibilityPopover = (issues: string[]): void => {
  const html = issues.length
    ? `<ul class="leditor-review-swal__list">${issues.map((item) => `<li>${item}</li>`).join("")}</ul>`
    : "<div class=\"leditor-review-swal__hint\">No obvious accessibility issues detected.</div>";
  void baseSwal().fire({
    title: "Accessibility",
    html,
    icon: issues.length ? "warning" : "success",
    confirmButtonText: "Close"
  });
};

export const openTranslatePopover = (options: {
  language: string;
  onApply: (payload: { language: string; scope: "selection" | "document" }) => void;
}): void => {
  const html = `
    <div class="leditor-review-swal__stack">
      <label class="leditor-review-swal__field">
        <span>Translate to</span>
        <input id="leditor-translate-language" class="leditor-review-swal__input" type="text" placeholder="e.g. Spanish" value="${
          options.language.replace(/"/g, "&quot;")
        }" />
      </label>
      <div class="leditor-review-swal__hint">Scope</div>
      <div class="leditor-review-swal__row">
        <label class="leditor-review-swal__radio">
          <input type="radio" name="leditor-translate-scope" value="selection" checked />
          <span>Selection</span>
        </label>
        <label class="leditor-review-swal__radio">
          <input type="radio" name="leditor-translate-scope" value="document" />
          <span>Document</span>
        </label>
      </div>
    </div>
  `;

  void baseSwal()
    .fire({
      title: "Translate",
      html,
      showCancelButton: true,
      confirmButtonText: "Translate",
      cancelButtonText: "Cancel",
      preConfirm: () => {
        const input = document.getElementById("leditor-translate-language") as HTMLInputElement | null;
        const language = input?.value.trim() ?? "";
        if (!language) {
          Swal.showValidationMessage("Language is required.");
          return null;
        }
        const selected =
          (document.querySelector('input[name="leditor-translate-scope"]:checked') as HTMLInputElement | null)
            ?.value ?? "selection";
        const scope = selected === "document" ? "document" : "selection";
        return { language, scope };
      }
    })
    .then((result) => {
      if (!result.isConfirmed || !result.value) return;
      options.onApply(result.value as { language: string; scope: "selection" | "document" });
    });
};

export const openProofingLanguagePopover = (options: {
  current: string;
  onApply: (value: string) => void;
}): void => {
  void baseSwal()
    .fire({
      title: "Language",
      input: "text",
      inputLabel: "Proofing language",
      inputPlaceholder: "e.g. en-US",
      inputValue: options.current,
      showCancelButton: true,
      confirmButtonText: "Set",
      cancelButtonText: "Cancel",
      preConfirm: (value) => {
        const next = String(value ?? "").trim();
        if (!next) {
          Swal.showValidationMessage("Language is required.");
          return null;
        }
        return next;
      }
    })
    .then((result) => {
      if (!result.isConfirmed || !result.value) return;
      options.onApply(String(result.value));
    });
};

export const openCommentsDeletePopover = (options: {
  onDeleteCurrent: () => void;
  onDeleteAll: () => void;
}): void => {
  void baseSwal()
    .fire({
      title: "Delete Comments",
      html: "Choose which comments to remove.",
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: "Current",
      denyButtonText: "All",
      cancelButtonText: "Cancel"
    })
    .then((result) => {
      if (result.isDenied) {
        options.onDeleteAll();
      } else if (result.isConfirmed) {
        options.onDeleteCurrent();
      }
    });
};

export const openMarkupPopover = (options: {
  current: string;
  onApply: (mode: "simple" | "all" | "none") => void;
}): void => {
  void baseSwal()
    .fire({
      title: "Show Markup",
      input: "radio",
      inputOptions: {
        simple: "Simple markup",
        all: "All markup",
        none: "No markup"
      },
      inputValue: options.current,
      showCancelButton: true,
      confirmButtonText: "Apply",
      cancelButtonText: "Cancel",
      preConfirm: (value) => {
        const next = String(value ?? "").trim();
        if (!next) {
          Swal.showValidationMessage("Select a markup mode.");
          return null;
        }
        return next;
      }
    })
    .then((result) => {
      if (!result.isConfirmed || !result.value) return;
      const raw = String(result.value);
      const mode = raw === "all" || raw === "none" ? raw : "simple";
      options.onApply(mode);
    });
};

export const openRestrictEditingPopover = (options: {
  isRestricted: boolean;
  onApply: () => void;
}): void => {
  void baseSwal()
    .fire({
      title: "Restrict Editing",
      html: options.isRestricted
        ? "Editing is currently restricted."
        : "Restrict editing to read-only mode.",
      showCancelButton: true,
      confirmButtonText: options.isRestricted ? "Enable Editing" : "Restrict Editing",
      cancelButtonText: "Cancel"
    })
    .then((result) => {
      if (result.isConfirmed) {
        options.onApply();
      }
    });
};

export const openInfoPopover = (options: { title: string; message: string }): void => {
  void baseSwal().fire({
    title: options.title,
    html: `<div class=\"leditor-review-swal__hint\">${options.message}</div>`,
    confirmButtonText: "Close"
  });
};
