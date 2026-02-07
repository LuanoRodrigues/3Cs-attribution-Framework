import assert from "assert";
import { z } from "zod";

const classifySchema = z.object({
  route: z.enum(["edit", "internal_qa", "external_fact", "general"]).default("edit"),
  needsSearch: z.boolean().default(false),
  needsCode: z.boolean().default(false),
  reason: z.string().optional()
});

type Case = { input: unknown; expect: { route: string; needsSearch: boolean; needsCode: boolean } };

const cases: Case[] = [
  { input: { route: "edit" }, expect: { route: "edit", needsSearch: false, needsCode: false } },
  { input: { route: "internal_qa", needsSearch: true }, expect: { route: "internal_qa", needsSearch: true, needsCode: false } },
  { input: { route: "external_fact", needsCode: true }, expect: { route: "external_fact", needsSearch: false, needsCode: true } },
  { input: {}, expect: { route: "edit", needsSearch: false, needsCode: false } }
];

const run = () => {
  for (const [idx, testCase] of cases.entries()) {
    const parsed = classifySchema.parse(testCase.input);
    assert.strictEqual(parsed.route, testCase.expect.route, `case ${idx} route`);
    assert.strictEqual(parsed.needsSearch, testCase.expect.needsSearch, `case ${idx} needsSearch`);
    assert.strictEqual(parsed.needsCode, testCase.expect.needsCode, `case ${idx} needsCode`);
  }
  return true;
};

if (require.main === module) {
  try {
    run();
    console.log("agent_router_test ok");
  } catch (error) {
    console.error("agent_router_test failed", error);
    process.exit(1);
  }
}

export { run };
