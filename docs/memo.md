# jevで作りたいもの

## 概要

jevを使ってブロックチェーンに流れるトランザクションのデータを判別したい

- 送金かコントラクトの呼び出しか
- 呼び出し先のアドレスがブラックリストのアドレスかどうか
  - コントラクトの場合は処理内容まで判別したい(ERC20やERC721、ERC4337、ERC7002あたりは著名なのでこれらに該当する処理かどうかは判別したいですね)
    - 例
      - swap
      - bridge
      - mint
      - burn
      - その他
- 対象はEVMチェーン(MVPではBase Sepoliaを対象とする)
- トランザクションのデータをRPCエンドポイント越しに取得する
- デコードしてjson形式で取得

## 技術スタック

- biome
- pnpm
- typesafe ai TypeScript SDK
- dotenv
- tsx
- Alchemy RPC Endpoint

## その他方針

- あくまでも機能開発のボリュームは最小限のMVPとすること
- jevのコンテキストの内容は理解しやすいように日本語で定義すること
- 以下のAgent SKILLを使って
  - claude plugin marketplace add typesafe-ai/skills
  - claude plugin install typesafe@typesafe-ai
- スクリプトレベルで実行できればOKです！
- ブラックリストのアドレスは以下のコントラクトの`blacklist`変数を確認することで確認が可能です。
  - https://etherscan.io/address/0x97044531D0fD5B84438499A49629488105Dc58e6#readContract