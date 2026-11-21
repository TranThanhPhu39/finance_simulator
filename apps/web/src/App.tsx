import { lazy, Suspense } from "react";
const SimulationApp = lazy(() =>
  import("./SimulationApp").then((m) => ({ default: m.SimulationApp })),
);
const OnchainApp = lazy(() =>
  import("./OnchainApp").then((m) => ({ default: m.OnchainApp })),
);
export function App() {
  const onchain =
    new URLSearchParams(window.location.search).get("mode") === "onchain";
  return (
    <>
      <nav className="mode-switch" aria-label="Chế độ thực thi">
        <a
          href="/?mode=simulation"
          aria-current={!onchain ? "page" : undefined}
        >
          Mô phỏng & Launchpad
        </a>
        <a href="/?mode=onchain" aria-current={onchain ? "page" : undefined}>
          On-chain Anvil
        </a>
        <span>
          {onchain
            ? "Giao dịch thật trên Anvil · chain 31337"
            : "Mô phỏng · Không gửi giao dịch blockchain"}
        </span>
      </nav>
      <Suspense fallback={<p role="status">Đang tải dashboard…</p>}>
        {onchain ? (
          <div className="onchain-app">
            <OnchainApp />
          </div>
        ) : (
          <SimulationApp />
        )}
      </Suspense>
    </>
  );
}
