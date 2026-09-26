import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { demoEvidence } from "../src/demo.js";
import type { AnalysisResult } from "../src/format.js";
import { outputMode, renderResult } from "../src/format.js";

function demoResult(): AnalysisResult {
  return {
    evidence: demoEvidence(),
    analysisStatus: "completed",
    classification: {
      kind: "ai_estimate",
      operation: {
        type: "choice",
        choice: "transfer",
        confidence: 0.99,
        probabilities: { transfer: 1 },
      },
    },
    model: "jev-1.13.0",
    usage: { input_tokens: 10, output_tokens: 2 },
  } as unknown as AnalysisResult;
}

test("readable demo output shows the decision, evidence and raw token units", () => {
  const text = renderResult(demoResult(), "text");
  assert.match(text, /トークン・資産の送金（Jevの確信度 99%）/);
  assert.match(text, /ERC-20 transfer（ABI候補）/);
  assert.match(text, /1,000,000（最小単位）/);
  assert.match(text, /架空のデモデータ/);
  assert.match(text, /ブラックリスト\s+未確認/);
  assert.ok(!text.includes("\u001b["));
});

test("unknown, skipped and decode-only never claim a completed decision", () => {
  const demo = demoResult();
  const unknown = renderResult(
    {
      ...demo,
      classification: {
        kind: "ai_estimate",
        operation: { choice: "unknown", confidence: 0.91 },
      },
    } as AnalysisResult,
    "text",
  );
  assert.match(unknown, /判別できず/);
  assert.match(unknown, /根拠が不足/);

  const skipped = renderResult(
    {
      evidence: demo.evidence,
      classification: null,
      analysisStatus: "skipped",
      reason: {
        code: "input_too_large",
        message: "入力が大きすぎます。",
        inputCharacters: 52_297,
        maxCharacters: 40_000,
      },
    } as AnalysisResult,
    "text",
  );
  assert.match(skipped, /判別省略/);
  assert.match(skipped, /52297文字/);
  assert.ok(!skipped.includes("確信度"));

  const decoded = renderResult(
    {
      evidence: demo.evidence,
      classification: null,
      analysisStatus: "decode_only",
    },
    "text",
  );
  assert.match(decoded, /デコードのみ/);
});

test("ABI ambiguity and blacklist status are shown without asserting a single standard", () => {
  const result = demoResult();
  const evidence = structuredClone(result.evidence) as ReturnType<
    typeof demoEvidence
  >;
  evidence.decodedInput.candidates = [
    { standard: "ERC-20", functionName: "transferFrom", args: [] },
    { standard: "ERC-721", functionName: "transferFrom", args: [] },
  ] as typeof evidence.decodedInput.candidates;
  evidence.blacklist = {
    status: "checked",
    listed: false,
    blockNumber: 123n,
  } as unknown as typeof evidence.blacklist;
  const text = renderResult({ ...result, evidence } as AnalysisResult, "text");
  assert.match(text, /ERC-20 transferFrom \/ ERC-721 transferFrom（ABI候補）/);
  assert.match(
    text,
    /Ethereum参照リストに該当なし（照合時点: ブロック 123、直接の宛先のみ）/,
  );
  assert.ok(!text.includes("ERC-20送付量"));
});

test("JSON and JSON Lines retain the complete result and contain no terminal color", () => {
  const result = demoResult();
  const pretty = renderResult(result, "json", { color: true });
  const line = renderResult(result, "json", { stream: true, color: true });
  assert.equal(JSON.parse(pretty).classification.operation.choice, "transfer");
  assert.equal(
    JSON.parse(line).evidence.decodedInput.candidates[0].args[1],
    "1000000",
  );
  assert.equal(line.includes("\n"), false);
  assert.ok(!line.includes("\u001b["));
});

test("TTY selection keeps redirected output machine-readable", () => {
  assert.equal(outputMode({ isTTY: true }), "text");
  assert.equal(outputMode({ isTTY: false }), "json");
  assert.equal(outputMode({ isTTY: false, text: true }), "text");
  assert.equal(outputMode({ isTTY: true, json: true }), "json");
  assert.throws(() => outputMode({ json: true, text: true }), /同時に指定/);
});

test("CLI text mode renders the demo without API keys", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/index.ts", "--demo", "--decode-only", "--text"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /デコードのみ/);
  assert.match(result.stdout, /ERC-20送付量\s+1,000,000（最小単位）/);
});
