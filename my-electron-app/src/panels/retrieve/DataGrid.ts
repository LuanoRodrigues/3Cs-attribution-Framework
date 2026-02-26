type SortDirection = "asc" | "desc" | "none";

export type DataGridCellValue = unknown;

export type DataGridSelection = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
};

export type DataGridCallbacks = {
  onCellEdit?: (rowIndex: number, colIndex: number, value: string) => void;
  onSortChange?: (colIndex: number, direction: SortDirection) => void;
  onRowActivate?: (rowIndex: number) => void;
  onRowRender?: (options: {
    rowEl: HTMLElement;
    rowIndex: number;
    rowData: Array<unknown>;
    columns: string[];
  }) => void;
};

type ColumnType = "number" | "boolean" | "date" | "string" | "mixed";

const DEFAULT_ROW_HEIGHT = 26;
const DEFAULT_HEADER_HEIGHT = 28;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 80;
const MAX_AUTO_COL_WIDTH = 520;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function stringifyCell(value: DataGridCellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => stringifyCell(v))
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.toLowerCase() !== "nan" && v !== "<NA>")
      .join("; ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const s = String(value);
  if (s.trim().toLowerCase() === "nan" || s.trim() === "<NA>") {
    return "";
  }
  return s;
}

function inferColumnTypes(columns: string[], rows: Array<Array<unknown>>, sample = 200): ColumnType[] {
  const types: ColumnType[] = columns.map(() => "mixed");
  const counts = columns.map(() => ({ number: 0, boolean: 0, date: 0, string: 0, total: 0 }));

  const limit = Math.min(rows.length, sample);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < columns.length; c++) {
      const v = row[c];
      if (v === null || v === undefined || v === "") {
        continue;
      }
      counts[c].total++;
      if (typeof v === "number" && Number.isFinite(v)) {
        counts[c].number++;
        continue;
      }
      if (typeof v === "boolean") {
        counts[c].boolean++;
        continue;
      }
      if (v instanceof Date) {
        counts[c].date++;
        continue;
      }
      // Heuristic: ISO-like date strings.
      if (typeof v === "string") {
        const s = v.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
          const dt = Date.parse(s);
          if (!Number.isNaN(dt)) {
            counts[c].date++;
            continue;
          }
        }
        const num = Number(s);
        if (s.length > 0 && !Number.isNaN(num) && Number.isFinite(num)) {
          counts[c].number++;
          continue;
        }
        counts[c].string++;
        continue;
      }
      counts[c].string++;
    }
  }

  for (let c = 0; c < columns.length; c++) {
    const total = counts[c].total || 1;
    const n = counts[c].number / total;
    const b = counts[c].boolean / total;
    const d = counts[c].date / total;
    const s = counts[c].string / total;
    if (n >= 0.8) types[c] = "number";
    else if (b >= 0.9) types[c] = "boolean";
    else if (d >= 0.8) types[c] = "date";
    else if (s >= 0.7) types[c] = "string";
    else types[c] = "mixed";
  }
  return types;
}

function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const res = compare(a.item, b.item);
      return res !== 0 ? res : a.idx - b.idx;
    })
    .map((x) => x.item);
}

function normalizeSelection(sel: DataGridSelection): DataGridSelection {
  const r0 = Math.min(sel.r0, sel.r1);
  const r1 = Math.max(sel.r0, sel.r1);
  const c0 = Math.min(sel.c0, sel.c1);
  const c1 = Math.max(sel.c0, sel.c1);
  return { r0, c0, r1, c1 };
}

export class DataGrid {
  readonly element: HTMLElement;

  private header: HTMLElement;
  private headerCorner: HTMLElement;
  private headerRow: HTMLElement;
  private body: HTMLElement;
  private bodySpacer: HTMLElement;
  private bodyCanvas: HTMLElement;

  private columns: string[] = [];
  private rows: Array<Array<unknown>> = [];
  private columnTypes: ColumnType[] = [];
  private colWidths: number[] = [];
  private rowHeight = DEFAULT_ROW_HEIGHT;
  private headerHeight = DEFAULT_HEADER_HEIGHT;

  private sortCol: number | null = null;
  private sortDir: SortDirection = "none";

  private selection: DataGridSelection | null = null;
  private anchorCell: { r: number; c: number } | null = null;
  private isSelecting = false;

  private editor: HTMLTextAreaElement;
  private isEditing = false;

  private callbacks: DataGridCallbacks;
  private rafPending = false;
  private rowHeaderWidth = 44;
  private flagNaEnabled = false;

