import sanitizeHtml from "sanitize-html";
import { PDFDocument } from "pdf-lib";
import diffMatchPatch from "diff-match-patch";
// import nspell from "nspell";

export const registerLibrarySmokeChecks = (): void => {
  sanitizeHtml("<p>sanity</p>", { allowedTags: ["p"] });
  PDFDocument.create();
  const diff = new diffMatchPatch();
  diff.diff_main("a", "b");
  // Spellcheck intentionally disabled in this build to avoid missing AFF/DIC assets.
};
