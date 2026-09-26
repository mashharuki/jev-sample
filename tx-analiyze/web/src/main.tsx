import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Summary = {
  id: string;
  hash: string;
  blockNumber: number;
  operation: string;
  analysisStatus: string;
  txStatus: string;
  blacklistStatus: string;
  recordedAt: string;
};
type AnalysisResult = {
  evidence: {
    source?: string;
    transaction: {
      hash?: string;
      from?: string;
      to?: string | null;
      valueWei?: string;
      status?: string;
      kind?: string;
      blockNumber?: string;
      input?: string;
    };
    decodedInput?: {
      status?: string;
      selector?: string;
      candidates?: {
        standard: string;
        functionName?: string;
        args?: unknown[];
      }[];
    };
    logs?: unknown[];
    blacklist?: { status?: string };
  };
  analysisStatus: string;
  classification?: {
    operation?: {
      choice?: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    };
  } | null;
  model?: string;
  usage?: Record<string, number> | null;
  jevLatencyMs?: number | null;
  reason?: { message?: string };
};
type Detail = {
  id: string;
  result: AnalysisResult;
  explanation?: Explanation | null;
};
type Explanation = {
  summary: string;
  evidence: string[];
  unknowns: string[];
  model: string;
  latencyMs?: number;
  usage?: Record<string, number> | null;
  cached?: boolean;
};
type Health = {
  chainId: number;
  worker: {
    status: string;
    head: number | null;
    message: string | null;
    updatedAt: string;
  } | null;
  checkpoint: { blockNumber: number } | null;
  geminiConfigured: boolean;
};

const opLabels: Record<string, string> = {
  transfer: "送金",
  approval: "承認",
  swap: "交換",
  bridge: "ブリッジ",
  mint: "発行",
  burn: "焼却",
  account_abstraction: "AA 操作",
  contract_creation: "コントラクト作成",
  other: "その他",
  unknown: "不明",
};
const short = (value?: string, left = 8, right = 6) =>
  value ? `${value.slice(0, left)}…${value.slice(-right)}` : "—";
const text = (value: unknown) => (value == null ? "取得不可" : String(value));
const metric = (value: unknown, suffix = "") =>
  value == null ? "取得不可" : `${value}${suffix}`;
const demoBase = {
  source: "synthetic_demo_not_a_real_transaction",
  chainId: 84532,
  transaction: {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x3333333333333333333333333333333333333333",
    valueWei: "0",
    status: "success",
    kind: "contract_call",
    blockNumber: "—",
  },
  blacklist: {
    status: "unknown",
    reason: "架空のデモのため照合していません。",
  },
  logs: [],
  decodedInput: { status: "unknown", candidates: [] },
};
const demoCases: {
  label: string;
  operation: string;
  result: AnalysisResult;
}[] = [
  {
    label: "送金の判別",
    operation: "transfer",
    result: {
      evidence: {
        ...demoBase,
        decodedInput: {
          status: "matched_signatures",
          selector: "0xa9059cbb",
          candidates: [
            {
              standard: "ERC-20",
              functionName: "transfer",
              args: ["0x2222222222222222222222222222222222222222", "1000000"],
            },
          ],
        },
        logs: [
          {
            address: demoBase.transaction.to,
            candidates: [
              {
                standard: "ERC-20",
                eventName: "Transfer",
                args: { value: "1000000" },
              },
            ],
          },
        ],
      },
      analysisStatus: "completed",
      classification: {
        operation: {
          choice: "transfer",
          confidence: 0.99,
          probabilities: { transfer: 1, unknown: 0 },
        },
      },
      model: "jev-1.13.0",
      usage: { input_tokens: 1771, output_tokens: 92 },
      jevLatencyMs: null,
    },
  },
  {
    label: "判別できない",
    operation: "unknown",
    result: {
      evidence: {
        ...demoBase,
        transaction: {
          ...demoBase.transaction,
          input: "0xdeadbeef",
          status: "reverted",
        },
      },
      analysisStatus: "completed",
      classification: {
        operation: {
          choice: "unknown",
          confidence: 0.34,
          probabilities: { unknown: 0.6, other: 0.4 },
        },
      },
      model: "jev-1.13.0",
      usage: null,
      jevLatencyMs: null,
    },
  },
  {
    label: "入力過大で省略",
    operation: "unknown",
    result: {
      evidence: demoBase,
      analysisStatus: "skipped",
      classification: null,
      reason: {
        message: "入力が40,000文字を超えたため、Jev の判別を省略しました。",
      },
    },
  },
];

