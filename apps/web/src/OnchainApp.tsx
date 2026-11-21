import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import type {
  EnvironmentInfo,
  OnchainRunResult,
  OnchainScenarioDefinition,
  TreasuryView,
  RebalancePlan,
} from "@repo/shared";
import { api, post, money, short, date, usdRaw, ApiError } from "./api/client";
import {
  connectWallet,
  userRejected,
  type ConnectedWallet,
} from "./wallet/wallet";

const route = () => location.hash.slice(1) || "/treasury";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    treasury: (
      <>
        <path d="M3 8h18M5 8v11h14V8M3 19h18M7 11v5m5-5v5m5-5v5M3 5l9-3 9 3v3H3z" />
      </>
    ),
    lab: (
      <>
        <path d="M9 3h6m-5 0v7L4.5 19a1.3 1.3 0 001.2 2h12.6a1.3 1.3 0 001.2-2L14 10V3M8 14h8" />
        <path d="M9 17h.01M14 18h.01" />
      </>
    ),
    results: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M9 8h6m-6 4h6m-6 4h3" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M17 10h4v5h-4a2.5 2.5 0 010-5zM4 5l13-3v3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z" />
        <path d="M8 12l3 3 5-6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0112-2l2 3M4 16l2 3a7 7 0 0012-2" />
      </>
    ),
    check: <path d="M5 12l4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.shield}
    </svg>
  );
}
function Badge({ value }: { value: string }) {
  const labels: Record<string, string> = {
    QUEUED: "Đang chờ",
    RUNNING: "Đang chạy",
    COMPLETED: "Hoàn tất",
  };
  return (
    <span className={"badge " + value.toLowerCase()}>
      {labels[value] ?? value}
    </span>
  );
}
function Hash({ value }: { value?: string }) {
  return value ? (
    <button
      className="hash"
      title={value}
      onClick={() => navigator.clipboard?.writeText(value)}
    >
      {short(value)} <span aria-hidden="true">⧉</span>
    </button>
  ) : (
    <span className="muted">Chưa gửi</span>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name="shield" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  );
}
function StateTable({ run }: { run: OnchainRunResult }) {
  const keys = Object.keys(run.before?.balances ?? {});
  const names: Record<string, string> = {
    safeUsdc: "USDC của Safe",
    safeTokenA: "Token A của Safe",
    safeVaultShares: "Shares vault của Safe",
    outsiderUsdc: "USDC ví lạ",
    outsiderTokenA: "Token A ví lạ",
    outsiderVaultShares: "Shares ví lạ",
    routerUsdc: "USDC ở router",
  };
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Tài sản / trạng thái</th>
            <th>Trước</th>
            <th>Sau</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td>{names[k] ?? k}</td>
              <td className="mono">{run.before?.balances[k]}</td>
              <td className="mono">{run.after?.balances[k] ?? "—"}</td>
            </tr>
          ))}
          <tr>
            <td>Cap đã dùng (USD)</td>
            <td>{money(run.before?.spent24hUsd)}</td>
            <td>{money(run.after?.spent24hUsd)}</td>
          </tr>
          <tr>
            <td>Block</td>
            <td>{run.before?.blockNumber ?? "—"}</td>
            <td>{run.after?.blockNumber ?? "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="table-note">
        Số dư token và shares ở đơn vị nguyên (raw). Phí gas được tách khỏi các
        tài sản này.
      </p>
    </div>
  );
}

