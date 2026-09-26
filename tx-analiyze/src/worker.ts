import { setTimeout } from "node:timers/promises";
import { config } from "dotenv";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { analyzeEvidence } from "./analyze.js";
import { fetchEvidence } from "./chain.js";
import {
  getCheckpoint,
  getFirstStoredBlock,
  getStoredInBlock,
  initializeStore,
  saveCheckpoint,
  saveTransaction,
  setWorkerState,
} from "./storage.js";
import { watchTransactions } from "./watcher.js";

config({ quiet: true });

async function main() {
  const rpcUrl = process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("ALCHEMY_RPC_URL を .env に設定してください。");
  const decodeOnly = process.argv.includes("--decode-only");
  const limitIndex = process.argv.indexOf("--limit");
  const limit =
    limitIndex === -1 ? undefined : Number(process.argv[limitIndex + 1]);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("--limit には1以上の整数を指定してください。");
  if (!decodeOnly && !process.env.TYPESAFE_API_KEY)
    throw new Error("TYPESAFE_API_KEY を .env に設定してください。");
  await initializeStore();
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });
  if ((await client.getChainId()) !== baseSepolia.id)
    throw new Error("Base Sepolia の RPC を指定してください。");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let resume = await getCheckpoint();
  if (!resume) {
    const firstStored = await getFirstStoredBlock();
    if (firstStored !== null && firstStored > 0n) {
      const prior = await client.getBlock({
        blockNumber: firstStored - 1n,
      });
      if (prior.hash) {
        resume = { number: firstStored - 1n, hash: prior.hash };
        await saveCheckpoint(resume.number, resume.hash);
      }
    }
  }
  await setWorkerState("running");
  try {
    await watchTransactions({
      confirmations: 2,
      limit,
      signal: controller.signal,
      resume,
      onStart: async (block) => {
        await saveCheckpoint(block.number, block.hash);
      },
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
        const stored = await getStoredInBlock(hash, blockHash);
        if (stored) return stored;
        const evidence = await fetchEvidence(
          hash,
          rpcUrl,
          process.env.ETHEREUM_RPC_URL,
        );
        if (evidence.transaction.blockHash !== blockHash)
          throw new Error("取引ブロックが変化しました。");
        return analyzeEvidence(evidence, decodeOnly);
      },
      emit: async (result) => {
        await saveTransaction(result as Parameters<typeof saveTransaction>[0]);
      },
      onBlockCompleted: async (block) => {
        await saveCheckpoint(block.number, block.hash);
        await setWorkerState("running", block.number);
      },
      report: (message) => console.error(message),
      pause: async () => {
        try {
          await setTimeout(4000, undefined, {
            signal: controller.signal,
          });
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
      },
    });
    await setWorkerState("stopped");
  } catch (error) {
    await setWorkerState(
      "error",
      undefined,
      error instanceof Error ? error.message : "監視エラー",
    );
    throw error;
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
