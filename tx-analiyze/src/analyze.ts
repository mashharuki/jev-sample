import { TypeSafeClient } from "@typesafe-ai/sdk";
import { jsonStringify } from "./decode.js";
import { questions } from "./questions.js";

/** 単発実行と監視モードで同じ分類処理を使用する。 */
export async function analyzeEvidence(evidence: unknown, decodeOnly = false) {
  if (decodeOnly)
    return {
      evidence,
      classification: null,
      analysisStatus: "decode_only" as const,
    };

  const stateJson = jsonStringify(evidence);
  if (stateJson.length > 40_000) {
    return {
      evidence,
      classification: null,
      analysisStatus: "skipped" as const,
      reason: {
        code: "input_too_large",
        message: "入力が40,000文字を超えたため、Jev の判別を省略しました。",
        inputCharacters: stateJson.length,
        maxCharacters: 40_000,
      },
    };
  }
  const startedAt = performance.now();
  try {
    const client = new TypeSafeClient({ timeout: 30_000 });
    const result = await client.systemOne({
      state: JSON.parse(stateJson),
      model: process.env.JEV_MODEL || "jev-latest",
      questions,
    });
    return {
      evidence,
      analysisStatus: "completed" as const,
      classification: { kind: "ai_estimate", ...result.answers },
      model: result.model,
      usage: result.usage,
      jevLatencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    throw new Error(
      "Jev の呼び出しに失敗しました。API キー、モデル名、利用枠、接続を確認してください。",
    );
  }
}