export function OnchainApp() {
  const [path, setPath] = useState(route);
  const [env, setEnv] = useState<
    EnvironmentInfo & { busy?: string; pendingGovernance?: unknown[] }
  >();
  const [treasury, setTreasury] = useState<TreasuryView>();
  const [scenarios, setScenarios] = useState<OnchainScenarioDefinition[]>([]);
  const [runs, setRuns] = useState<OnchainRunResult[]>([]);
  const [selected, setSelected] = useState<string[]>([
    "SC-02",
    "SC-04",
    "SC-09",
    "SC-11",
    "SC-16",
  ]);
  const [category, setCategory] = useState("Tất cả");
  const [scenarioEnv, setScenarioEnv] = useState<"local" | "fuji">("local");
  const [alloc, setAlloc] = useState(["20", "30", "50"]);
  const [preview, setPreview] = useState<RebalancePlan>();
  const [wallet, setWallet] = useState<ConnectedWallet>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success" | "info";
    text: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [cap, setCap] = useState("100");
  const [slippage, setSlippage] = useState("1");
  const [age, setAge] = useState("3600");
  const [pending, setPending] = useState<{ id: string; hash?: string }>();
  const [pendingHash, setPendingHash] = useState("");
  const initialized = useRef(false);
  const [detail, setDetail] = useState<OnchainRunResult>();
  const currentId = path.startsWith("/results/")
    ? path.split("/")[2]
    : undefined;
  async function refresh() {
    try {
      const [environment, history] = await Promise.all([
        api<EnvironmentInfo & { busy?: string; pendingGovernance?: unknown[] }>(
          "/environment",
        ),
        api<OnchainRunResult[]>("/runs"),
      ]);
      setEnv(environment);
      setRuns(history);
      if (environment.ready && !environment.busy) {
        try {
          const t = await api<TreasuryView>("/treasury");
          setTreasury(t);
          if (!initialized.current) {
            setAlloc(t.targets.map((v) => String(v / 100)));
            setCap(formatUnits(BigInt(t.policy.cap24hUsd), 8));
            setSlippage(String(t.policy.maxSlippageBps / 100));
            setAge(String(t.policy.maxPriceAgeSec));
            initialized.current = true;
          }
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409))
            setMessage({
              kind: "error",
              text:
                "Không đọc được snapshot mới: " +
                (error instanceof Error ? error.message : String(error)),
            });
        }
      }
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "API không phản hồi.",
      });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const handler = () => setPath(route());
    addEventListener("hashchange", handler);
    return () => removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    let alive = true;
    api<OnchainScenarioDefinition[]>("/scenarios")
      .then((s) => alive && setScenarios(s))
      .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!currentId) {
      setDetail(undefined);
      return;
    }
    let alive = true;
    const load = () =>
      api<OnchainRunResult>("/runs/" + currentId)
        .then((r) => alive && setDetail(r))
        .catch((e) => alive && setMessage({ kind: "error", text: String(e) }));
    void load();
    const timer = setInterval(() => void load(), 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [currentId]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("treasury-pending-owner");
      if (saved) setPending(JSON.parse(saved));
    } catch {}
  }, []);
  function remember(value: { id: string; hash?: string } | undefined) {
    setPending(value);
    if (value)
      localStorage.setItem("treasury-pending-owner", JSON.stringify(value));
    else localStorage.removeItem("treasury-pending-owner");
  }
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }
  const targetValues = () =>
    alloc.map((v) => {
      if (!/^\d+(\.\d{1,2})?$/.test(v))
        throw new Error("Tỷ trọng cần là số từ 0 đến 100.");
      return Math.round(Number(v) * 100);
    });
  async function saveTargets() {
    const values = targetValues();
    await api("/targets", {
      method: "PUT",
      body: JSON.stringify({ targets: values }),
    });
    return values;
  }
  async function requestRun(kind: "SCENARIO" | "REBALANCE", ids = selected) {
    if (kind === "REBALANCE") await saveTargets();
    const response = await post<{ runIds: string[] }>(
      "/runs",
      {
        kind,
        environment: kind === "SCENARIO" ? scenarioEnv : "local",
        ...(kind === "SCENARIO" ? { scenarioIds: ids } : {}),
      },
      { "Idempotency-Key": crypto.randomUUID() },
    );
    location.hash = "/results/" + response.runIds[0];
    await refresh();
  }
  async function connect(mode: "extension" | "anvil") {
    if (!env?.rpcUrl || !env.owner)
      throw new Error("Môi trường chưa sẵn sàng.");
    setWallet(await connectWallet(mode, env.rpcUrl, env.owner));
    setMessage({
      kind: "success",
      text:
        mode === "anvil"
          ? "Đã kết nối ví thử nghiệm Anvil."
          : "Đã kết nối ví owner.",
    });
  }
  async function confirmPending(id: string, hash: string) {
    for (let i = 0; i < 40; i++) {
      const result = await post<{ status: string; receiptStatus?: string }>(
        "/governance/" + id + "/confirm",
        { hash },
      );
      if (result.status === "CONFIRMED") {
        remember(undefined);
        if (result.receiptStatus === "reverted")
          throw new Error("Giao dịch owner đã revert.");
        await refresh();
        setMessage({
          kind: "success",
          text: "Giao dịch owner đã xác nhận trên chain.",
        });
        return;
      }
      await sleep(750);
    }
    throw new Error(
      "Giao dịch đang chờ. Hash đã được giữ lại; kiểm tra lại trước khi gửi yêu cầu mới.",
    );
  }
  async function governance(actionName: "revoke" | "grant" | "policy") {
    if (!wallet) throw new Error("Kết nối ví owner trước.");
    setWalletBusy(true);
    const id = crypto.randomUUID();
    let prepared = false;
    let submitted = false;
    try {
      const request = {
        requestId: id,
        owner: wallet.address,
        action: actionName,
        ...(actionName === "grant" ? { hours: 24 } : {}),
        ...(actionName === "policy"
          ? {
              cap24hUsd: usdRaw(cap),
              maxSlippageBps: Math.round(Number(slippage) * 100),
              maxPriceAgeSec: Number(age),
            }
          : {}),
      };
      const unsigned = await post<{ to: Address; data: Hex }>(
        "/governance/prepare",
        request,
      );
      prepared = true;
      remember({ id });
      setMessage({ kind: "info", text: "Chờ ví owner ký giao dịch Safe…" });
      const hash = await wallet.send(unsigned.to, unsigned.data);
      submitted = true;
      remember({ id, hash });
      setMessage({
        kind: "info",
        text: "Đã gửi giao dịch owner. Đang chờ xác nhận…",
      });
      await confirmPending(id, hash);
    } catch (error) {
      if (prepared && !submitted && userRejected(error)) {
        await post("/governance/" + id + "/cancel", { walletRejected: true });
        remember(undefined);
        throw new Error("Bạn đã hủy ký; chưa thực hiện thay đổi.");
      }
      throw error;
    } finally {
      setWalletBusy(false);
    }
  }
  const running = runs.filter((r) => r.status !== "COMPLETED").length;
  const completed = runs.filter((r) => r.verdict === "PASS").length;
  const policy = treasury?.policy;
  const disabled = busy || walletBusy || !!env?.busy;
  const nav = path.startsWith("/lab")
    ? "lab"
    : path.startsWith("/results")
      ? "results"
      : "treasury";
  const titles = {
    treasury: [
      "Quỹ & chính sách",
      "Theo dõi danh mục và quyền giao dịch của agent.",
    ],
    lab: [
      "Phòng kiểm thử",
      "Chạy tình huống và đối chiếu giới hạn bằng bằng chứng on-chain.",
    ],
    results: [
      "Kết quả kiểm thử",
      "Lịch sử, assertions và trạng thái tài sản của từng lượt chạy.",
    ],
  };
  const selectedRun = detail;
  const testTransactions =
    selectedRun?.transactions.filter((t) => t.stage === "TEST") ?? [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/treasury">
          <span className="brand-mark">
            <Icon name="shield" />
          </span>
          <span>
            Treasury<span className="brand-sub">AGENT LAB</span>
          </span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Điều hướng chính">
          {[
            ["treasury", "Quỹ & chính sách"],
            ["lab", "Phòng kiểm thử"],
            ["results", "Kết quả & lịch sử"],
          ].map(([key, label]) => (
            <a
              key={key}
              className={nav === key ? "nav-link active" : "nav-link"}
              href={"#/" + key}
            >
              <Icon name={key} />
              {label}
              {key === "results" && runs.length > 0 && (
                <span className="nav-count">{runs.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="chain-illustration">
            <div className="chain-cube">◇</div>
            <span>
              Giới hạn được thực thi
              <br />
              bởi hợp đồng.
            </span>
          </div>
          <div className="node-status">
            <span
              className={"status-dot " + (env?.ready ? "online" : "offline")}
            />
            <div>
              <strong>
                {env?.ready ? "Anvil đã kết nối" : "Đang chờ môi trường"}
              </strong>
              <small>Local · chain 31337</small>
            </div>
          </div>
          <span className="sidebar-version">Treasury Agent Lab · v1.0</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span> {titles[nav][0]}
          </span>
          <div className="topbar-actions">
            <span className="network">
              <span
                className={"status-dot " + (env?.ready ? "online" : "offline")}
              />
              Local / Anvil
            </span>
            <button
              className="button wallet-button"
              onClick={() => void action(() => connect("extension"))}
              disabled={busy || !env?.ready}
            >
              <Icon name="wallet" />
              {wallet ? short(wallet.address) : "Kết nối ví"}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">TREASURY AGENT LAB</div>
              <h1>{titles[nav][0]}</h1>
              <p>{titles[nav][1]}</p>
            </div>
            <button
              className="button secondary refresh"
              onClick={() => void refresh()}
              aria-label="Làm mới dữ liệu"
            >
              <Icon name="refresh" />
              Làm mới
            </button>
          </div>
          <div className="environment-strip">
            <Icon name="shield" />
            <span>
              <strong>Môi trường thử nghiệm</strong> · Token và lợi suất mô
              phỏng. Bằng chứng luôn ghi rõ mạng và nguồn hành động.
            </span>
            <span className="strip-tag">MOCK ASSETS</span>
          </div>
          {message && (
            <div className={"notice " + message.kind} role="status">
              <span>{message.text}</span>
              <button
                aria-label="Đóng thông báo"
                onClick={() => setMessage(undefined)}
              >
                ×
              </button>
            </div>
          )}
          {pending && (
            <div className="notice info pending-box">
              <div>
                <strong>Giao dịch owner chưa được đối chiếu.</strong>
                <p>
                  {pending.hash
                    ? short(pending.hash)
                    : "Nếu ví đã gửi, nhập hash để kiểm tra. Không gửi một yêu cầu mới khi kết quả chưa rõ."}
                </p>
              </div>
              <input
                aria-label="Hash giao dịch owner"
                placeholder="0x…"
                value={pendingHash}
                onChange={(e) => setPendingHash(e.target.value)}
              />
              <button
                className="button secondary"
                onClick={() =>
                  void action(() =>
                    confirmPending(pending.id, pending.hash ?? pendingHash),
                  )
                }
              >
                Kiểm tra hash
              </button>
            </div>
          )}
          {env?.busy && (
            <div className="busy-banner">
              <span className="spinner" />
              Môi trường đang được khóa cho kiểm thử hoặc giao dịch owner. Dữ
              liệu danh mục giữ snapshot gần nhất.
            </div>
          )}
          {!env?.ready && !loading && (
            <Empty title="Môi trường local chưa sẵn sàng">
              {env?.reason ??
                "Khởi động môi trường theo README rồi làm mới dữ liệu."}
            </Empty>
          )}
          {nav === "treasury" && (
            <>
              <div className="metrics">
                <div className="metric">
                  <div className="metric-label">
                    Giá trị danh mục <Icon name="treasury" />
                  </div>
                  <div className="metric-value">
                    {money(treasury?.portfolio.totalValueUsd)}
                  </div>
                  <div className="metric-note">
                    {treasury
                      ? `Snapshot block #${treasury.portfolio.blockNumber.toLocaleString()}`
                      : "Đang đọc số dư on-chain"}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Hạn mức swap còn lại <Icon name="clock" />
                  </div>
                  <div className="metric-value">
                    {money(policy?.remainingCapUsd)}
                  </div>
                  <div className="cap-track">
                    <i
                      style={{
                        width:
                          policy && BigInt(policy.cap24hUsd) > 0n
                            ? `${Number(((BigInt(policy.cap24hUsd) - BigInt(policy.remainingCapUsd)) * 100n) / BigInt(policy.cap24hUsd))}%`
                            : "0%",
                      }}
                    />
                  </div>
                  <div className="metric-note">
                    Rolling 24 giờ · tối đa {money(policy?.cap24hUsd)}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Quyền của agent <Icon name="shield" />
                  </div>
                  <div className="metric-session">
                    {policy ? (
                      <Badge
                        value={
                          policy.paused || policy.isRevoked
                            ? "REVOKED"
                            : policy.sessionExpiresAt <=
                                (treasury?.portfolio.timestamp ?? 0)
                              ? "EXPIRED"
                              : "ACTIVE"
                        }
                      />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  <div className="metric-note">
                    Session {short(env?.session)} ·{" "}
                    {policy
                      ? `hết hạn ${date(new Date(policy.sessionExpiresAt * 1000).toISOString())}`
                      : "chưa có dữ liệu"}
                  </div>
                </div>
              </div>
              <div className="two-columns">
                <Panel
                  title="Danh mục tài sản"
                  meta={
                    <span className="muted">
                      {treasury?.portfolio.positions.length ?? 0} vị thế
                    </span>
                  }
                >
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Tài sản</th>
                          <th>Số dư</th>
                          <th>Giá trị</th>
                          <th>Tỷ trọng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {treasury?.portfolio.positions.map((p, i) => (
                          <tr key={p.tokenAddress + (p.vaultAddress ?? "")}>
                            <td>
                              <div className="asset">
                                <span className={"asset-icon asset-" + i}>
                                  {p.isVaultPosition ? "V" : p.symbol[0]}
                                </span>
                                <div>
                                  <strong>
                                    {p.isVaultPosition
                                      ? "Vault cho vay"
                                      : p.symbol}
                                  </strong>
                                  <small>
                                    {p.isVaultPosition
                                      ? "ERC-4626 · mô phỏng"
                                      : short(p.tokenAddress)}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              {formatUnits(BigInt(p.rawBalance), p.decimals)
                                .split(".")
                                .map((x, j) =>
                                  j === 0
                                    ? BigInt(x).toLocaleString("en-US")
                                    : "." + x.slice(0, 4),
                                )
                                .join("")}
                              <small className="cell-sub">
                                {p.isVaultPosition
                                  ? "underlying USDC"
                                  : p.symbol}
                              </small>
                            </td>
                            <td className="value-cell">{money(p.valueUsd)}</td>
                            <td>
                              <strong>
                                {(p.currentBps / 100).toFixed(1)}%
                              </strong>
                              <small className="cell-sub">
                                mục tiêu {(p.targetBps / 100).toFixed(1)}%
                              </small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!treasury && (
                    <Empty
                      title={
                        loading ? "Đang đọc danh mục…" : "Chưa có snapshot"
                      }
                    >
                      Khi kết nối node thành công, số dư sẽ được đọc trực tiếp
                      từ chain.
                    </Empty>
                  )}
                  <div className="yield-row">
                    <span>
                      <strong>Lãi vị thế vault</strong>
                      <small>
                        Tính từ lịch sử deposit/withdraw · chỉ là mô phỏng
                      </small>
                    </span>
                    <strong className="positive">
                      {treasury?.vaultYield?.available
                        ? money(treasury.vaultYield.valueUsd)
                        : "Chưa xác định"}
                    </strong>
                  </div>
                  {treasury?.vaultYield?.reason && (
                    <p className="table-note">{treasury.vaultYield.reason}</p>
                  )}
                </Panel>
                <Panel
                  title="Tỷ trọng mục tiêu"
                  meta={<span className="mini-label">AGENT RULES</span>}
                >
                  <p className="panel-description">
                    Agent xem xét tái cân bằng khi lệch trên 5 điểm phần trăm.
                  </p>
                  <div className="allocation-bar">
                    {alloc.map((v, i) => (
                      <i
                        key={i}
                        className={"allocation-" + i}
                        style={{
                          width: `${Math.max(0, Math.min(100, Number(v) || 0))}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="allocation-fields">
                    {["USDC trong ví", "Token A", "Vault cho vay"].map(
                      (label, i) => (
                        <label key={label}>
                          <span>
                            <i className={"legend-dot allocation-" + i} />
                            {label}
                          </span>
                          <div className="input-unit">
                            <input
                              aria-label={"Mục tiêu " + label}
                              value={alloc[i]}
                              inputMode="decimal"
                              onChange={(e) => {
                                setAlloc((a) =>
                                  a.map((v, j) =>
                                    i === j ? e.target.value : v,
                                  ),
                                );
                                setPreview(undefined);
                              }}
                            />
                            <span>%</span>
                          </div>
                        </label>
                      ),
                    )}
                  </div>
                  <div className="allocation-total">
                    <span>Tổng tỷ trọng</span>
                    <strong
                      className={
                        alloc.reduce((s, v) => s + Number(v), 0) === 100
                          ? "positive"
                          : "negative"
                      }
                    >
                      {alloc.reduce((s, v) => s + (Number(v) || 0), 0)}%
                    </strong>
                  </div>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={disabled || !env?.ready}
                      onClick={() =>
                        void action(async () => {
                          await saveTargets();
                          const p = await post<{ plan: RebalancePlan }>(
                            "/rebalance/preview",
                            {},
                          );
                          setPreview(p.plan);
                        })
                      }
                    >
                      Xem kế hoạch
                    </button>
                    <button
                      className="button primary"
                      disabled={
                        disabled ||
                        !env?.ready ||
                        policy?.isRevoked ||
                        policy?.paused
                      }
                      onClick={() => void action(() => requestRun("REBALANCE"))}
                    >
                      Chạy agent
                    </button>
                  </div>
                  <p className="fine-print">
                    Chạy theo snapshot mới. Hạn mức chỉ tính swap; gửi/rút vault
                    không trừ cap.
                  </p>
                </Panel>
              </div>
              {preview && (
                <Panel
                  title="Kế hoạch dự kiến"
                  meta={<Badge value={preview.status} />}
                >
                  <p className="plan-reason">{preview.ruleReasoning}</p>
                  <div className="plan-steps">
                    {preview.steps.map((s) => (
                      <div key={s.stepIndex}>
                        <span className="step-index">{s.stepIndex + 1}</span>
                        <strong>
                          {s.action === "SWAP_EXACT_IN"
                            ? "Swap token"
                            : s.action === "VAULT_DEPOSIT"
                              ? "Gửi vault"
                              : "Rút vault"}
                        </strong>
                        <span>{money(s.estimatedValueUsd)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
              <div className="two-columns policy-columns">
                <Panel
                  title="Giới hạn on-chain"
                  meta={<span className="mini-label">OWNER CONTROL</span>}
                >
                  <div className="policy-fields">
                    <label>
                      Cap swap / 24 giờ (USD)
                      <input
                        aria-label="Cap swap USD"
                        value={cap}
                        inputMode="decimal"
                        onChange={(e) => setCap(e.target.value)}
                      />
                    </label>
                    <label>
                      Slippage tối đa (%)
                      <input
                        aria-label="Slippage tối đa"
                        value={slippage}
                        inputMode="decimal"
                        onChange={(e) => setSlippage(e.target.value)}
                      />
                    </label>
                    <label>
                      Tuổi giá tối đa (giây)
                      <input
                        aria-label="Tuổi giá tối đa"
                        value={age}
                        inputMode="numeric"
                        onChange={(e) => setAge(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="policy-footer">
                    <p>
                      Token đầu ra và tiền rút phải về Safe.
                      <br />
                      Thay đổi giới hạn cần ví owner ký.
                    </p>
                    <button
                      className="button secondary"
                      disabled={disabled || !wallet}
                      onClick={() => void action(() => governance("policy"))}
                    >
                      Ký cập nhật policy
                    </button>
                  </div>
                </Panel>
                <Panel
                  title="Session & tài khoản"
                  meta={<Icon name="wallet" />}
                >
                  <dl className="address-list">
                    <div>
                      <dt>Smart account</dt>
                      <dd>
                        <Hash value={env?.addresses.Safe} />
                      </dd>
                    </div>
                    <div>
                      <dt>PolicyModule</dt>
                      <dd>
                        <Hash value={env?.addresses.PolicyModule} />
                      </dd>
                    </div>
                    <div>
                      <dt>Owner</dt>
                      <dd>
                        <Hash value={env?.owner} />
                      </dd>
                    </div>
                  </dl>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={disabled || !env?.ready}
                      onClick={() => void action(() => connect("anvil"))}
                    >
                      Dùng ví thử nghiệm Anvil
                    </button>
                    <button
                      className="button secondary"
                      disabled={disabled || !wallet}
                      onClick={() => void action(() => governance("grant"))}
                    >
                      Cấp quyền 24h
                    </button>
                    <button
                      className="button danger"
                      disabled={disabled || !wallet || policy?.isRevoked}
                      onClick={() => void action(() => governance("revoke"))}
                    >
                      Thu hồi quyền
                    </button>
                  </div>
                  <p className="fine-print">
                    Ví Anvil là tài khoản thử nghiệm được node ký. Backend không
                    lưu khóa owner.
                  </p>
                </Panel>
              </div>
            </>
          )}
          {nav === "lab" && (
            <>
              <div className="lab-overview">
                <div className="lab-overview-icon">
                  <Icon name="lab" />
                </div>
                <div>
                  <h2>Kiểm chứng quyền bằng trạng thái thật</h2>
                  <p>
                    Mỗi scenario được chạy độc lập và khôi phục snapshot sau khi
                    ghi bằng chứng.
                  </p>
                </div>
                <div className="lab-count">
                  <strong>{scenarios.length}</strong>
                  <span>tình huống</span>
                </div>
              </div>
              <div className="lab-toolbar">
                <div className="filters">
                  {[
                    "Tất cả",
                    "Normal",
                    "Cap",
                    "Whitelist",
                    "Session",
                    "Price",
                    "Execution",
                    "Vault",
                  ].map((c) => (
                    <button
                      key={c}
                      className={category === c ? "filter active" : "filter"}
                      onClick={() => setCategory(c)}
                    >
                      {c === "Normal" ? "Hợp lệ" : c}
                    </button>
                  ))}
                </div>
                <label className="network-select">
                  Mạng kiểm thử
                  <select
                    aria-label="Mạng kiểm thử"
                    value={scenarioEnv}
                    onChange={(e) =>
                      setScenarioEnv(e.target.value as "local" | "fuji")
                    }
                  >
                    <option value="local">Local / Anvil</option>
                    <option value="fuji">Fuji · UNSUPPORTED</option>
                  </select>
                </label>
              </div>
              <div className="selection-bar">
                <label>
                  <input
                    type="checkbox"
                    checked={
                      selected.length === scenarios.length &&
                      scenarios.length > 0
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? scenarios.map((s) => s.id) : [],
                      )
                    }
                  />
                  Chọn tất cả{" "}
                  <span className="muted">({selected.length} đã chọn)</span>
                </label>
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={disabled || !env?.ready}
                    onClick={() =>
                      void action(() =>
                        requestRun(
                          "SCENARIO",
                          scenarios.map((s) => s.id),
                        ),
                      )
                    }
                  >
                    Chạy cả bộ
                  </button>
                  <button
                    className="button primary"
                    disabled={disabled || selected.length === 0 || !env?.ready}
                    onClick={() => void action(() => requestRun("SCENARIO"))}
                  >
                    Chạy {selected.length} tình huống
                  </button>
                </div>
              </div>
              <div className="scenario-grid">
                {scenarios
                  .filter(
                    (s) => category === "Tất cả" || s.category === category,
                  )
                  .map((s) => (
                    <article
                      className={
                        "scenario-card " +
                        (selected.includes(s.id) ? "selected" : "")
                      }
                      key={s.id}
                    >
                      <div className="scenario-top">
                        <label className="scenario-select">
                          <input
                            type="checkbox"
                            aria-label={"Chọn " + s.id}
                            checked={selected.includes(s.id)}
                            onChange={(e) =>
                              setSelected((list) =>
                                e.target.checked
                                  ? [...list, s.id]
                                  : list.filter((id) => id !== s.id),
                              )
                            }
                          />
                          <span>{s.id}</span>
                        </label>
                        <span className="category-tag">{s.category}</span>
                      </div>
                      <h3>{s.title}</h3>
                      <p>{s.description}</p>
                      <div className="scenario-expectation">
                        <Icon name="shield" />
                        <span>{s.expectation}</span>
                      </div>
                      <div className="scenario-bottom">
                        <span className="source-label">
                          {s.source === "AGENT_RULE"
                            ? "Agent theo quy tắc"
                            : s.source === "HARNESS_MUTATED"
                              ? "Lệnh do harness sửa"
                              : "Lệnh session trực tiếp"}
                        </span>
                        <button
                          className="button text-button"
                          disabled={disabled || !env?.ready}
                          onClick={() =>
                            void action(() => requestRun("SCENARIO", [s.id]))
                          }
                        >
                          Chạy riêng
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            </>
          )}
          {nav === "results" && (
            <>
              <div className="result-summary">
                <span>
                  <strong>{runs.length}</strong> lượt lưu
                </span>
                <span className="positive">
                  <strong>{completed}</strong> PASS
                </span>
                <span>
                  <strong>{running}</strong> đang chờ/chạy
                </span>
                <small>
                  Lịch sử lưu bằng SQLite, giữ lại khi tải lại trang.
                </small>
              </div>
              {selectedRun && (
                <>
                  <div className="run-title">
                    <div>
                      <a className="back-link" href="#/results">
                        Toàn bộ lịch sử
                      </a>
                      <h2>
                        {scenarios.find((s) => s.id === selectedRun.scenarioId)
                          ?.title ?? "Tái cân bằng danh mục"}
                      </h2>
                      <p>
                        {selectedRun.scenarioId ?? "AGENT"} ·{" "}
                        {selectedRun.environment.toUpperCase()} ·{" "}
                        {date(selectedRun.createdAt)}
                      </p>
                    </div>
                    <div className="run-title-actions">
                      <Badge
                        value={selectedRun.verdict ?? selectedRun.status}
                      />
                      <a
                        className="button secondary"
                        href={
                          "/api/runs/" + selectedRun.id + "/export?format=json"
                        }
                      >
                        Tải JSON
                      </a>
                      <a
                        className="button secondary"
                        href={
                          "/api/runs/" + selectedRun.id + "/export?format=csv"
                        }
                      >
                        Tải CSV
                      </a>
                    </div>
                  </div>
                  <div
                    className={
                      "verdict-banner " +
                      (selectedRun.verdict ?? "RUNNING").toLowerCase()
                    }
                  >
                    <Icon
                      name={selectedRun.verdict === "PASS" ? "check" : "shield"}
                    />
                    <span>
                      {selectedRun.reason ??
                        "Lượt chạy đang được xử lý. Tiến trình và bằng chứng sẽ cập nhật tự động."}
                    </span>
                  </div>
                  <div className="two-columns results-columns">
                    <Panel
                      title="Tiến trình"
                      meta={
                        <span className="muted">
                          {selectedRun.steps.length} bước
                        </span>
                      }
                    >
                      <ol className="timeline">
                        {selectedRun.steps.map((s, i) => (
                          <li key={s.id}>
                            <span className="timeline-marker">{i + 1}</span>
                            <div>
                              <strong>{s.label}</strong>
                              <small>{date(s.timestamp)}</small>
                            </div>
                          </li>
                        ))}
                      </ol>
                      {selectedRun.steps.length === 0 && (
                        <p className="panel-description">
                          Đang chờ worker nhận lượt.
                        </p>
                      )}
                      <div className="cleanup-note">
                        {selectedRun.kind === "SCENARIO"
                          ? selectedRun.cleanup?.restored
                            ? "Snapshot đã khôi phục. Hash local thuộc nhánh kiểm thử lịch sử."
                            : selectedRun.cleanup?.restored === false
                              ? "Khôi phục thất bại; môi trường đã bị khóa."
                              : "Scenario sẽ khôi phục snapshot sau khi ghi bằng chứng."
                          : "Đây là giao dịch agent thật; trạng thái được giữ lại."}
                      </div>
                    </Panel>
                    <Panel
                      title="Điều kiện kiểm chứng"
                      meta={
                        <span className="muted">
                          {
                            selectedRun.assertions.filter((a) => a.passed)
                              .length
                          }
                          /{selectedRun.assertions.length}
                        </span>
                      }
                    >
                      <div className="assertions">
                        {selectedRun.assertions.map((a) => (
                          <details
                            key={a.id}
                            className={
                              a.passed ? "assertion passed" : "assertion failed"
                            }
                          >
                            <summary>
                              <span className="assert-icon">
                                {a.passed ? "✓" : "×"}
                              </span>
                              {a.label}
                            </summary>
                            <div>
                              <strong>Kỳ vọng</strong>
                              <code>{a.expected}</code>
                              <strong>Quan sát</strong>
                              <code>{a.observed}</code>
                            </div>
                          </details>
                        ))}
                      </div>
                      {selectedRun.assertions.length === 0 && (
                        <p className="panel-description">
                          Chưa có assertions. Không suy ra PASS từ thông báo
                          giao diện.
                        </p>
                      )}
                    </Panel>
                  </div>
                  {selectedRun.before && (
                    <Panel
                      title="Tài sản trước / sau"
                      meta={<span className="mini-label">CHAIN STATE</span>}
                    >
                      <StateTable run={selectedRun} />
                    </Panel>
                  )}
                  <Panel
                    title="Giao dịch kiểm thử"
                    meta={
                      <span className="muted">
                        {testTransactions.length} giao dịch
                      </span>
                    }
                  >
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Hành động</th>
                            <th>Nguồn</th>
                            <th>Receipt</th>
                            <th>Hash</th>
                            <th>Lỗi preflight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testTransactions.map((t, i) => (
                            <tr key={t.hash ?? i}>
                              <td>
                                {t.label}
                                <small className="cell-sub">
                                  Block #{t.blockNumber ?? "—"}
                                </small>
                              </td>
                              <td>
                                <span className="source-label">{t.source}</span>
                              </td>
                              <td>
                                <Badge
                                  value={
                                    t.receiptStatus === "success"
                                      ? "SUCCESS"
                                      : "REVERTED"
                                  }
                                />
                              </td>
                              <td>
                                <Hash value={t.hash} />
                              </td>
                              <td className="mono">{t.observedError ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!testTransactions.length && (
                      <p className="panel-description">
                        Chưa có giao dịch gửi lên chain.
                      </p>
                    )}
                    <details className="raw-evidence">
                      <summary>
                        Cấu hình policy, giao dịch setup và bằng chứng JSON
                      </summary>
                      <pre>{JSON.stringify(selectedRun, null, 2)}</pre>
                    </details>
                  </Panel>
                </>
              )}
              {!selectedRun && (
                <Panel
                  title="Lịch sử lượt chạy"
                  meta={<span className="mini-label">PERSISTED RUNS</span>}
                >
                  {runs.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Tình huống</th>
                            <th>Mạng</th>
                            <th>Thời gian</th>
                            <th>Kết quả</th>
                            <th>Bằng chứng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runs.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <a
                                  className="run-link"
                                  href={"#/results/" + r.id}
                                >
                                  {r.scenarioId ?? "AGENT"} ·{" "}
                                  {scenarios.find((s) => s.id === r.scenarioId)
                                    ?.title ?? "Tái cân bằng"}
                                </a>
                                <small className="cell-sub">
                                  {r.steps.at(-1)?.label ?? "Chờ worker"}
                                </small>
                              </td>
                              <td>{r.environment.toUpperCase()}</td>
                              <td>{date(r.createdAt)}</td>
                              <td>
                                <Badge value={r.verdict ?? r.status} />
                              </td>
                              <td>
                                {r.assertions.filter((a) => a.passed).length}/
                                {r.assertions.length} assertions
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty title="Chưa có lượt kiểm thử">
                      Chọn một tình huống trong Phòng kiểm thử để bắt đầu ghi
                      bằng chứng.
                    </Empty>
                  )}
                </Panel>
              )}
            </>
          )}
          <footer className="footer">
            <span>Treasury Agent Lab</span>
            <span>
              Policy được thực thi on-chain · Báo cáo dựa trên bằng chứng
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