  constructor(callbacks: DataGridCallbacks = {}) {
    this.callbacks = callbacks;
    this.element = document.createElement("div");
    this.element.className = "retrieve-grid";
    this.element.tabIndex = 0;

    this.header = document.createElement("div");
    this.header.className = "retrieve-grid-header";
    this.header.style.height = `${this.headerHeight}px`;

    this.headerCorner = document.createElement("div");
    this.headerCorner.className = "retrieve-grid-header-corner";
    this.headerCorner.textContent = "#";

    this.headerRow = document.createElement("div");
    this.headerRow.className = "retrieve-grid-header-row";

    this.header.append(this.headerCorner, this.headerRow);

    this.body = document.createElement("div");
    this.body.className = "retrieve-grid-body";
    this.body.addEventListener("scroll", () => {
      // Keep header aligned with horizontal scroll.
      this.headerRow.style.transform = `translateX(${-this.body.scrollLeft}px)`;
      if (this.isEditing) {
        // Avoid a "floating" editor when the user scrolls.
        this.commitEdit();
      }
      this.scheduleRender();
    });

    this.bodySpacer = document.createElement("div");
    this.bodySpacer.className = "retrieve-grid-spacer";

    this.bodyCanvas = document.createElement("div");
    this.bodyCanvas.className = "retrieve-grid-canvas";

    this.body.append(this.bodySpacer, this.bodyCanvas);

    this.editor = document.createElement("textarea");
    this.editor.className = "retrieve-grid-editor";
    this.editor.spellcheck = false;
    this.editor.style.display = "none";
    this.editor.addEventListener("keydown", (ev) => this.onEditorKeydown(ev));
    this.editor.addEventListener("blur", () => this.commitEdit());

    this.element.append(this.header, this.body, this.editor);

    this.element.addEventListener("keydown", (ev) => this.onKeydown(ev));
    this.element.addEventListener("mousedown", (ev) => this.onMouseDown(ev));
  }

  destroy(): void {
    // No-op for now (listeners are bound to elements we own).
  }

  focus(): void {
    this.element.focus();
  }

  setData(columns: string[], rows: Array<Array<unknown>>): void {
    this.columns = columns.slice();
    this.rows = rows.map((r) => r.slice());
    this.columnTypes = inferColumnTypes(this.columns, this.rows);
    this.colWidths = this.columns.map(() => DEFAULT_COL_WIDTH);
    this.sortCol = null;
    this.sortDir = "none";
    this.selection = null;
    this.anchorCell = null;
    this.isSelecting = false;
    this.isEditing = false;
    this.editor.style.display = "none";

    this.renderHeader();
    this.updateSpacer();
    this.scheduleRender(true);
  }

  setFlagNa(enabled: boolean): void {
    this.flagNaEnabled = enabled;
    this.scheduleRender(true);
  }

  getFlagNa(): boolean {
    return this.flagNaEnabled;
  }

  getData(): { columns: string[]; rows: Array<Array<unknown>> } {
    return { columns: this.columns.slice(), rows: this.rows.map((r) => r.slice()) };
  }

  autoFitColumns(sampleRows = 80): void {
    if (!this.columns.length) return;
    const ctx = document.createElement("canvas").getContext("2d");
    const font = getComputedStyle(this.element).font || "12px sans-serif";
    if (!ctx) return;
    ctx.font = font;
    const widths = this.columns.map((col) => ctx.measureText(col).width + 28);
    const limit = Math.min(this.rows.length, sampleRows);
    for (let r = 0; r < limit; r++) {
      const row = this.rows[r] ?? [];
      for (let c = 0; c < this.columns.length; c++) {
        const txt = stringifyCell(row[c]);
        const w = ctx.measureText(txt.length > 160 ? `${txt.slice(0, 160)}…` : txt).width + 28;
        widths[c] = Math.max(widths[c], w);
      }
    }
    this.colWidths = widths.map((w) => clamp(Math.ceil(w), MIN_COL_WIDTH, MAX_AUTO_COL_WIDTH));
    this.applyHeaderGridTemplate();
    this.updateSpacer();
    this.scheduleRender(true);
  }

  resetColumnWidths(): void {
    if (!this.columns.length) return;
    this.colWidths = this.columns.map(() => DEFAULT_COL_WIDTH);
    this.applyHeaderGridTemplate();
    this.updateSpacer();
    this.scheduleRender(true);
  }

