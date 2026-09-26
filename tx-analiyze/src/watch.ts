import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { analyzeEvidence } from "./analyze.js";
import { fetchEvidence } from "./chain.js";
import { outputMode, renderResult } from "./format.js";
import { integerOption, watchTransactions } from "./watcher.js";

config({ quiet: true });

async function main() {
    const { values } = parseArgs({
        options: {
            "decode-only": { type: "boolean" },
            json: { type: "boolean" },
            text: { type: "boolean" },
            limit: { type: "string" },
            "poll-ms": { type: "string" },
            confirmations: { type: "string" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help) {
        console.log(
            "pnpm watch [--limit 10] [--decode-only] [--json|--text] [--poll-ms 4000] [--confirmations 2]\n起動後の新規ブロックを順に判別します。既定は件数無制限。Ctrl+C で停止。",
        );
        return;
    }
    const limit =
        values.limit === undefined
            ? undefined
            : integerOption(values.limit, 10, 1);
    const pollMs = integerOption(values["poll-ms"], 4000, 1000);
    const confirmations = integerOption(values.confirmations, 2, 0);
    const mode = outputMode({
        json: values.json,
        text: values.text,
        isTTY: process.stdout.isTTY,
    });
    const rpcUrl = process.env.ALCHEMY_RPC_URL;
    if (!rpcUrl)
        throw new Error(
            ".env に Base Sepolia の ALCHEMY_RPC_URL を設定してください。",
        );
    if (!values["decode-only"] && !process.env.TYPESAFE_API_KEY)
        throw new Error(
            ".env に TYPESAFE_API_KEY を設定してください（デコードのみなら --decode-only）。",
        );

    const client = createPublicClient({
        chain: baseSepolia,
        transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
    });
    let chainId: number;
    try {
        chainId = await client.getChainId();
    } catch {
        throw new Error(
            "RPC に接続できませんでした。ALCHEMY_RPC_URL を確認してください。",
        );
    }
    if (chainId !== baseSepolia.id)
        throw new Error(
            "ALCHEMY_RPC_URL は Base Sepolia (84532) を指定してください。",
        );

    const controller = new AbortController();
    const stop = () => {
        if (!controller.signal.aborted)
            console.error(
                "停止要求を受け付けました。実行中の1件の完了を待ちます。",
            );
        controller.abort();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
        await watchTransactions({
            confirmations,
            limit,
            signal: controller.signal,
            getHead: () => client.getBlockNumber({ cacheTime: 0 }),
            getBlock: async (blockNumber) => {
                const block = await client.getBlock({ blockNumber });
                if (block.number === null || block.hash === null)
                    throw new Error("ブロック未確定");
                return {
                    number: block.number,
                    hash: block.hash,
                    parentHash: block.parentHash,
                    transactions: block.transactions,
                };
            },
            analyze: async (hash, blockHash) => {
                const evidence = await fetchEvidence(
                    hash,
                    rpcUrl,
                    process.env.ETHEREUM_RPC_URL,
                );
                if (evidence.transaction.blockHash !== blockHash)
                    throw new Error("取引のブロックが変化しました。");
                const result = await analyzeEvidence(
                    evidence,
                    values["decode-only"],
                );
                if (result.analysisStatus === "skipped") {
                    console.error(
                        `判別省略: ${hash}。${result.reason.message} (${result.reason.inputCharacters}文字)。次の取引へ進みます。`,
                    );
                }
                return result;
            },
            emit: (result) => {
                console.log(
                    renderResult(
                        result as Awaited<ReturnType<typeof analyzeEvidence>>,
                        mode,
                        {
                            stream: true,
                            color:
                                mode === "text" &&
                                !!process.stdout.isTTY &&
                                !process.env.NO_COLOR,
                        },
                    ),
                );
                if (mode === "text") console.log();
            },
            report: (message) => console.error(message),
            pause: async () => {
                try {
                    await setTimeout(pollMs, undefined, {
                        signal: controller.signal,
                    });
                } catch (error) {
                    if (!controller.signal.aborted) throw error;
                }
            },
        });
    } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
    }
}

main().catch((error: unknown) => {
    console.error(
        error instanceof Error ? error.message : "監視に失敗しました。",
    );
    process.exitCode = 1;
});
