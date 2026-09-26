import { createHash } from "node:crypto";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { registerApiRoute } from "@mastra/core/server";
import { config } from "dotenv";
import { z } from "zod";
import {
  getCheckpoint,
  getExplanation,
  getLatestExplanation,
  getTransaction,
  getWorkerState,
  initializeStore,
  listTransactions,
  saveExplanation,
} from "../storage.js";

config({ quiet: true });

const model = process.env.GEMINI_MODEL || "google/gemini-3.1-pro-preview";
const promptVersion = "1";
const explanationSchema = z.object({
  summary: z.string().min(1).max(1500),
  evidence: z.array(z.string().min(1).max(500)).max(8),
  unknowns: z.array(z.string().min(1).max(500)).max(8),
});

export const transactionExplainer = new Agent({
  id: "transaction-explainer",
  name: "Transaction Explainer",
  model,
  instructions: `あなたは Base Sepolia のトランザクション解説者です。日本語で簡潔に答えてください。
入力 JSON にあるチェーン上の事実と Jev の推定を明確に分けてください。
Jev の確信度は正解率ではありません。ABI シグネチャの一致だけで規格準拠を断定しないでください。
取引が失敗なら意図と実行結果を分けてください。トークンの decimals が不明なら最小単位と説明してください。
ブラックリストの再判定や未確認のコントラクト内部処理の断定をしないでください。
evidence には入力 JSON の具体的なフィールド名と値を挙げ、unknowns には不明点を記載してください。`,
});

const inFlight = new Map<string, Promise<Record<string, unknown>>>();
let lastCallAt = 0;

async function explain(hash: string) {
  const tx = await getTransaction(hash);
  if (!tx) return null;
  const evidence = tx.result.evidence as Record<string, unknown>;
  const compact = {
    source: evidence.source,
    chainId: evidence.chainId,
    transaction: evidence.transaction,
    decodedInput: evidence.decodedInput,
    logs: Array.isArray(evidence.logs) ? evidence.logs.slice(0, 12) : [],
    blacklist: evidence.blacklist,
    analysisStatus: tx.result.analysisStatus,
    classification: tx.result.classification,
    jevModel: tx.result.model,
  };
  const input = JSON.stringify(compact);
  if (input.length > 24_000) throw new Error("説明用データが大きすぎます。");
  const cacheKey = createHash("sha256")
    .update(`${tx.id}:${model}:${promptVersion}:${input}`)
    .digest("hex");
  const cached = await getExplanation(cacheKey);
  if (cached) return { ...cached, cached: true };
  if (!process.env.GOOGLE_API_KEY)
    throw new Error("GOOGLE_API_KEY が未設定です。");
  const running = inFlight.get(cacheKey);
  if (running) return running;
  if (Date.now() - lastCallAt < 1500)
    throw new Error("連続リクエストを避け、少し待ってから再試行してください。");
  lastCallAt = Date.now();
  const task = (async () => {
    const startedAt = performance.now();
    const response = await transactionExplainer.generate(input, {
      structuredOutput: { schema: explanationSchema },
      abortSignal: AbortSignal.timeout(90_000),
    });
    const parsed = explanationSchema.parse(response.object);
    const result = {
      ...parsed,
      model,
      promptVersion,
      latencyMs: Math.round(performance.now() - startedAt),
      usage: response.usage || null,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
    await saveExplanation(cacheKey, tx.id, model, result);
    return result;
  })();
  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const ready = initializeStore();

export const mastra = new Mastra({
  agents: { transactionExplainer },
  server: {
    host: "127.0.0.1",
    apiPrefix: "/mastra/api",
    apiRoutes: [
      registerApiRoute("/api/health", {
        method: "GET",
        handler: async (c) => {
          await ready;
          const [worker, checkpoint] = await Promise.all([
            getWorkerState(),
            getCheckpoint(),
          ]);
          const stale =
            worker?.status === "running" &&
            Date.now() - Date.parse(worker.updatedAt) > 120_000;
          return c.json({
            chainId: 84532,
            worker: stale ? { ...worker, status: "disconnected" } : worker,
            checkpoint: checkpoint
              ? {
                  blockNumber: Number(checkpoint.number),
                  blockHash: checkpoint.hash,
                }
              : null,
            geminiConfigured: !!process.env.GOOGLE_API_KEY,
          });
        },
      }),
      registerApiRoute("/api/transactions", {
        method: "GET",
        handler: async (c) => {
          await ready;
          const query = c.req.query();
          const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
          const offset = Math.max(0, Number(query.offset) || 0);
          if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset))
            return c.json({ error: "invalid_pagination" }, 400);
          return c.json(
            await listTransactions({
              limit,
              offset,
              search: query.search?.slice(0, 66),
              operation: query.operation?.slice(0, 40),
              analysisStatus: query.analysisStatus?.slice(0, 40),
              blacklistStatus: query.blacklistStatus?.slice(0, 40),
            }),
          );
        },
      }),
      registerApiRoute("/api/transactions/events", {
        method: "GET",
        handler: async () => {
          await ready;
          let timer: ReturnType<typeof setInterval>;
          const body = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              let last = "";
              const tick = async () => {
                try {
                  const result = await listTransactions({
                    limit: 1,
                    offset: 0,
                  });
                  const current = `${result.items[0]?.id || ""}:${result.total}`;
                  if (current !== last) {
                    last = current;
                    controller.enqueue(
                      encoder.encode(
                        `event: update\ndata: ${JSON.stringify({ latestId: result.items[0]?.id || null, total: result.total })}\n\n`,
                      ),
                    );
                  } else controller.enqueue(encoder.encode(": keepalive\n\n"));
                } catch {
                  /* disconnect closes the stream */
                }
              };
              void tick();
              timer = setInterval(() => {
                void tick();
              }, 3000);
            },
            cancel() {
              clearInterval(timer);
            },
          });
          return new Response(body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        },
      }),
      registerApiRoute("/api/transactions/:hash", {
        method: "GET",
        handler: async (c) => {
          await ready;
          const hash = c.req.param("hash");
          if (!hashPattern.test(hash))
            return c.json({ error: "invalid_hash" }, 400);
          const tx = await getTransaction(hash);
          if (!tx) return c.json({ error: "not_found" }, 404);
          return c.json({
            ...tx,
            explanation: await getLatestExplanation(tx.id),
          });
        },
      }),
      registerApiRoute("/api/transactions/:hash/explanation", {
        method: "POST",
        handler: async (c) => {
          await ready;
          const hash = c.req.param("hash");
          if (!hashPattern.test(hash))
            return c.json({ error: "invalid_hash" }, 400);
          try {
            const explanation = await explain(hash);
            if (!explanation) return c.json({ error: "not_found" }, 404);
            return c.json({ explanation });
          } catch (error) {
            const rawMessage = error instanceof Error ? error.message : "";
            const message = rawMessage.includes("GOOGLE_API_KEY が未設定")
              ? "GOOGLE_API_KEY が未設定です。"
              : rawMessage.includes("連続リクエスト")
                ? "連続リクエストを避け、少し待ってから再試行してください。"
                : rawMessage.includes("説明用データが大きすぎ")
                  ? "説明用データが大きすぎます。"
                  : "Gemini の呼び出しに失敗しました。モデルの利用枠または設定を確認してください。";
            const status = message.includes("未設定")
              ? 503
              : message.includes("連続")
                ? 429
                : 502;
            return c.json({ error: "explanation_failed", message }, status);
          }
        },
      }),
    ],
  },
});