  private updateSpacer(): void {
    const totalHeight = this.rows.length * this.rowHeight;
    const totalWidth = this.rowHeaderWidth + this.colWidths.reduce((acc, w) => acc + w, 0);
    this.bodySpacer.style.height = `${totalHeight}px`;
    this.bodySpacer.style.width = `${totalWidth}px`;
    this.bodyCanvas.style.width = `${totalWidth}px`;
  }

  private renderHeader(): void {
    this.headerRow.innerHTML = "";
    this.applyHeaderGridTemplate();

    this.columns.forEach((name, colIndex) => {
      const cell = document.createElement("div");
      cell.className = "retrieve-grid-header-cell";
      cell.dataset.col = String(colIndex);

      const label = document.createElement("div");
      label.className = "retrieve-grid-header-label";
      label.textContent = name;
      cell.appendChild(label);

      const sortBadge = document.createElement("div");
      sortBadge.className = "retrieve-grid-header-sort";
      sortBadge.textContent = this.sortCol === colIndex ? (this.sortDir === "asc" ? "▲" : this.sortDir === "desc" ? "▼" : "") : "";
      cell.appendChild(sortBadge);

      cell.addEventListener("click", (ev) => {
        // Ignore clicks on resizer handle.
        const target = ev.target as HTMLElement | null;
        if (target && target.classList.contains("retrieve-grid-col-resizer")) return;
        this.toggleSort(colIndex);
      });

      const resizer = document.createElement("div");
      resizer.className = "retrieve-grid-col-resizer";
      resizer.addEventListener("mousedown", (ev) => this.beginResize(ev, colIndex));
      cell.appendChild(resizer);

      this.headerRow.appendChild(cell);
    });
  }

  private applyHeaderGridTemplate(): void {
    const template = this.colWidths.map((w) => `${w}px`).join(" ");
    this.headerRow.style.gridTemplateColumns = template;
    this.bodyCanvas.style.setProperty("--grid-cols", template);
  }

