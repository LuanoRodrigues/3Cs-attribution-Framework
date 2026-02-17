const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateExpectations } = require("./pagination_page_cases.cjs");

const withEnv = (updates, fn) => {
  const previous = new Map();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const makePage = (overrides = {}) => ({
  pageIndex: 0,
  pageNumber: 1,
  paragraphCount: 6,
  wordCount: 120,
  blockCount: 8,
  fillRatio: 0.82,
  fillRatioBottom: 0.8,
  overflowY: 0,
  overflowX: 0,
  whiteSpaceRatio: 0.08,
  whiteSpacePx: 28,
  freeLines: 3,
  breakRule: null,
  breakManual: false,
  lastBlockTag: "P",
  midWordSplit: false,
  anchorSplit: false,
  characterSplitCount: 0,
  shortLineCount: 0,
  sentenceCaseViolation: false,
  punctuationSplit: false,
  paragraphSplitAtBoundary: false,
  splitBeforeChar: "",
  splitAfterChar: "",
  ...overrides
});

test("evaluateExpectations flags new split/sparse/short-line violations by default", () => {
  withEnv(
    {
      LEDITOR_ALLOW_SENTENCE_CASE_SPLIT: null,
      LEDITOR_ALLOW_PUNCTUATION_SPLIT: null,
      LEDITOR_MAX_SHORT_LINES: 0,
      LEDITOR_MIN_LINE_CHARS: 5,
      LEDITOR_SPARSE_MIN_WORDS: 80,
      LEDITOR_SPARSE_MAX_FREE_LINES: 18,
      LEDITOR_SPARSE_MAX_FILL_RATIO_BOTTOM: 0.35
    },
    () => {
      const page = makePage({
        wordCount: 40,
        fillRatioBottom: 0.3,
        freeLines: 20,
        shortLineCount: 2,
        sentenceCaseViolation: true,
        sentenceCaseBeforeChar: ".",
        sentenceCaseAfterChar: "a",
        punctuationSplit: true,
        punctuationSplitPrevChar: "n",
        punctuationSplitChar: ","
      });
      const failures = evaluateExpectations([page], [{ pageIndex: 0, label: "p1" }]);
      const reasons = failures.map((entry) => String(entry.reason));
      assert.ok(reasons.some((reason) => reason.includes("sentenceCaseViolation")));
      assert.ok(reasons.some((reason) => reason.includes("punctuationSplit")));
      assert.ok(reasons.some((reason) => reason.includes("shortLineCount")));
      assert.ok(reasons.some((reason) => reason.includes("sparsePage")));
    }
  );
});

test("evaluateExpectations respects global allow flags and short-line threshold", () => {
  withEnv(
    {
      LEDITOR_ALLOW_SENTENCE_CASE_SPLIT: 1,
      LEDITOR_ALLOW_PUNCTUATION_SPLIT: 1,
      LEDITOR_MAX_SHORT_LINES: 3,
      LEDITOR_MIN_LINE_CHARS: 5
    },
    () => {
      const page = makePage({
        sentenceCaseViolation: true,
        punctuationSplit: true,
        shortLineCount: 2
      });
      const failures = evaluateExpectations([page], [{ pageIndex: 0, label: "p1" }]);
      assert.equal(failures.length, 0);
    }
  );
});

test("evaluateExpectations uses default paragraph-split free-line threshold", () => {
  withEnv(
    {
      LEDITOR_MAX_WHITESPACE_LINES: null,
      LEDITOR_MAX_PARAGRAPH_SPLIT_FREE_LINES: null
    },
    () => {
      const page0 = makePage({ pageIndex: 0, pageNumber: 1, freeLines: 9 });
      const page1 = makePage({ pageIndex: 1, pageNumber: 2, paragraphSplitAtBoundary: true });
      const relaxed = evaluateExpectations([page0, page1], [{ pageIndex: 1, label: "p2" }]);
      assert.ok(!relaxed.some((entry) => String(entry.reason).includes("paragraphSplit")));

      const strictPrev = makePage({ pageIndex: 0, pageNumber: 1, freeLines: 10 });
      const strict = evaluateExpectations([strictPrev, page1], [{ pageIndex: 1, label: "p2" }]);
      assert.ok(strict.some((entry) => String(entry.reason).includes("paragraphSplit")));
    }
  );
});

test("evaluateExpectations enforces watchlist thresholds for pages 16 and 23", () => {
  withEnv(
    {
      LEDITOR_MAX_WHITESPACE_RATIO: null,
      LEDITOR_MAX_WHITESPACE_LINES: null
    },
    () => {
      const pages = Array.from({ length: 24 }, (_, index) =>
        makePage({ pageIndex: index, pageNumber: index + 1 })
      );
      pages[15] = makePage({
        pageIndex: 15,
        pageNumber: 16,
        fillRatioBottom: 0.55
      });
      pages[22] = makePage({
        pageIndex: 22,
        pageNumber: 23,
        whiteSpaceRatio: 0.24,
        freeLines: 13
      });

      const failures = evaluateExpectations(pages, [
        { pageIndex: 15, label: "page16_watch", minFillRatioBottom: 0.6 },
        { pageIndex: 22, label: "page23_watch", maxWhiteSpaceRatio: 0.2, maxFreeLines: 11 }
      ]);

      assert.ok(
        failures.some(
          (entry) =>
            entry.label === "page16_watch" &&
            String(entry.reason).includes("fillRatioBottom")
        )
      );
      assert.ok(
        failures.some(
          (entry) =>
            entry.label === "page23_watch" &&
            String(entry.reason).includes("whiteSpaceRatio")
        )
      );
      assert.ok(
        failures.some(
          (entry) =>
            entry.label === "page23_watch" &&
            String(entry.reason).includes("freeLines")
        )
      );
    }
  );
});

test("evaluateExpectations exempts manual-break pages from sparse-page failures", () => {
  withEnv(
    {
      LEDITOR_SPARSE_MIN_WORDS: 80,
      LEDITOR_SPARSE_MAX_FREE_LINES: 18,
      LEDITOR_SPARSE_MAX_FILL_RATIO_BOTTOM: 0.35
    },
    () => {
      const page = makePage({
        pageIndex: 5,
        pageNumber: 6,
        wordCount: 30,
        freeLines: 21,
        fillRatioBottom: 0.3,
        breakManual: true,
        breakRule: "manual"
      });
      const failures = evaluateExpectations([page], [{ pageIndex: 5, label: "manual_break_sparse" }]);
      assert.ok(!failures.some((entry) => String(entry.reason).includes("sparsePage")));
    }
  );
});
