import { TypeSafeClient } from "@typesafe-ai/sdk";
import { jsonStringify } from "./decode.js";
import { questions } from "./questions.js";

/** 単発実行と監視モードで同じ分類処理を使用する。 */
export async function analyzeEvidence(evidence: unknown, decodeOnly = false) {
    if (decodeOnly) return { evidence, classification: null };

    const stateJson = jsonStringify(evidence);
    if (stateJson.length > 40_000) {
        throw new Error(
            "入力が大きすぎます。--decode-only で確認してください（MVP は 40,000 文字まで）。",
        );
    }
    try {
        const client = new TypeSafeClient({ timeout: 30_000 });
        const result = await client.systemOne({
            state: JSON.parse(stateJson),
            model: process.env.JEV_MODEL || "jev-latest",
            questions,
        });
        return {
            evidence,
            classification: { kind: "ai_estimate", ...result.answers },
            model: result.model,
            usage: result.usage,
        };
    } catch {
        throw new Error(
            "Jev の呼び出しに失敗しました。API キー、モデル名、利用枠、接続を確認してください。",
        );
    }
}
