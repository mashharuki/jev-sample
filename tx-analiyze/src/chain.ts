import {
  type Address,
  createPublicClient,
  type Hash,
  http,
  parseAbi,
} from "viem";
import { baseSepolia, mainnet } from "viem/chains";
import { decodeInput, decodeLogs, transactionKind } from "./decode.js";

// ブラックリストを保管するコントラクトのアドレス
export const BLACKLIST_ADDRESS = "0x97044531D0fD5B84438499A49629488105Dc58e6";

// ブラックリストコントラクトの ABI
const blacklistAbi = parseAbi([
  "function blacklist() view returns (address[])",
]);

/**
 * リストに含まれているかどうかを判定する
 * @param address
 * @param entries
 * @returns
 */
export function isListed(address: Address, entries: readonly Address[]) {
  return entries.some((entry) => entry.toLowerCase() === address.toLowerCase());
}

/**
 * ブラックリストをチェックする
 * @param to
 * @param rpcUrl
 * @returns
 */
export async function checkBlacklist(to: Address | null, rpcUrl?: string) {
  const source = {
    chainId: 1,
    contract: BLACKLIST_ADDRESS,
    scope: "direct_recipient_only",
  };
  if (!to) return { ...source, status: "not_applicable" };
  if (!rpcUrl)
    return {
      ...source,
      status: "unknown",
      reason: "ETHEREUM_RPC_URL が未設定です。",
    };
  try {
    // RPC exceptions can contain URLs with embedded API keys.
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
    });
    if ((await client.getChainId()) !== 1) throw new Error("Wrong chain");

    // blacklist() の呼び出しは、最新ブロックの状態を取得するために、明示的にブロック番号を指定する
    const blockNumber = await client.getBlockNumber();
    const entries = await client.readContract({
      address: BLACKLIST_ADDRESS,
      abi: blacklistAbi,
      functionName: "blacklist",
      blockNumber,
    });
    return {
      ...source,
      status: "checked",
      listed: isListed(to, entries),
      blockNumber,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    // RPC exceptions can contain URLs with embedded API keys.
    return {
      ...source,
      status: "unknown",
      reason: "Ethereum RPC または blacklist() の取得に失敗しました。",
    };
  }
}

/**
 * トランザクションの証拠を取得する
 * @param hash
 * @param rpcUrl
 * @param ethereumRpcUrl
 * @returns
 */
export async function fetchEvidence(
  hash: Hash,
  rpcUrl: string,
  ethereumRpcUrl?: string,
) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });
  if ((await client.getChainId()) !== baseSepolia.id) {
    throw new Error(
      "ALCHEMY_RPC_URL は Base Sepolia (84532) を指定してください。",
    );
  }
  const transaction = await client.getTransaction({ hash });
  if (transaction.blockNumber === null)
    throw new Error(
      "未承認のトランザクションです。ブロックに含まれてから再実行してください。",
    );
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.blockHash !== transaction.blockHash)
    throw new Error("ブロックが変化しました。再実行してください。");
  const [code, blacklist] = await Promise.all([
    transaction.to
      ? client.getCode({
          address: transaction.to,
          blockNumber: transaction.blockNumber,
        })
      : undefined,
    checkBlacklist(transaction.to, ethereumRpcUrl),
  ]);
  return {
    source: "base_sepolia_rpc",
    chainId: baseSepolia.id,
    transaction: {
      hash,
      from: transaction.from,
      to: transaction.to,
      valueWei: transaction.value.toString(),
      input: transaction.input,
      blockNumber: transaction.blockNumber.toString(),
      blockHash: transaction.blockHash,
      status: receipt.status,
      kind: transactionKind(transaction.to, transaction.input, code),
      recipientHasCodeAtBlockEnd: !!code && code !== "0x",
    },
    decodedInput: transaction.to
      ? decodeInput(transaction.input)
      : { status: "creation_bytecode", candidates: [] },
    logs: decodeLogs(receipt.logs),
    blacklist,
  };
}
