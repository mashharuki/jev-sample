import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { jsonStringify } from "./decode.js";

function projectRoot() {
    let current = process.cwd();
    for (;;) {
        const manifest = resolve(current, "package.json");
        if (existsSync(manifest)) {
            try {
                if (
                    JSON.parse(readFileSync(manifest, "utf8")).name ===
                    "tx-analiyze"
                )
                    return current;
            } catch {
                /* keep searching parents */
            }
        }
        const parent = dirname(current);
        if (parent === current)
            throw new Error("tx-analiyze のルートが見つかりません。");
        current = parent;
    }
}

const dbPath = resolve(
    projectRoot(),
    process.env.TX_DB_PATH || "./data/transactions.db",
);
mkdirSync(dirname(dbPath), { recursive: true });
const db = createClient({ url: `file:${dbPath}` });

export async function initializeStore() {
    await db.batch(
        [
            `CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, hash TEXT NOT NULL,
            block_number INTEGER NOT NULL, block_hash TEXT NOT NULL,
            operation TEXT NOT NULL, analysis_status TEXT NOT NULL,
            tx_status TEXT NOT NULL, blacklist_status TEXT NOT NULL,
            recorded_at TEXT NOT NULL, result_json TEXT NOT NULL)`,
            "CREATE INDEX IF NOT EXISTS tx_latest ON transactions(block_number DESC, hash DESC)",
            "CREATE INDEX IF NOT EXISTS tx_hash ON transactions(hash)",
            `CREATE TABLE IF NOT EXISTS checkpoint (
            id INTEGER PRIMARY KEY CHECK(id = 1), block_number INTEGER NOT NULL,
            block_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS worker_state (
            id INTEGER PRIMARY KEY CHECK(id = 1), status TEXT NOT NULL,
            head INTEGER, message TEXT, updated_at TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS explanations (
            cache_key TEXT PRIMARY KEY, tx_id TEXT NOT NULL, model TEXT NOT NULL,
            created_at TEXT NOT NULL, result_json TEXT NOT NULL)`,
        ],
        "write",
    );
}

export type StoredResult = {
    evidence: {
        chainId: number;
        transaction: {
            hash?: string;
            blockNumber?: string;
            blockHash?: string;
            status: string;
        };
        blacklist: { status: string };
    };
    classification?: { operation?: { choice?: string } } | null;
    analysisStatus: string;
    [key: string]: unknown;
};

