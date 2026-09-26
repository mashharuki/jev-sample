import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { StoredResult } from "../src/storage.js";

const directory = mkdtempSync(join(tmpdir(), "tx-monitor-store-"));
process.env.TX_DB_PATH = join(directory, "test.db");
const store = await import("../src/storage.js");
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;

await store.initializeStore();

test("SQLite keeps one record per transaction and persists block progress", async () => {
  const result: StoredResult = {
    evidence: {
      chainId: 84532,
      transaction: {
        hash,
        blockNumber: "42",
        blockHash,
        status: "success",
      },
      blacklist: { status: "unknown" },
    },
    classification: { operation: { choice: "transfer" } },
    analysisStatus: "completed",
  };
  const id = await store.saveTransaction(result);
  await store.saveTransaction(result);
  assert.equal(
    (await store.listTransactions({ limit: 10, offset: 0 })).total,
    1,
  );
  assert.equal((await store.getTransaction(hash))?.id, id);
  assert.equal(
    (await store.getStoredInBlock(hash, blockHash))?.analysisStatus,
    "completed",
  );
  assert.equal(await store.getFirstStoredBlock(), 42n);
  await store.saveCheckpoint(42n, blockHash);
  assert.deepEqual(await store.getCheckpoint(), {
    number: 42n,
    hash: blockHash,
  });
  await store.setWorkerState("running", 42n);
  assert.equal((await store.getWorkerState())?.head, 42);
  await store.saveExplanation(
    "cache-key",
    id,
    "google/gemini-3.1-pro-preview",
    {
      summary: "説明",
    },
  );
  assert.equal((await store.getExplanation("cache-key"))?.cached, true);
  const explanation = await store.getLatestExplanation(id);
  assert.equal(
    (explanation as Record<string, unknown> | null)?.summary,
    "説明",
  );
  assert.equal((await store.getLatestExplanation(id))?.cached, true);
});

test.after(() => {
  rmSync(directory, { recursive: true, force: true });
});
