import type { Hash } from "viem";

export type WatchBlock = {
    number: bigint;
    hash: Hash;
    parentHash: Hash;
    transactions: readonly Hash[];
};

type WatchOptions = {
    confirmations: number;
    limit?: number;
    signal: AbortSignal;
    getHead: () => Promise<bigint>;
    getBlock: (number: bigint) => Promise<WatchBlock>;
    analyze: (hash: Hash, blockHash: Hash) => Promise<unknown>;
    emit: (result: unknown) => void;
    report: (message: string) => void;
    pause: () => Promise<void>;
};

/** ブロック番号を順に処理し、並列キューを作らずに取りこぼしを防ぐ。 */
export async function watchTransactions(options: WatchOptions) {
    const { signal, getHead, getBlock, analyze, emit, report, pause } = options;
    let processed = 0;

    // RPC の一時的な失敗は同じ位置から再試行する。分類 API はここでは再試行しない。
    async function read<T>(
        operation: () => Promise<T>,
    ): Promise<T | undefined> {
        for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt++) {
            try {
                return await operation();
            } catch {
                if (attempt === 3)
                    throw new Error(
                        "RPC の取得に3回失敗したため監視を停止しました。",
                    );
                report(`RPC 取得失敗。再試行します (${attempt}/3)。`);
                await pause();
            }
        }
        return undefined;
    }

    const initialHead = await read(getHead);
    if (initialHead === undefined) return processed;
    let previous = await read(() => getBlock(initialHead));
    if (!previous || signal.aborted) return processed;
    let next = initialHead + 1n;
    report(
        `監視開始: ブロック ${next} から、後続 ${options.confirmations} ブロックを待って処理します。Ctrl+C で停止。`,
    );

    while (
        !signal.aborted &&
        (options.limit === undefined || processed < options.limit)
    ) {
        const head = await read(getHead);
        if (head === undefined || signal.aborted) break;
        const eligibleHead = head - BigInt(options.confirmations);
        if (next > eligibleHead) {
            await pause();
            continue;
        }
        const block = await read(() => getBlock(next));
        if (!block || signal.aborted) break;
        if (block.number !== next || block.parentHash !== previous.hash) {
            throw new Error(
                `ブロック ${next} の連続性が失われました（再編成または RPC 不整合）。監視を停止します。`,
            );
        }
        report(
            `ブロック ${next}: ${block.transactions.length} 件。後続の処理待ち ${eligibleHead - next} ブロック。`,
        );
        for (const hash of block.transactions) {
            if (
                signal.aborted ||
                (options.limit !== undefined && processed >= options.limit)
            )
                break;
            try {
                const result = await analyze(hash, block.hash);
                emit(result);
                processed++;
            } catch {
                throw new Error(
                    `判別失敗: ${hash} (ブロック ${next})。未処理の取引を飛ばさず停止します。pnpm analyze ${hash} で詳細を確認してください。`,
                );
            }
        }
        previous = block;
        next++;
    }
    report(`監視終了: ${processed} 件処理しました。`);
    return processed;
}

export function integerOption(
    value: string | undefined,
    fallback: number,
    minimum: number,
) {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(number) ||
        number < minimum
    ) {
        throw new Error(
            `オプションには ${minimum} 以上の整数を指定してください。`,
        );
    }
    return number;
}