export async function saveTransaction(result: StoredResult) {
    const { evidence } = result;
    const tx = evidence.transaction;
    if (!tx.hash || !tx.blockHash || !tx.blockNumber)
        throw new Error("保存する取引のハッシュとブロック番号がありません。");
    const id = `${evidence.chainId}:${tx.hash.toLowerCase()}:${tx.blockHash.toLowerCase()}`;
    await db.execute({
        sql: `INSERT OR REPLACE INTO transactions
          (id, chain_id, hash, block_number, block_hash, operation, analysis_status,
           tx_status, blacklist_status, recorded_at, result_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            id,
            evidence.chainId,
            tx.hash.toLowerCase(),
            Number(tx.blockNumber),
            tx.blockHash.toLowerCase(),
            result.classification?.operation?.choice || "unknown",
            result.analysisStatus,
            tx.status,
            evidence.blacklist.status,
            new Date().toISOString(),
            jsonStringify(result),
        ],
    });
    return id;
}

export async function listTransactions(options: {
    limit: number;
    offset: number;
    search?: string;
    operation?: string;
    analysisStatus?: string;
    blacklistStatus?: string;
}) {
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (options.search) {
        clauses.push("hash LIKE ?");
        args.push(`%${options.search.toLowerCase()}%`);
    }
    if (options.operation) {
        clauses.push("operation = ?");
        args.push(options.operation);
    }
    if (options.analysisStatus) {
        clauses.push("analysis_status = ?");
        args.push(options.analysisStatus);
    }
    if (options.blacklistStatus) {
        clauses.push("blacklist_status = ?");
        args.push(options.blacklistStatus);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
        db.execute({
            sql: `SELECT count(*) AS count FROM transactions ${where}`,
            args,
        }),
        db.execute({
            sql: `SELECT id, hash, block_number, operation, analysis_status,
            tx_status, blacklist_status, recorded_at FROM transactions ${where}
            ORDER BY block_number DESC, hash DESC LIMIT ? OFFSET ?`,
            args: [...args, options.limit, options.offset],
        }),
    ]);
    return {
        total: Number(count.rows[0]?.count || 0),
        items: rows.rows.map((row) => ({
            id: String(row.id),
            hash: String(row.hash),
            blockNumber: Number(row.block_number),
            operation: String(row.operation),
            analysisStatus: String(row.analysis_status),
            txStatus: String(row.tx_status),
            blacklistStatus: String(row.blacklist_status),
            recordedAt: String(row.recorded_at),
        })),
    };
}

export async function getTransaction(hash: string) {
    const row = await db.execute({
        sql: `SELECT id, result_json, recorded_at FROM transactions WHERE hash = ?
              ORDER BY block_number DESC LIMIT 1`,
        args: [hash.toLowerCase()],
    });
    if (!row.rows[0]) return null;
    return {
        id: String(row.rows[0].id),
        recordedAt: String(row.rows[0].recorded_at),
        result: JSON.parse(String(row.rows[0].result_json)) as StoredResult,
    };
}

export async function getStoredInBlock(hash: string, blockHash: string) {
    const row = (
        await db.execute({
            sql: "SELECT result_json FROM transactions WHERE hash = ? AND block_hash = ? LIMIT 1",
            args: [hash.toLowerCase(), blockHash.toLowerCase()],
        })
    ).rows[0];
    return row ? (JSON.parse(String(row.result_json)) as StoredResult) : null;
}

export async function getFirstStoredBlock() {
    const row = (
        await db.execute(
            "SELECT min(block_number) AS block_number FROM transactions",
        )
    ).rows[0];
    return row?.block_number === null || row?.block_number === undefined
        ? null
        : BigInt(Number(row.block_number));
}

export async function saveCheckpoint(number: bigint, hash: string) {
    await db.execute({
        sql: `INSERT INTO checkpoint VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET block_number=excluded.block_number,
        block_hash=excluded.block_hash, updated_at=excluded.updated_at`,
        args: [Number(number), hash, new Date().toISOString()],
    });
}

export async function getCheckpoint() {
    const row = (
        await db.execute(
            "SELECT block_number, block_hash FROM checkpoint WHERE id = 1",
        )
    ).rows[0];
    return row
        ? {
              number: BigInt(Number(row.block_number)),
              hash: String(row.block_hash) as `0x${string}`,
          }
        : undefined;
}

export async function setWorkerState(
    status: string,
    head?: bigint,
    message?: string,
) {
    await db.execute({
        sql: `INSERT INTO worker_state VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, head=excluded.head,
        message=excluded.message, updated_at=excluded.updated_at`,
        args: [
            status,
            head === undefined ? null : Number(head),
            message || null,
            new Date().toISOString(),
        ],
    });
}

export async function getWorkerState() {
    const row = (await db.execute("SELECT * FROM worker_state WHERE id = 1"))
        .rows[0];
    return row
        ? {
              status: String(row.status),
              head: row.head === null ? null : Number(row.head),
              message: row.message === null ? null : String(row.message),
              updatedAt: String(row.updated_at),
          }
        : null;
}

export async function getExplanation(cacheKey: string) {
    const row = (
        await db.execute({
            sql: "SELECT result_json FROM explanations WHERE cache_key = ?",
            args: [cacheKey],
        })
    ).rows[0];
    return row
        ? {
              ...(JSON.parse(String(row.result_json)) as Record<
                  string,
                  unknown
              >),
              cached: true,
          }
        : null;
}

export async function saveExplanation(
    cacheKey: string,
    txId: string,
    model: string,
    result: unknown,
) {
    await db.execute({
        sql: `INSERT OR REPLACE INTO explanations VALUES (?, ?, ?, ?, ?)`,
        args: [
            cacheKey,
            txId,
            model,
            new Date().toISOString(),
            JSON.stringify(result),
        ],
    });
}

export async function getLatestExplanation(txId: string) {
    const row = (
        await db.execute({
            sql: `SELECT result_json FROM explanations WHERE tx_id = ?
        ORDER BY created_at DESC LIMIT 1`,
            args: [txId],
        })
    ).rows[0];
    return row
        ? {
              ...(JSON.parse(String(row.result_json)) as Record<
                  string,
                  unknown
              >),
              cached: true,
          }
        : null;
}
