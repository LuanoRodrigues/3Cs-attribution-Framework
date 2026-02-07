import assert from "assert";
import { applyEditsToText, extractParagraphsFromMarkedText, normalizeEdits } from "./agent_utils";

const run = () => {
  const base = "Hello world";
  const edits = normalizeEdits(
    [
      { action: "replace", start: 6, end: 11, text: "there" }
    ],
    base.length
  );
  assert.strictEqual(applyEditsToText(base, edits), "Hello there");

  const marked = "<<<P:1>>>First\n<<<P:2>>>Second";
  const map = extractParagraphsFromMarkedText(marked);
  assert.strictEqual(map.get(1), "First");
  assert.strictEqual(map.get(2), "Second");

  let threw = false;
  try {
    normalizeEdits(
      [
        { action: "replace", start: 0, end: 5, text: "A" },
        { action: "replace", start: 4, end: 6, text: "B" }
      ],
      10
    );
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, true, "overlapping edits should throw");
};

if (require.main === module) {
  try {
    run();
    console.log("agent_utils_test ok");
  } catch (error) {
    console.error("agent_utils_test failed", error);
    process.exit(1);
  }
}

export { run };
