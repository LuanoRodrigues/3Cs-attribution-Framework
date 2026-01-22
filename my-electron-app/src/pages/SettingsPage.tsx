import { DEFAULT_COLLECTION_NAME, ANALYSE_COLLECTION_KEY } from "../analyse/constants";

const STORAGE_KEY = ANALYSE_COLLECTION_KEY;
const DEFAULT_COLLECTION = DEFAULT_COLLECTION_NAME;

export class SettingsPage {
  private mount: HTMLElement;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.render();
  }

  private readStoredCollection(): string {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_COLLECTION;
    } catch {
      return DEFAULT_COLLECTION;
    }
  }

  private persistCollection(value: string): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      console.warn("Unable to persist collection name", err);
    }
  }

  private render(): void {
    this.mount.innerHTML = "";
    const wrapper = document.createElement("section");
    wrapper.className = "page-shell";

    const title = document.createElement("h2");
    title.textContent = "Settings";
    wrapper.appendChild(title);

    const description = document.createElement("p");
    description.textContent = "Define workspace defaults used by Analyse (runs, collections, audio).";
    wrapper.appendChild(description);

    const form = document.createElement("div");
    form.className = "control-row";
    form.style.flexWrap = "wrap";
    form.style.alignItems = "center";

    const label = document.createElement("label");
    label.textContent = "Default collection:";
    label.style.display = "flex";
    label.style.gap = "8px";
    label.style.alignItems = "center";

    const input = document.createElement("input");
    input.type = "text";
    input.value = this.readStoredCollection();
    input.style.minWidth = "320px";
    input.placeholder = DEFAULT_COLLECTION;

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ribbon-button";
    saveBtn.textContent = "Save";
    const status = document.createElement("span");
    status.style.fontSize = "12px";
    status.style.color = "var(--muted)";

    saveBtn.addEventListener("click", () => {
      const value = input.value.trim() || DEFAULT_COLLECTION;
      this.persistCollection(value);
      status.textContent = `Default collection set to ${value}`;
    });

    label.appendChild(input);
    label.appendChild(saveBtn);
    label.appendChild(status);
    form.appendChild(label);

    const note = document.createElement("p");
    note.className = "status-bar";
    note.textContent = `Current default: ${input.value}`;
    note.style.margin = "0";
    form.appendChild(note);

    wrapper.appendChild(form);
    this.mount.appendChild(wrapper);
  }
}
