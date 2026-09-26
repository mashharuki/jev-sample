import {
  type Address,
  decodeEventLog,
  decodeFunctionData,
  erc20Abi,
  erc721Abi,
  type Hex,
  parseAbi,
} from "viem";

const entryPointAbi = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)",
  "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
]);

const abiCandidates = [
  { standard: "ERC-20", abi: erc20Abi },
  { standard: "ERC-721", abi: erc721Abi },
  { standard: "ERC-4337", abi: entryPointAbi },
] as const;

/**
 * 入力をデコードする
 * @param data
 * @returns
 */
export function decodeInput(data: Hex) {
  if (data === "0x") return { status: "empty", candidates: [] };
  const candidates = abiCandidates.flatMap(({ standard, abi }) => {
    try {
      const decoded = decodeFunctionData({ abi, data });
      return [{ standard, ...decoded }];
    } catch {
      return [];
    }
  });
  return {
    status: candidates.length ? "matched_signatures" : "unknown",
    selector: data.slice(0, 10),
    candidates,
  };
}

export type RawLog = { address: Address; data: Hex; topics: Hex[] };

/**
 * ログをデコードする
 * @param logs
 * @returns
 */
export function decodeLogs(logs: RawLog[]) {
  return logs.map((log) => ({
    ...log,
    candidates: abiCandidates.flatMap(({ standard, abi }) => {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
          strict: true,
        });
        return [{ standard, ...decoded }];
      } catch {
        return [];
      }
    }),
  }));
}

/**
 * トランザクションの種類を判定する
 * @param to
 * @param input
 * @param code
 * @returns
 */
export function transactionKind(
  to: Address | null,
  input: Hex,
  code: Hex | undefined,
) {
  if (to === null) return "contract_creation";
  if (code && code !== "0x") return "contract_call";
  if (input === "0x") return "native_transfer_or_noop";
  return "data_to_address_without_code";
}

export function jsonStringify(value: unknown, space = 2) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    space,
  );
}
