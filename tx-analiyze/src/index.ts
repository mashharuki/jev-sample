import { parseArgs } from "node:util";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { config } from "dotenv";
import type { Hash } from "viem";
import { fetchEvidence } from "./chain.js";
import { jsonStringify } from "./decode.js";
import { demoEvidence } from "./demo.js";
import { questions } from "./questions.js";

config({ quiet: true });

/**
 * メイン関数
 * @returns
 */
async function main() {
    // コマンドライン引数を解析する
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            demo: { type: "boolean" },
            "decode-only": { type: "boolean" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help) {
        console.log(
            "pnpm analyze <0x transaction hash> [--decode-only]\npnpm analyze --demo [--decode-only]",
        );
        return;
    }

    // トランザクションハッシュの形式を検証する
    const hash = positionals[0];

    if (
        values.demo
            ? positionals.length > 0
            : positionals.length !== 1 || !/^0x[\da-fA-F]{64}$/.test(hash ?? "")
    ) {
        throw new Error(
            "64桁のトランザクションハッシュ、または --demo を指定してください。",
        );
    }

    if (!values["decode-only"] && !process.env.TYPESAFE_API_KEY)
        throw new Error(
            ".env に TYPESAFE_API_KEY を設定してください（デコードのみなら --decode-only）。",
        );

    if (!values.demo && !process.env.ALCHEMY_RPC_URL)
        throw new Error(
            ".env に Base Sepolia の ALCHEMY_RPC_URL を設定してください。",
        );

    let evidence: unknown;

    try {
        // デモモードかどうかで証拠を取得する
        evidence = values.demo
            ? demoEvidence()
            : await fetchEvidence(
                  // デモモードではない場合、fetchEvidence() を呼び出す
                  hash as Hash,
                  process.env.ALCHEMY_RPC_URL as string,
                  process.env.ETHEREUM_RPC_URL,
              );
    } catch {
        throw new Error(
            "トランザクションを取得できませんでした。RPC URL、Base Sepolia (84532)、ハッシュ、承認状況、過去ブロックへのアクセス権を確認してください。",
        );
    }

    if (values["decode-only"]) {
        console.log(jsonStringify({ evidence, classification: null }));
        return;
    }

    // Normalize bigint values before sending state; never include environment configuration.
    const stateJson = jsonStringify(evidence);

    if (stateJson.length > 40_000)
        throw new Error(
            "入力が大きすぎます。--decode-only で確認してください（MVP は 40,000 文字まで）。",
        );
    try {
        // Jev の呼び出し
        const client = new TypeSafeClient({ timeout: 30_000 });

        // Jev の呼び出し
        const result = await client.systemOne({
            state: JSON.parse(stateJson),
            model: process.env.JEV_MODEL || "jev-latest",
            questions,
        });

        // Jev の呼び出し結果を出力する
        console.log(
            jsonStringify({
                evidence,
                classification: { kind: "ai_estimate", ...result.answers },
                model: result.model,
                usage: result.usage,
            }),
        );
    } catch {
        throw new Error(
            "Jev の呼び出しに失敗しました。API キー、モデル名、利用枠、接続を確認してください。",
        );
    }
}

main().catch((error: unknown) => {
    console.error(
        error instanceof Error ? error.message : "実行に失敗しました。",
    );
    process.exitCode = 1;
});
