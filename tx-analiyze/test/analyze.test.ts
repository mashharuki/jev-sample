import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeEvidence } from "../src/analyze.js";

test("oversized evidence is preserved and explicitly skipped without calling Jev", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected network request");
  });
  const evidence = { input: `0x${"ff".repeat(25_000)}` };
  const result = await analyzeEvidence(evidence);
  assert.equal(result.analysisStatus, "skipped");
  assert.equal(result.classification, null);
  assert.equal(result.evidence, evidence);
  assert.equal(calls, 0);
  if (result.analysisStatus === "skipped") {
    assert.equal(result.reason.code, "input_too_large");
    assert.ok(result.reason.inputCharacters > result.reason.maxCharacters);
  }
});

test("decode-only stays distinct from an oversized classification skip", async () => {
  const result = await analyzeEvidence({ input: "a".repeat(50_000) }, true);
  assert.equal(result.analysisStatus, "decode_only");
  assert.equal(result.classification, null);
});
