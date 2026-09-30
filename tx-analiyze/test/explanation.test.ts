import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explanationResponseSchema,
  normalizeExplanation,
} from "../src/explanation.js";

test("Gemini can return nine evidence items without failing generation validation", () => {
  const response = {
    summary: "取引は成功しました。",
    evidence: Array.from(
      { length: 9 },
      (_, i) => `transaction.field${i}: value`,
    ),
    unknowns: Array.from({ length: 10 }, (_, i) => `不明点${i}`),
  };
  const validated = explanationResponseSchema.parse(response);
  const normalized = normalizeExplanation(validated);
  assert.deepEqual(normalized, {
    summary: response.summary,
    evidence: response.evidence.slice(0, 8),
    unknowns: response.unknowns.slice(0, 8),
  });
  assert.equal(validated.evidence.length, 9);
});

test("short explanations and empty unknown lists are preserved", () => {
  const response = {
    summary: "取引は成功しました。",
    evidence: ["transaction.status: success"],
    unknowns: [],
  };
  assert.deepEqual(normalizeExplanation(response), response);
});

test("normalization still rejects malformed content, including discarded items", () => {
  const valid = { summary: "説明", evidence: [], unknowns: [] };
  for (const invalid of [
    { ...valid, summary: "" },
    { ...valid, summary: "あ".repeat(1501) },
    { ...valid, evidence: "invalid" },
    { ...valid, evidence: [...Array(8).fill("根拠"), 9] },
    { ...valid, evidence: ["あ".repeat(501)] },
    { ...valid, unknowns: [""] },
    { summary: "説明", evidence: [] },
  ]) {
    assert.throws(() => normalizeExplanation(invalid));
  }
});
