import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hash } from "viem";
import { analyzeEvidence } from "../src/analyze.js";
import { jsonStringify } from "../src/decode.js";
import {
    integerOption,
    type WatchBlock,
    watchTransactions,
} from "../src/watcher.js";

const hash = (number: number) =>
    `0x${number.toString(16).padStart(64, "0")}` as Hash;

function setup() {
    const controller = new AbortController();
    const blocks: bigint[] = [];
    const analyzed: Hash[] = [];
    const output: unknown[] = [];
    const reports: string[] = [];
    const options = {
        confirmations: 1,
        limit: 3,
        signal: controller.signal,
        getHead: async (): Promise<bigint> => (blocks.length ? 14n : 10n),
        getBlock: async (number: bigint): Promise<WatchBlock> => {
            blocks.push(number);
            return {
                number,
                hash: hash(Number(number)),
                parentHash: hash(Number(number) - 1),
                transactions:
                    number === 11n
                        ? [hash(101), hash(102)]
                        : number === 13n
                          ? [hash(103), hash(104)]
                          : [],
            };
        },
        analyze: async (transaction: Hash, _blockHash: Hash) => {
            analyzed.push(transaction);
            return { hash: transaction };
        },
        emit: (result: unknown) => {
            output.push(result);
        },
        report: (message: string) => {
            reports.push(message);
        },
        pause: async (): Promise<void> => {
            throw new Error("unexpected wait");
        },
    };
    return { options, controller, blocks, analyzed, output, reports };
}

test("catch-up visits every block in order, handles empty blocks, stops at transaction limit", async () => {
    const run = setup();
    assert.equal(await watchTransactions(run.options), 3);
    assert.deepEqual(run.blocks, [10n, 11n, 12n, 13n]);
    assert.deepEqual(run.analyzed, [hash(101), hash(102), hash(103)]);
    assert.equal(run.output.length, 3);
});

test("resume verifies saved block and checkpoints only complete blocks after awaited writes", async () => {
    const run = setup();
    const completed: bigint[] = [];
    const events: string[] = [];
    await watchTransactions({
        ...run.options,
        resume: { number: 11n, hash: hash(11) },
        limit: 1,
        emit: async () => {
            events.push("saved");
        },
        onBlockCompleted: async (block) => {
            completed.push(block.number);
            events.push("checkpoint");
        },
    });
    assert.deepEqual(run.blocks, [11n, 12n, 13n]);
    assert.deepEqual(run.analyzed, [hash(103)]);
    assert.deepEqual(completed, [12n]);
    assert.deepEqual(events, ["checkpoint", "saved"]);
});

test("confirmation delay waits without processing the same head twice", async () => {
    const run = setup();
    const heads = [10n, 12n, 12n, 13n];
    let pauses = 0;
    run.options.confirmations = 2;
    run.options.limit = 1;
    run.options.getHead = async () => {
        const head = heads.shift();
        assert.notEqual(head, undefined);
        return head as bigint;
    };
    run.options.pause = async () => {
        pauses++;
    };
    await watchTransactions(run.options);
    assert.equal(pauses, 2);
    assert.deepEqual(run.blocks, [10n, 11n]);
    assert.deepEqual(run.analyzed, [hash(101)]);
});

test("oversized transaction emits a skipped result and monitoring continues to the limit", async () => {
    const run = setup();
    const count = await watchTransactions({
        ...run.options,
        analyze: async (transaction) => {
            run.analyzed.push(transaction);
            return transaction === hash(101)
                ? analyzeEvidence({ input: "a".repeat(50_000) })
                : analyzeEvidence({ hash: transaction }, true);
        },
    });
    assert.equal(count, 3);
    assert.deepEqual(run.analyzed, [hash(101), hash(102), hash(103)]);
    const results = run.output as { analysisStatus: string }[];
    assert.deepEqual(
        results.map((result) => result.analysisStatus),
        ["skipped", "decode_only", "decode_only"],
    );
});

test("abort during processing completes one result without starting another", async () => {
    const run = setup();
    const analyze = run.options.analyze;
    run.options.analyze = async (transaction, blockHash) => {
        run.controller.abort();
        return analyze(transaction, blockHash);
    };
    assert.equal(await watchTransactions(run.options), 1);
    assert.equal(run.analyzed.length, 1);
    assert.equal(run.output.length, 1);
});

test("abort while waiting exits without classifying old transactions", async () => {
    const run = setup();
    run.options.getHead = async () => 10n;
    run.options.pause = async () => {
        run.controller.abort();
    };
    assert.equal(await watchTransactions(run.options), 0);
    assert.deepEqual(run.blocks, [10n]);
});

test("parent hash mismatch stops rather than silently following a reorganization", async () => {
    const run = setup();
    const getBlock = run.options.getBlock;
    run.options.getBlock = async (number) => ({
        ...(await getBlock(number)),
        parentHash: hash(0),
    });
    await assert.rejects(watchTransactions(run.options), /連続性/);
    assert.equal(run.analyzed.length, 0);
});

test("classification failure reports the failed hash and does not skip to the next transaction", async () => {
    const run = setup();
    let calls = 0;
    run.options.analyze = async () => {
        calls++;
        throw new Error("secret-url");
    };
    await assert.rejects(watchTransactions(run.options), (error: Error) => {
        assert.ok(error.message.includes(hash(101)));
        assert.ok(!error.message.includes("secret-url"));
        return true;
    });
    assert.equal(calls, 1);
    assert.equal(run.output.length, 0);
});

test("transient RPC error retries the same block without duplicating classification", async () => {
    const run = setup();
    const getBlock = run.options.getBlock;
    let attempts = 0;
    run.options.getBlock = async (number) => {
        if (number === 11n && attempts++ === 0)
            throw new Error("temporarily unavailable");
        return getBlock(number);
    };
    run.options.pause = async () => {};
    await watchTransactions(run.options);
    assert.equal(run.analyzed.length, 3);
    assert.equal(new Set(run.analyzed).size, 3);
    assert.ok(run.reports.some((message) => message.includes("再試行")));
});

test("persistent RPC failure stops after three attempts and sanitizes errors", async () => {
    const run = setup();
    let attempts = 0;
    run.options.getHead = async () => {
        attempts++;
        throw new Error("secret-key");
    };
    run.options.pause = async () => {};
    await assert.rejects(watchTransactions(run.options), /RPC の取得に3回失敗/);
    assert.equal(attempts, 3);
    assert.equal(run.output.length, 0);
});

test("CLI integer settings reject invalid limits and intervals", () => {
    for (const value of ["-1", "0", "1.5", "NaN", "", "9007199254740992"]) {
        assert.throws(() => integerOption(value, 10, 1));
    }
    assert.equal(integerOption("0", 2, 0), 0);
    assert.equal(integerOption(undefined, 4000, 1000), 4000);
});

test("watch output is a single JSON line with bigint preserved", () => {
    const line = jsonStringify({ blockNumber: 100n }, 0);
    assert.equal(line.includes("\n"), false);
    assert.deepEqual(JSON.parse(line), { blockNumber: "100" });
});
