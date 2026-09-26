import { formatEther } from "viem";
import type { analyzeEvidence } from "./analyze.js";
import { jsonStringify } from "./decode.js";

export type AnalysisResult = Awaited<ReturnType<typeof analyzeEvidence>>;
export type OutputMode = "text" | "json";

const operationLabels: Record<string, string> = {
    transfer: "トークン・資産の送金",
    approval: "利用許可の変更",
    swap: "資産の交換",
    bridge: "別チェーンへの移転",
    mint: "発行",
    burn: "焼却",
    account_abstraction: "アカウント抽象化の処理",
    contract_creation: "コントラクト作成",
    other: "その他の操作",
    unknown: "判別できず",
};

type EvidenceView = {
    source?: string;
    transaction?: {
        hash?: string;
        blockNumber?: string;
        from?: string;
        to?: string | null;
        status?: string;
        kind?: string;
        valueWei?: string;
    };
    decodedInput?: {
        status?: string;
        selector?: string;
        candidates?: {
            standard: string;
            functionName: string;
            args?: unknown[];
        }[];
    };
    logs?: {
        candidates?: {
            standard: string;
            eventName: string;
            args?: Record<string, unknown>;
        }[];
    }[];
    blacklist?: {
        status?: string;
        listed?: boolean;
        blockNumber?: string | bigint;
        reason?: string;
    };
};

/** A pipe keeps the existing machine-readable format unless --text is explicit. */
export function outputMode(options: {
    json?: boolean;
    text?: boolean;
    isTTY?: boolean;
}): OutputMode {
    if (options.json && options.text)
        throw new Error("--json と --text は同時に指定できません。");
    if (options.json) return "json";
    if (options.text) return "text";
    return options.isTTY ? "text" : "json";
}

export function renderResult(
    result: AnalysisResult,
    mode: OutputMode,
    options: { stream?: boolean; color?: boolean } = {},
) {
    if (mode === "json") return jsonStringify(result, options.stream ? 0 : 2);
    return renderText(result, options.color ?? false);
}

function renderText(result: AnalysisResult, color: boolean) {
    const evidence = result.evidence as EvidenceView;
    const transaction = evidence.transaction;
    const operation = result.classification?.operation;
    const choice = operation?.choice;
    const label =
        result.analysisStatus === "skipped"
            ? "判別省略"
            : result.analysisStatus === "decode_only"
              ? "デコードのみ"
              : (operationLabels[choice ?? ""] ?? "判別できず");
    const confidence = operation?.confidence;
    const confidenceText =
        typeof confidence === "number" && Number.isFinite(confidence)
            ? `（Jevの確信度 ${Math.round(confidence * 100)}%）`
            : "";
    const tint =
        result.analysisStatus === "skipped" || choice === "unknown"
            ? "\u001b[33m"
            : "\u001b[32m";
    const heading = `${label}${confidenceText}`;
    const lines = [
        `判別             ${color ? `${tint}${heading}\u001b[0m` : heading}`,
        `取引             ${transaction?.hash ?? (evidence.source === "synthetic_demo_not_a_real_transaction" ? "架空のデモ" : "不明")}`,
        `ブロック         ${transaction?.blockNumber ?? "不明"}  |  実行結果 ${executionLabel(transaction?.status)}`,
        `送信元           ${transaction?.from ?? "不明"}`,
        `宛先             ${transaction?.to ?? "コントラクト作成"}`,
        `入力             ${inputLabel(evidence.decodedInput)}`,
    ];

    const tokenAmount = erc20Amount(evidence);
    if (tokenAmount) lines.push(`ERC-20送付量     ${tokenAmount}（最小単位）`);
    if (transaction?.valueWei && transaction.valueWei !== "0") {
        lines.push(
            `ETH送付額        ${formatEther(BigInt(transaction.valueWei))} ETH`,
        );
    }
    lines.push(`ブラックリスト   ${blacklistLabel(evidence.blacklist)}`);
    if (result.analysisStatus === "skipped") {
        lines.push(
            `補足             ${result.reason.message}（${result.reason.inputCharacters}文字）`,
        );
    } else if (result.analysisStatus === "completed" && choice === "unknown") {
        lines.push(
            "補足             判別の根拠が不足しています。生データは --json で確認できます。",
        );
    }
    if (evidence.source === "synthetic_demo_not_a_real_transaction") {
        lines.push("注記             架空のデモデータです。");
    }
    return lines.join("\n");
}

function executionLabel(status?: string) {
    if (status === "success") return "成功";
    if (status === "reverted") return "失敗（reverted）";
    return "不明";
}

function inputLabel(input?: EvidenceView["decodedInput"]) {
    if (!input) return "不明";
    if (input.status === "empty") return "calldata なし";
    if (input.status === "creation_bytecode") return "コントラクト作成コード";
    if (!input.candidates?.length)
        return `未対応のシグネチャ${input.selector ? ` ${input.selector}` : ""}`;
    const names = [
        ...new Set(
            input.candidates.map(
                ({ standard, functionName }) => `${standard} ${functionName}`,
            ),
        ),
    ];
    return `${names.join(" / ")}（ABI候補）`;
}

function erc20Amount(evidence: EvidenceView) {
    const candidates = evidence.decodedInput?.candidates;
    if (
        candidates?.length !== 1 ||
        candidates[0]?.standard !== "ERC-20" ||
        candidates[0].functionName !== "transfer"
    )
        return undefined;
    const amount = candidates[0].args?.[1];
    if (
        typeof amount === "bigint" ||
        (typeof amount === "string" && /^\d+$/.test(amount))
    ) {
        return BigInt(amount).toLocaleString("en-US");
    }
    return undefined;
}

function blacklistLabel(blacklist?: EvidenceView["blacklist"]) {
    if (blacklist?.status === "checked") {
        const verdict =
            blacklist.listed === true
                ? "掲載あり"
                : blacklist.listed === false
                  ? "該当なし"
                  : "結果不明";
        return `Ethereum参照リストに${verdict}（照合時点: ブロック ${blacklist.blockNumber ?? "不明"}、直接の宛先のみ）`;
    }
    if (blacklist?.status === "not_applicable") return "対象外（宛先なし）";
    return `未確認${blacklist?.reason ? `（${blacklist.reason}）` : ""}`;
}