  private scheduleRender(force = false): void {
    if (this.rafPending && !force) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderBody();
    });
  }

  private renderBody(): void {
    if (!this.columns.length) {
      this.bodyCanvas.innerHTML = "";
      return;
    }
    const scrollTop = this.body.scrollTop;
    const viewportHeight = this.body.clientHeight || 1;
    const start = clamp(Math.floor(scrollTop / this.rowHeight) - 8, 0, Math.max(0, this.rows.length - 1));
    const visible = Math.ceil(viewportHeight / this.rowHeight) + 16;
    const end = clamp(start + visible, 0, this.rows.length);

    this.bodyCanvas.innerHTML = "";
    this.bodyCanvas.style.transform = `translateY(${start * this.rowHeight}px)`;

    for (let r = start; r < end; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "retrieve-grid-row";
      rowEl.style.height = `${this.rowHeight}px`;
      rowEl.dataset.row = String(r);
      rowEl.tabIndex = 0;
      rowEl.setAttribute("role", "button");
      rowEl.ariaLabel = String(this.columns[0] ? `${String(this.columns[0])} row ${r + 1}` : `Row ${r + 1}`);
      if (r % 2 === 1) rowEl.classList.add("alt");

      const rowHeader = document.createElement("div");
      rowHeader.className = "retrieve-grid-row-header";
      rowHeader.textContent = String(r + 1);
      rowEl.appendChild(rowHeader);

      const rowCells = document.createElement("div");
      rowCells.className = "retrieve-grid-row-cells";
      rowCells.style.gridTemplateColumns = this.colWidths.map((w) => `${w}px`).join(" ");

      const row = this.rows[r] ?? [];
      for (let c = 0; c < this.columns.length; c++) {
        const cell = document.createElement("div");
        cell.className = "retrieve-grid-cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);

        const value = row[c];
        const txt = stringifyCell(value);
        cell.textContent = txt;
        cell.title = txt;

        if (this.flagNaEnabled && this.isNaValue(value)) {
          cell.classList.add("na-flag");
          if (!cell.title) {
            cell.title = "NA";
          }
        }

        if (this.selection) {
          const sel = normalizeSelection(this.selection);
          if (r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1) {
            cell.classList.add("selected");
          }
          if (this.anchorCell && this.anchorCell.r === r && this.anchorCell.c === c) {
            cell.classList.add("active");
          }
        }

        rowCells.appendChild(cell);
      }

      rowEl.appendChild(rowCells);
      rowEl.addEventListener("click", () => {
        this.callbacks.onRowActivate?.(r);
      });
      rowEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.callbacks.onRowActivate?.(r);
        }
      });
      this.callbacks.onRowRender?.({
        rowEl,
        rowIndex: r,
        rowData: row,
        columns: this.columns
      });
      this.bodyCanvas.appendChild(rowEl);
    }
  }

  private isNaValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") {
      const s = value.trim();
      return s.length === 0 || s.toLowerCase() === "nan" || s.toLowerCase() === "<na>";
    }
    return false;
  }

  private toggleSort(colIndex: number): void {
    console.info("[retrieve][datahub] sort requested", { colIndex });
    if (this.sortCol !== colIndex) {
      this.sortCol = colIndex;
      this.sortDir = "asc";
    } else {
      this.sortDir = this.sortDir === "asc" ? "desc" : this.sortDir === "desc" ? "none" : "asc";
      if (this.sortDir === "none") {
        this.sortCol = null;
      }
    }
    console.info("[retrieve][datahub] sort applied", { colIndex: this.sortCol, direction: this.sortDir });

    if (this.sortCol === null || this.sortDir === "none") {
      // Restore original order is not possible without keeping an index. Keep current order, but update badges.
      this.callbacks.onSortChange?.(-1, "none");
    } else {
      const col = this.sortCol;
      const dir = this.sortDir;
      const type = this.columnTypes[col] ?? "mixed";
      const factor = dir === "asc" ? 1 : -1;
      this.rows = stableSort(this.rows, (a, b) => {
        const av = a?.[col];
        const bv = b?.[col];
        const am = av === null || av === undefined || av === "";
        const bm = bv === null || bv === undefined || bv === "";
        if (am && bm) return 0;
        if (am) return 1;
        if (bm) return -1;

        if (type === "number") {
          const an = typeof av === "number" ? av : Number(String(av));
          const bn = typeof bv === "number" ? bv : Number(String(bv));
          if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
          if (Number.isNaN(an)) return 1;
          if (Number.isNaN(bn)) return -1;
          return (an - bn) * factor;
        }
        if (type === "boolean") {
          const ab = Boolean(av);
          const bb = Boolean(bv);
          if (ab === bb) return 0;
          return (ab ? 1 : -1) * factor;
        }
        if (type === "date") {
          const ad = av instanceof Date ? av.getTime() : Date.parse(String(av));
          const bd = bv instanceof Date ? bv.getTime() : Date.parse(String(bv));
          if (Number.isNaN(ad) && Number.isNaN(bd)) return 0;
          if (Number.isNaN(ad)) return 1;
          if (Number.isNaN(bd)) return -1;
          return (ad - bd) * factor;
        }
        const as = stringifyCell(av).toLowerCase();
        const bs = stringifyCell(bv).toLowerCase();
        if (as === bs) return 0;
        return (as < bs ? -1 : 1) * factor;
      });
      this.callbacks.onSortChange?.(col, dir);
    }

    this.renderHeader();
    this.updateSpacer();
    this.scheduleRender(true);
  }

  private onMouseDown(ev: MouseEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const cell = target.closest(".retrieve-grid-cell") as HTMLElement | null;
    if (!cell) return;

    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;

    this.focus();

    const extend = ev.shiftKey && this.anchorCell;
    if (!extend) {
      this.anchorCell = { r, c };
      this.selection = { r0: r, c0: c, r1: r, c1: c };
    } else {
      this.selection = { r0: this.anchorCell!.r, c0: this.anchorCell!.c, r1: r, c1: c };
    }

    this.isSelecting = true;
    this.scheduleRender(true);

    const moveHandler = (moveEv: MouseEvent) => {
      if (!this.isSelecting || !this.anchorCell) return;
      const moveTarget = moveEv.target as HTMLElement | null;
      const moveCell = moveTarget?.closest(".retrieve-grid-cell") as HTMLElement | null;
      if (!moveCell) return;
      const rr = Number(moveCell.dataset.row);
      const cc = Number(moveCell.dataset.col);
      if (!Number.isFinite(rr) || !Number.isFinite(cc)) return;
      this.selection = { r0: this.anchorCell.r, c0: this.anchorCell.c, r1: rr, c1: cc };
      this.scheduleRender(true);
    };

    const upHandler = () => {
      this.isSelecting = false;
      window.removeEventListener("mousemove", moveHandler);
      window.removeEventListener("mouseup", upHandler);
    };

    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
  }

  private onKeydown(ev: KeyboardEvent): void {
    if (this.isEditing) return;
    if (!this.anchorCell || !this.selection) return;

    const sel = normalizeSelection(this.selection);
    const active = { r: this.anchorCell.r, c: this.anchorCell.c };

    const moveActive = (dr: number, dc: number) => {
      const nr = clamp(active.r + dr, 0, Math.max(0, this.rows.length - 1));
      const nc = clamp(active.c + dc, 0, Math.max(0, this.columns.length - 1));
      this.anchorCell = { r: nr, c: nc };
      this.selection = { r0: nr, c0: nc, r1: nr, c1: nc };
      this.ensureCellVisible(nr);
      this.scheduleRender(true);
    };

    if (ev.key === "Enter" || ev.key === "F2") {
      ev.preventDefault();
      this.beginEdit();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c") {
      ev.preventDefault();
      void this.copySelectionToClipboard(sel);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "v") {
      ev.preventDefault();
      void this.pasteFromClipboard(sel);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveActive(1, 0);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveActive(-1, 0);
      return;
    }
    if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      moveActive(0, -1);
      return;
    }
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      moveActive(0, 1);
      return;
    }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      // Start editing and prefill with typed character.
      ev.preventDefault();
      this.beginEdit(ev.key);
    }
  }

  private ensureCellVisible(rowIndex: number): void {
    const top = rowIndex * this.rowHeight;
    const bottom = top + this.rowHeight;
    const viewTop = this.body.scrollTop;
    const viewBottom = viewTop + this.body.clientHeight;
    if (top < viewTop) this.body.scrollTop = top;
    else if (bottom > viewBottom) this.body.scrollTop = bottom - this.body.clientHeight;
  }

  private beginEdit(prefill?: string): void {
    if (!this.anchorCell) return;
    const { r, c } = this.anchorCell;
    const value = stringifyCell(this.rows[r]?.[c]);

    // Approximate editor position from scroll + widths.
    const y = r * this.rowHeight - this.body.scrollTop + this.headerHeight;
    const x = this.rowHeaderWidth + this.colWidths.slice(0, c).reduce((acc, w) => acc + w, 0) - this.body.scrollLeft;
    const w = this.colWidths[c] ?? DEFAULT_COL_WIDTH;
    const h = this.rowHeight;

    this.isEditing = true;
    this.editor.style.display = "block";
    this.editor.style.position = "absolute";
    this.editor.style.left = `${x}px`;
    this.editor.style.top = `${y}px`;
    this.editor.style.width = `${Math.max(60, w - 2)}px`;
    this.editor.style.height = `${Math.max(24, h - 2)}px`;
    this.editor.value = prefill !== undefined ? prefill : value;
    this.editor.focus();
    this.editor.setSelectionRange(this.editor.value.length, this.editor.value.length);
  }

  private commitEdit(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.editor.style.display = "none";
    if (!this.anchorCell) return;
    const { r, c } = this.anchorCell;
    const next = this.editor.value;
    this.rows[r] = this.rows[r] ?? [];
    this.rows[r][c] = next;
    this.callbacks.onCellEdit?.(r, c, next);
    this.scheduleRender(true);
  }

  private cancelEdit(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.editor.style.display = "none";
    this.focus();
  }

  private onEditorKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      this.cancelEdit();
      return;
    }
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      this.commitEdit();
    }
  }

  private async copySelectionToClipboard(sel: DataGridSelection): Promise<void> {
    const out: string[] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row: string[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) {
        row.push(stringifyCell(this.rows[r]?.[c]));
      }
      out.push(row.join("\t"));
    }
    const text = out.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // best-effort fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  private async pasteFromClipboard(sel: DataGridSelection): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!text) return;
    const rows = text.split(/\r?\n/).map((line) => line.split("\t"));
    const rStart = sel.r0;
    const cStart = sel.c0;
    for (let rr = 0; rr < rows.length; rr++) {
      for (let cc = 0; cc < rows[rr].length; cc++) {
        const r = rStart + rr;
        const c = cStart + cc;
        if (r >= this.rows.length || c >= this.columns.length) continue;
        const v = rows[rr][cc];
        this.rows[r][c] = v;
        this.callbacks.onCellEdit?.(r, c, v);
      }
    }
    this.scheduleRender(true);
  }

  private beginResize(ev: MouseEvent, colIndex: number): void {
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    const startWidth = this.colWidths[colIndex] ?? DEFAULT_COL_WIDTH;

    const move = (moveEv: MouseEvent) => {
      const dx = moveEv.clientX - startX;
      this.colWidths[colIndex] = clamp(startWidth + dx, MIN_COL_WIDTH, 1200);
      this.applyHeaderGridTemplate();
      this.updateSpacer();
      this.scheduleRender(true);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
}
