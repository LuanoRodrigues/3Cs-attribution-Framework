declare module "*.csl" {
  const content: string;
  export default content;
}

declare module "*.xml" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}

declare module "citeproc" {
  const CSL: any;
  export default CSL;
}

declare module "sanitize-html" {
  const sanitizeHtml: any;
  export default sanitizeHtml;
}

declare module "diff-match-patch" {
  const DiffMatchPatch: any;
  export default DiffMatchPatch;
}

declare module "nspell" {
  const nspell: any;
  export default nspell;
}

declare module "opentype.js" {
  const opentype: any;
  export default opentype;
}

// nouislider exposes a global namespace type in some build configurations.
declare namespace nouislider {
  type API = any;
  type Options = any;
  const create: any;
}
