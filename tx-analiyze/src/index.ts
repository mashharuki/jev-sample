import { parseArgs } from "node:util";
import { config } from "dotenv";
import type { Hash } from "viem";
import { analyzeEvidence } from "./analyze.js";
import { fetchEvidence } from "./chain.js";
import { demoEvidence } from "./demo.js";
import { outputMode, renderResult } from "./format.js";

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
      json: { type: "boolean" },
      text: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "pnpm analyze <0x transaction hash> [--decode-only] [--json|--text]\npnpm analyze --demo [--decode-only] [--json|--text]",
    );
    return;
  }
  const mode = outputMode({
    json: values.json,
    text: values.text,
    isTTY: process.stdout.isTTY,
  });

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

  const result = await analyzeEvidence(evidence, values["decode-only"]);
  console.log(
    renderResult(result, mode, {
      color: mode === "text" && !!process.stdout.isTTY && !process.env.NO_COLOR,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "実行に失敗しました。",
  );
  process.exitCode = 1;
});
