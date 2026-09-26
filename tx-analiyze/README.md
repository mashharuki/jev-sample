# Jev トランザクション判別 CLI

Base Sepolia の承認済みトランザクションを RPC で取得し、calldata とイベントログをデコードして Jev に分類させる最小構成のサンプルです。トランザクションの送信や署名は行いません。

## セットアップ

Node.js 22 以上、pnpm 11.24.0 を使用します。

```sh
cd tx-analiyze
pnpm install
cp .env.example .env
```

`.env` に以下を設定してください。キーを Git にコミットしないでください。

| 変数 | 用途 |
| --- | --- |
| `TYPESAFE_API_KEY` | Jev の API キー。`--decode-only` では不要 |
| `ALCHEMY_RPC_URL` | Alchemy の Base Sepolia RPC URL（chain ID: 84532）。実トランザクション取得時に必要 |
| `ETHEREUM_RPC_URL` | 任意。ブラックリストを取得する Ethereum メインネット RPC URL（chain ID: 1） |
| `JEV_MODEL` | 任意。既定値は `jev-latest` |

## 実行

ハッシュがない場合は、架空の ERC-20 送金データで試せます。

```sh
# キー不要・通信なしでデコード処理を確認
pnpm analyze --demo --decode-only

# 架空のデータを実際の Jev API に渡して分類（API 使用量が発生）
pnpm analyze --demo

# Base Sepolia の実トランザクション（0x... を実際のハッシュに置換）
pnpm analyze 0x...

# RPC 取得とデコードのみ。Jev は呼び出さない
pnpm analyze 0x... --decode-only

# JSON ファイルに保存するときは pnpm の実行ログを抑制
pnpm --silent analyze --demo --decode-only > result.json
```

`evidence` に観測データ、`classification.operation` に Jev の `choice`・`confidence`・`probabilities`、`model` と `usage` に利用情報を出力します。分類は transfer / approval / swap / bridge / mint / burn / account_abstraction / contract_creation / other / unknown です。デコードのみの場合は `classification: null` になります。

デモは実チェーン上の取引ではありません。実行エラーは標準エラーと終了コード 1 で通知します。

## 対応範囲と読み方

- ERC-20／ERC-721 の標準 ABI と ERC-4337 EntryPoint の `handleOps`（v0.6/v0.7 形式）、`UserOperationEvent` を照合します。ABI の一致は規格への準拠や処理内容を保証しません。`transferFrom` などの曖昧な候補は両方残します。
- ブラックリストは [Ethereum 上のコントラクト](https://etherscan.io/address/0x97044531D0fD5B84438499A49629488105Dc58e6#readContract) の `blacklist()` と直接の宛先 `to` を照合します。未設定・取得失敗は `unknown`、作成トランザクションは `not_applicable` です。取引時点ではなく確認時点のリストを使用し、参照ブロックを記録します。別チェーン上の同じアドレスに関する参考情報であり、安全性判定ではありません。
- 内部トレース、独自 ABI、プロキシの実装追跡、ネストした UserOperation のデコードは未対応です。swap／bridge は十分な根拠がない場合 `unknown` に分類させます。mint／burn も Transfer ログからの推定です。
- 宛先コードは取引を含むブロック終了時点で取得します。過去状態を読める RPC が必要です。空 calldata でもコードがあればコントラクト呼び出しとして扱います。失敗した取引の意図と実際の成功は別なので `transaction.status` も確認してください。
- メモの ERC7002 は [EIP-7002](https://eips.ethereum.org/EIPS/eip-7002)（Ethereum バリデータの出金要求）に相当します。Base Sepolia の本 MVP では未対応です。
- モデルの分類精度は未評価です。確信度は正解の保証ではありません。入力が 40,000 文字を超える場合は Jev 呼び出しを停止します。

## 開発・検証

```sh
pnpm typecheck
pnpm check
pnpm test
pnpm format
```

テストは Node.js の標準テストランナーを使い、デコード・曖昧なシグネチャ・ブラックリスト照合・CLI を検証します。実 RPC／Jev の品質評価は含みません。

実装時に [TypeSafe 公式スキル](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md) と [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) を参照しています。日本語の分類基準は `src/questions.ts` で変更できます。
