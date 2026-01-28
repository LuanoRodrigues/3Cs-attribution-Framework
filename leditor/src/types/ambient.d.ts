declare module "*.html" {
  const content: string;
  export default content;
}

declare module "sanitize-html";
declare module "diff-match-patch";
declare module "nspell";
declare module "opentype.js";

declare module "nouislider" {
  const nouislider: {
    create: (element: HTMLElement, options: any) => any;
  };
  export type API = any;
  export type Options = any;
  export default nouislider;
}

declare namespace nouislider {
  type API = any;
  type Options = any;
}
