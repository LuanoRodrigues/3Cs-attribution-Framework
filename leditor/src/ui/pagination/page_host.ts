type PageTemplate = {
  page: HTMLElement;
  content: HTMLElement;
};

export type PageHostOptions = {
  container: HTMLElement;
  createPage: (index: number) => PageTemplate;
};

export class PageHost {
  private pages: PageTemplate[] = [];

  constructor(private options: PageHostOptions) {}

  ensurePageCount(count: number): void {
    if (count < 1) {
      throw new Error("PageHost requires at least one page.");
    }
    while (this.pages.length > count) {
      const page = this.pages.pop();
      page?.page.remove();
    }
    while (this.pages.length < count) {
      const index = this.pages.length;
      const template = this.options.createPage(index);
      this.pages.push(template);
      this.options.container.appendChild(template.page);
    }
  }

  getPageContents(): HTMLElement[] {
    return this.pages.map((entry) => entry.content);
  }

  clear(): void {
    this.pages.forEach((entry) => entry.page.remove());
    this.pages = [];
  }
}