function App() {
  const [items, setItems] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [demo, setDemo] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState("");
  const [status, setStatus] = useState("");
  const [blacklist, setBlacklist] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [error, setError] = useState("");
  const limit = 30;

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(page * limit),
    });
    if (query) params.set("search", query);
    if (operation) params.set("operation", operation);
    if (status) params.set("analysisStatus", status);
    if (blacklist) params.set("blacklistStatus", blacklist);
    try {
      const [listResponse, healthResponse] = await Promise.all([
        fetch(`/api/transactions?${params}`),
        fetch("/api/health"),
      ]);
      if (!listResponse.ok || !healthResponse.ok)
        throw new Error("API に接続できません。");
      const [list, nextHealth] = await Promise.all([
        listResponse.json(),
        healthResponse.json(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setHealth(nextHealth);
      setError("");
    } catch {
      setError(
        "Mastra API に接続できません。API サーバーの起動を確認してください。",
      );
    }
  }, [query, operation, status, blacklist, page]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const events = new EventSource("/api/transactions/events");
    events.onopen = () => {
      setConnection("connected");
      void load();
    };
    events.onerror = () => setConnection("disconnected");
    events.addEventListener("update", () => {
      void load();
    });
    return () => events.close();
  }, [load]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/transactions/${selected}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("取引を読み込めませんでした。");
        return response.json();
      })
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  const activeResult = demo === null ? detail?.result : demoCases[demo]?.result;
  const evidence = activeResult?.evidence;
  const tx = evidence?.transaction;
  const classification = activeResult?.classification?.operation;
  const explanation = demo === null ? detail?.explanation : null;
  const probabilities = useMemo(
    () =>
      Object.entries(classification?.probabilities || {}).sort(
        (a, b) => Number(b[1]) - Number(a[1]),
      ),
    [classification],
  );

  async function requestExplanation() {
    if (!selected || demo !== null) return;
    setExplainLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/transactions/${selected}/explanation`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "解説の生成に失敗しました。");
      setDetail((current) =>
        current ? { ...current, explanation: data.explanation } : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "解説の生成に失敗しました。",
      );
    } finally {
      setExplainLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <strong>TX OBSERVATORY</strong>
            <small>BASE SEPOLIA / 84532</small>
          </div>
        </div>
        <div className="top-actions">
          <span className={`live-indicator ${connection}`}>
            <i />
            {connection === "connected"
              ? "LIVE FEED"
              : connection === "connecting"
                ? "CONNECTING"
                : "RECONNECTING"}
          </span>
          <a
            className="external-link"
            href="https://sepolia.basescan.org/"
            target="_blank"
            rel="noreferrer"
          >
            BaseScan ↗
          </a>
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">TRANSACTION INTELLIGENCE / MONITOR</p>
            <h1>
              取引の動きを、
              <br />
              <em>判断の根拠まで。</em>
            </h1>
            <p className="intro">
              Base Sepolia のオンチェーンデータを Jev が分類。選んだ取引だけ
              Gemini が詳しく解説します。
            </p>
          </div>
          <div className="hero-count">
            <span>OBSERVED TRANSACTIONS</span>
            <strong>{total.toLocaleString("ja-JP")}</strong>
            <small>蓄積された取引</small>
          </div>
        </section>
        <section className="status-grid" aria-label="監視状態">
          <div className="status-card">
            <span>WORKER STATUS</span>
            <strong>
              <i
                className={`dot ${health?.worker?.status === "running" ? "green" : "amber"}`}
              />
              {health?.worker?.status === "running"
                ? "監視中"
                : health?.worker?.status === "error"
                  ? "エラー"
                  : "停止中"}
            </strong>
            <small>
              {health?.worker?.message || "Base Sepolia の確定ブロックを待機"}
            </small>
          </div>
          <div className="status-card">
            <span>LAST PROCESSED BLOCK</span>
            <strong className="mono">
              {health?.checkpoint?.blockNumber?.toLocaleString("ja-JP") || "—"}
            </strong>
            <small>2 ブロックの後続確認後に保存</small>
          </div>
          <div className="status-card">
            <span>GOOGLE GEMINI</span>
            <strong>
              <i
                className={`dot ${health?.geminiConfigured ? "green" : "amber"}`}
              />
              {health?.geminiConfigured ? "利用可能" : "キー未設定"}
            </strong>
            <small>解説ボタンを押した時だけ実行</small>
          </div>
        </section>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
        )}
        <section className="workspace">
          <div className="list-pane">
            <div className="section-heading">
              <div>
                <span className="eyebrow">01 / TRANSACTION STREAM</span>
                <h2>取引一覧</h2>
              </div>
              <span className="count-pill">{total} 件</span>
            </div>
            <div className="filter-bar">
              <label className="search">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                  placeholder="トランザクションハッシュで検索"
                  aria-label="ハッシュで検索"
                />
              </label>
              <div className="select-row">
                <select
                  aria-label="操作の種類"
                  value={operation}
                  onChange={(event) => {
                    setOperation(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">すべての操作</option>
                  {Object.entries(opLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="判別状態"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">すべての状態</option>
                  <option value="completed">判別済み</option>
                  <option value="skipped">省略</option>
                  <option value="decode_only">デコードのみ</option>
                </select>
                <select
                  aria-label="ブラックリスト照合状態"
                  value={blacklist}
                  onChange={(event) => {
                    setBlacklist(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">すべての照合状態</option>
                  <option value="checked">照合済み</option>
                  <option value="unknown">未確認</option>
                  <option value="not_applicable">対象外</option>
                </select>
              </div>
            </div>
            <div className="stream-list">
              {items.length ? (
                items.map((item) => (
                  <button
                    type="button"
                    className={`tx-row ${selected === item.hash && demo === null ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => {
                      setDemo(null);
                      setSelected(item.hash);
                    }}
                  >
                    <span className="row-icon">↗</span>
                    <span className="row-main">
                      <strong className="mono">
                        {short(item.hash, 12, 8)}
                      </strong>
                      <small>
                        BLOCK {item.blockNumber.toLocaleString("ja-JP")} ·{" "}
                        {new Date(item.recordedAt).toLocaleTimeString("ja-JP")}
                      </small>
                    </span>
                    <span className="row-side">
                      <b className={`operation ${item.operation}`}>
                        {item.analysisStatus === "skipped"
                          ? "省略"
                          : item.analysisStatus === "decode_only"
                            ? "未実行"
                            : opLabels[item.operation] || item.operation}
                      </b>
                      <small>
                        {item.txStatus === "success" ? "成功" : "失敗"}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <span>◇</span>
                  <strong>表示する取引がありません</strong>
                  <p>監視ワーカーを起動するか、下のデモを選択してください。</p>
                </div>
              )}
            </div>
            <div className="pagination">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                ← 前へ
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(total / limit))}
              </span>
              <button
                type="button"
                disabled={(page + 1) * limit >= total}
                onClick={() => setPage(page + 1)}
              >
                次へ →
              </button>
            </div>
            <div className="demo-panel">
              <span className="eyebrow">EXPLORE WITHOUT API KEYS</span>
              <strong>3つのデモで違いを確認</strong>
              <p>架空の取引です。実チェーンの結果ではありません。</p>
              <div className="demo-buttons">
                {demoCases.map((item, index) => (
                  <button
                    type="button"
                    key={item.label}
                    className={demo === index ? "active" : ""}
                    onClick={() => {
                      setDemo(index);
                      setSelected(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="detail-pane">
            <div className="section-heading">
              <div>
                <span className="eyebrow">02 / INSPECTION</span>
                <h2>取引の詳細</h2>
              </div>
              {demo !== null && (
                <span className="demo-tag">SYNTHETIC DEMO</span>
              )}
            </div>
            {loading ? (
              <div className="detail-empty">読み込み中…</div>
            ) : !activeResult ? (
              <div className="detail-empty">
                <span>◎</span>
                <strong>取引を選択してください</strong>
                <p>左の一覧、またはデモから判別内容を確認できます。</p>
              </div>
            ) : (
              <>
                <div className="tx-heading">
                  <div>
                    <span className="eyebrow">TRANSACTION HASH</span>
                    <strong className="mono">
                      {tx?.hash
                        ? short(tx.hash, 18, 14)
                        : demo !== null
                          ? `DEMO / ${demoCases[demo]?.label}`
                          : "—"}
                    </strong>
                  </div>
                  <span
                    className={`result-tag ${tx?.status === "success" ? "success" : "failure"}`}
                  >
                    {tx?.status === "success" ? "成功" : "失敗"}
                  </span>
                </div>
                <div className="facts-grid">
                  <Fact label="送信元" value={tx?.from} />
                  <Fact label="宛先" value={tx?.to} />
                  <Fact
                    label="ETH 送付額"
                    value={tx?.valueWei ? `${tx.valueWei} wei` : "0 wei"}
                  />
                  <Fact label="ブロック" value={tx?.blockNumber} />
                  <Fact
                    label="入力デコード"
                    value={evidence?.decodedInput?.status}
                  />
                  <Fact
                    label="ブラックリスト照合"
                    value={evidence?.blacklist?.status}
                  />
                </div>
                <div className="comparison-title">
                  <div>
                    <span className="eyebrow">
                      03 / HOW THE DECISION IS MADE
                    </span>
                    <h3>事実から、判断、解説へ</h3>
                  </div>
                  <p>それぞれの役割を分けて表示します</p>
                </div>
                <div className="comparison">
                  <article className="comparison-card fact-card">
                    <div className="step">
                      <span>01</span>
                      <b>チェーン上の事実</b>
                    </div>
                    <p className="card-caption">RPC・イベントログから取得</p>
                    <div className="card-result">
                      <span className="field-label">観測した内容</span>
                      <strong>
                        {evidence?.decodedInput?.candidates?.[0]
                          ?.functionName ||
                          tx?.kind ||
                          "不明"}
                      </strong>
                      <p>
                        {evidence?.decodedInput?.candidates?.length
                          ? `ABI 候補: ${evidence.decodedInput.candidates.map((candidate) => `${candidate.standard} ${candidate.functionName}`).join(" / ")}`
                          : "既知の ABI 候補なし"}
                      </p>
                      <p>イベント: {evidence?.logs?.length || 0} 件</p>
                    </div>
                    <small>
                      ABI の一致はコントラクトの規格準拠を保証しません。
                    </small>
                  </article>
                  <article className="comparison-card jev-card">
                    <div className="step">
                      <span>02</span>
                      <b>Jev の判断</b>
                    </div>
                    <p className="card-caption">定型の選択肢から分類</p>
                    <div className="card-result">
                      <span className="field-label">判別結果</span>
                      <strong>
                        {activeResult.analysisStatus === "skipped"
                          ? "省略"
                          : activeResult.analysisStatus === "decode_only"
                            ? "未実行"
                            : opLabels[classification?.choice || "unknown"] ||
                              "不明"}
                      </strong>
                      <p>
                        {activeResult.analysisStatus === "skipped"
                          ? activeResult.reason?.message
                          : classification?.confidence != null
                            ? `モデルの確信度 ${(Number(classification.confidence) * 100).toFixed(0)}%`
                            : "分類結果はありません"}
                      </p>
                    </div>
                    <div className="model-meta">
                      <span>{activeResult.model || "モデル未実行"}</span>
                      <span>{metric(activeResult.jevLatencyMs, " ms")}</span>
                      <span>
                        入力{" "}
                        {metric(
                          activeResult.usage?.input_tokens ??
                            activeResult.usage?.inputTokens,
                        )}
                      </span>
                      <span>
                        出力{" "}
                        {metric(
                          activeResult.usage?.output_tokens ??
                            activeResult.usage?.outputTokens,
                        )}
                      </span>
                    </div>
                    <small>確信度は正解率ではありません。</small>
                  </article>
                  <article className="comparison-card gemini-card">
                    <div className="step">
                      <span>03</span>
                      <b>Gemini の解説</b>
                    </div>
                    <p className="card-caption">選択した取引だけ文章化</p>
                    <div className="card-result">
                      <span className="field-label">解説の状態</span>
                      <strong>{explanation ? "生成済み" : "未実行"}</strong>
                      <p>
                        {explanation?.summary ||
                          (demo !== null
                            ? "デモでは Gemini を呼び出しません。"
                            : "ボタンを押すまでモデルは実行されません。")}
                      </p>
                    </div>
                    <div className="model-meta">
                      <span>{explanation?.model || "—"}</span>
                      <span>{metric(explanation?.latencyMs, " ms")}</span>
                      <span>
                        入力{" "}
                        {metric(
                          explanation?.usage?.inputTokens ??
                            explanation?.usage?.input_tokens,
                        )}
                      </span>
                      <span>
                        出力{" "}
                        {metric(
                          explanation?.usage?.outputTokens ??
                            explanation?.usage?.output_tokens,
                        )}
                      </span>
                    </div>
                    <small>
                      {explanation?.cached
                        ? "保存済みの解説を表示"
                        : "モデルによる解説は推定を含みます。"}
                    </small>
                  </article>
                </div>
                <p className="usage-note">
                  トークン数はモデル間の料金や精度を直接比較する数値ではありません。
                </p>
                <div className="detail-section">
                  <div className="detail-section-heading">
                    <div>
                      <span className="eyebrow">DEEP DIVE</span>
                      <h3>詳しい解説</h3>
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        demo !== null ||
                        explainLoading ||
                        !health?.geminiConfigured
                      }
                      onClick={() => void requestExplanation()}
                    >
                      {explainLoading
                        ? "生成中…"
                        : explanation
                          ? "保存済みの解説を確認"
                          : "✦ 詳しく解説"}
                    </button>
                  </div>
                  {demo === null && !health?.geminiConfigured && (
                    <p className="muted">
                      利用するにはサーバーの GOOGLE_API_KEY を設定してください。
                    </p>
                  )}
                  {explanation ? (
                    <div className="explanation">
                      <p>{explanation.summary}</p>
                      <h4>根拠として使ったデータ</h4>
                      <ul>
                        {explanation.evidence.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                      <h4>不明な点</h4>
                      <ul>
                        {explanation.unknowns.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="muted">
                      選択した実取引についてのみ、Gemini
                      が根拠付きの日本語説明を生成します。
                    </p>
                  )}
                </div>
                {probabilities.length > 0 && (
                  <div className="detail-section">
                    <span className="eyebrow">
                      JEV / PROBABILITY DISTRIBUTION
                    </span>
                    <h3>候補ごとの確率</h3>
                    <div className="probability-list">
                      {probabilities.map(([name, probability]) => (
                        <div className="probability" key={name}>
                          <span>{opLabels[name] || name}</span>
                          <div>
                            <i
                              style={{
                                width: `${Math.min(100, Math.max(0, Number(probability) * 100))}%`,
                              }}
                            />
                          </div>
                          <b>{(Number(probability) * 100).toFixed(1)}%</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <details className="raw-json">
                  <summary>元データの JSON を見る</summary>
                  <pre>{JSON.stringify(activeResult, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        </section>
      </main>
      <footer>
        <span>TX OBSERVATORY · BASE SEPOLIA</span>
        <span>ON-CHAIN FACTS / JEV CLASSIFICATION / GEMINI EXPLANATION</span>
      </footer>
    </div>
  );
}
function Fact({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong title={text(value)}>{text(value)}</strong>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("React の root 要素が見つかりません。");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
