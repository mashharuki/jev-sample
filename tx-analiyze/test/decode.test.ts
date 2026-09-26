import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
    encodeAbiParameters,
    encodeEventTopics,
    encodeFunctionData,
    erc20Abi,
    erc721Abi,
    type Hex,
} from "viem";
import { checkBlacklist, isListed } from "../src/chain.js";
import {
    decodeInput,
    decodeLogs,
    jsonStringify,
    transactionKind,
} from "../src/decode.js";
import { demoEvidence } from "../src/demo.js";

const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";

test("ERC-20 transfer decodes without losing integer precision", () => {
    const amount = 2n ** 200n;
    const input = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, amount],
    });
    const decoded = decodeInput(input);
    assert.equal(decoded.status, "matched_signatures");
    assert.equal(decoded.candidates[0]?.functionName, "transfer");
    assert.ok(jsonStringify(decoded).includes(amount.toString()));
});

test("shared transferFrom signature preserves ERC-20 / ERC-721 ambiguity", () => {
    const input = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transferFrom",
        args: [from, to, 42n],
    });
    assert.deepEqual(
        decodeInput(input).candidates.map((item) => item.standard),
        ["ERC-20", "ERC-721"],
    );
});

test("unknown, malformed and empty inputs are not invented", () => {
    assert.equal(decodeInput("0xdeadbeef").status, "unknown");
    assert.equal(decodeInput("0xa9059cbb").status, "unknown");
    assert.equal(decodeInput("0x").status, "empty");
});

test("indexed tokenId distinguishes ERC-721 Transfer from ERC-20", () => {
    const logs = decodeLogs([
        {
            address: to,
            data: "0x",
            topics: encodeEventTopics({
                abi: erc721Abi,
                eventName: "Transfer",
                args: { from, to, tokenId: 42n },
            }) as Hex[],
        },
    ]);
    assert.deepEqual(
        logs[0]?.candidates.map((item) => item.standard),
        ["ERC-721"],
    );
    assert.equal(demoEvidence().logs[0]?.candidates[0]?.standard, "ERC-20");
});

test("unknown event data is retained for inspection", () => {
    const logs = decodeLogs([{ address: to, data: "0xab", topics: [] }]);
    assert.deepEqual(logs[0]?.candidates, []);
    assert.equal(logs[0]?.data, "0xab");
});

test("contract creation and payable empty-input calls are distinguished", () => {
    assert.equal(
        transactionKind(null, "0x1234", undefined),
        "contract_creation",
    );
    assert.equal(transactionKind(to, "0x", "0x6000"), "contract_call");
    assert.equal(transactionKind(to, "0x", "0x"), "native_transfer_or_noop");
    assert.equal(
        transactionKind(to, "0x1234", undefined),
        "data_to_address_without_code",
    );
});

test("blacklist matching is case insensitive", () => {
    assert.equal(
        isListed("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", [
            "0xABCDEFabcdefabcdefabcdefabcdefabcdefabcd",
        ]),
        true,
    );
    assert.equal(isListed(to, [from]), false);
});

test("missing blacklist config is unknown, creation is not applicable", async () => {
    assert.equal((await checkBlacklist(to)).status, "unknown");
    assert.equal((await checkBlacklist(null)).status, "not_applicable");
});

test("blacklist RPC reads the list on chain 1 at a recorded block", async (t) => {
    const methods: string[] = [];
    t.mock.method(
        globalThis,
        "fetch",
        async (_url: unknown, options: RequestInit) => {
            const request = JSON.parse(options.body as string);
            methods.push(request.method);
            const results: Record<string, unknown> = {
                eth_chainId: "0x1",
                eth_blockNumber: "0x10",
                eth_call: encodeAbiParameters([{ type: "address[]" }], [[to]]),
            };
            if (request.method === "eth_call")
                assert.equal(request.params[1], "0x10");
            return Response.json({
                jsonrpc: "2.0",
                id: request.id,
                result: results[request.method],
            });
        },
    );
    const result = await checkBlacklist(to, "https://example.invalid");
    assert.equal(result.status, "checked");
    assert.equal("listed" in result && result.listed, true);
    assert.deepEqual(methods, ["eth_chainId", "eth_blockNumber", "eth_call"]);
});

test("wrong blacklist chain remains unknown instead of false", async (t) => {
    t.mock.method(
        globalThis,
        "fetch",
        async (_url: unknown, options: RequestInit) => {
            const request = JSON.parse(options.body as string);
            return Response.json({
                jsonrpc: "2.0",
                id: request.id,
                result: "0x14a34",
            });
        },
    );
    const result = await checkBlacklist(to, "https://example.invalid/secret");
    assert.equal(result.status, "unknown");
    assert.equal("listed" in result, false);
    assert.ok(!jsonStringify(result).includes("secret"));
});

test("demo CLI emits parseable JSON without keys or network", () => {
    const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/index.ts", "--demo", "--decode-only"],
        { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(
        output.evidence.source,
        "synthetic_demo_not_a_real_transaction",
    );
    assert.equal(output.classification, null);
});

test("invalid hash exits before attempting RPC", () => {
    const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/index.ts", "bad-hash", "--decode-only"],
        { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /64桁/);
});
