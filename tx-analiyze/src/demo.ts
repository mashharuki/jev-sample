import {
    encodeAbiParameters,
    encodeEventTopics,
    encodeFunctionData,
    erc20Abi,
    type Hex,
} from "viem";
import { decodeInput, decodeLogs } from "./decode.js";

export function demoEvidence() {
    const from = "0x1111111111111111111111111111111111111111";
    const recipient = "0x2222222222222222222222222222222222222222";
    const token = "0x3333333333333333333333333333333333333333";
    const amount = 1_000_000n;
    const input = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, amount],
    });
    return {
        source: "synthetic_demo_not_a_real_transaction",
        chainId: 84532,
        transaction: {
            from,
            to: token,
            input,
            valueWei: "0",
            status: "success",
            kind: "contract_call",
            recipientHasCodeAtBlockEnd: true,
        },
        decodedInput: decodeInput(input),
        logs: decodeLogs([
            {
                address: token,
                topics: encodeEventTopics({
                    abi: erc20Abi,
                    eventName: "Transfer",
                    args: { from, to: recipient },
                }) as Hex[],
                data: encodeAbiParameters([{ type: "uint256" }], [amount]),
            },
        ]),
        blacklist: {
            status: "unknown",
            reason: "架空のデモのため照合していません。",
        },
    };
}
