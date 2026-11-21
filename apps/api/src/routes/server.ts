import http from "node:http";
import { URL } from "node:url";
import { TreasuryApiService } from "../services/treasury-service";

async function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, c) => sum + c.length, 0) > 65536)
      throw Object.assign(new Error("Request quá lớn."), { status: 413 });
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(payload));
}

export function createSimulationHandler(service: TreasuryApiService) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && (pathname === "/health" || pathname === "/")) {
        sendJson(res, 200, { status: "ok", service: "treasury-agent-lab-api" });
        return;
      }

      if (method === "GET" && pathname === "/environment") {
        sendJson(res, 200, service.getEnvironment());
        return;
      }

      if (method === "GET" && pathname === "/treasury") {
        sendJson(res, 200, service.getTreasuryOverview());
        return;
      }

      if (method === "POST" && pathname === "/treasury/policy") {
        const body = await readJsonBody(req);
        const overview = service.updatePolicy({
          cap24hUsd:
            body.cap24hUsd !== undefined ? String(body.cap24hUsd) : undefined,
          maxSlippageBps:
            body.maxSlippageBps !== undefined
              ? Number(body.maxSlippageBps)
              : undefined,
          maxPriceAgeSec:
            body.maxPriceAgeSec !== undefined
              ? Number(body.maxPriceAgeSec)
              : undefined,
          paused: body.paused !== undefined ? Boolean(body.paused) : undefined,
        });
        sendJson(res, 200, overview);
        return;
      }

      if (method === "POST" && pathname === "/treasury/reset") {
        sendJson(res, 200, service.resetTreasury());
        return;
      }

      if (method === "POST" && pathname === "/treasury/kill-switch") {
        const body = await readJsonBody(req);
        const revoked =
          body.revoked !== undefined ? Boolean(body.revoked) : true;
        sendJson(res, 200, service.setKillSwitch(revoked));
        return;
      }

      if (method === "POST" && pathname === "/treasury/session/grant") {
        sendJson(res, 200, service.setKillSwitch(false));
        return;
      }

      if (method === "POST" && pathname === "/rebalance/preview") {
        const preview = await service.previewRebalance();
        sendJson(res, 200, preview);
        return;
      }

      if (method === "POST" && pathname === "/rebalance/execute") {
        const result = await service.executeRebalance();
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && pathname === "/scenarios") {
        sendJson(res, 200, service.getScenarios());
        return;
      }

      if (method === "POST" && pathname === "/runs") {
        const body = await readJsonBody(req);
        if (body.executionMode && body.executionMode !== "SIMULATED_POLICY") {
          sendJson(res, 400, {
            error:
              "Chế độ này chỉ mô phỏng. Dùng API on-chain riêng để chạy Anvil.",
          });
          return;
        }
        const results = await service.triggerScenarioRun({
          scenarioId: body.scenarioId,
          scenarioIds: body.scenarioIds,
          env: body.env,
          executionMode: body.executionMode,
        });
        sendJson(res, 200, {
          run: results[0],
          runs: results,
        });
        return;
      }

      if (method === "GET" && pathname === "/runs") {
        sendJson(res, 200, service.listRuns());
        return;
      }

      const exportMatch = pathname.match(/^\/runs\/([^/]+)\/export$/);
      if (method === "GET" && exportMatch) {
        const runId = decodeURIComponent(exportMatch[1]);
        const format =
          url.searchParams.get("format") === "csv" ? "csv" : "json";
        const exported = service.exportRun(runId, format);
        if (!exported) {
          sendJson(res, 404, { error: `Run ${runId} not found.` });
          return;
        }
        res.writeHead(200, {
          "Content-Type": exported.contentType,
          "Content-Disposition": `attachment; filename="${exported.filename}"`,
        });
        res.end(exported.body);
        return;
      }

      const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
      if (method === "GET" && runMatch) {
        const runId = decodeURIComponent(runMatch[1]);
        const run = service.getRun(runId);
        if (!run) {
          sendJson(res, 404, { error: `Run ${runId} not found.` });
          return;
        }
        sendJson(res, 200, run);
        return;
      }

      // Topic 16 Launchpad routes
      if (method === "GET" && pathname === "/launchpad/prices") {
        const feeds = await service.getLaunchpadPrices();
        sendJson(res, 200, feeds);
        return;
      }

      if (method === "GET" && pathname === "/launchpad/agents") {
        sendJson(res, 200, service.listLaunchpadAgents());
        return;
      }

      if (method === "POST" && pathname === "/launchpad/agents") {
        const body = await readJsonBody(req);
        const agent = service.registerLaunchpadAgent({
          name: String(body.name || "Unnamed Quant Agent"),
          strategyType: String(body.strategyType || "ERC4626_CARRY"),
          bondUsdc: String(body.bondUsdc || "250000000"),
        });
        sendJson(res, 201, agent);
        return;
      }

      if (
        method === "POST" &&
        (pathname === "/launchpad/paper-trade" ||
          pathname === "/launchpad/trade")
      ) {
        const body = await readJsonBody(req);
        const result = await service.runLaunchpadPaperTrade({
          agentId: String(body.agentId),
          symbol: body.symbol,
          side: body.side,
          notionalUsd: body.notionalUsd,
          simulateViolation: Boolean(body.simulateViolation),
        });
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && pathname === "/launchpad/actions") {
        const agentId = url.searchParams.get("agentId") ?? undefined;
        sendJson(res, 200, service.listLaunchpadActions(agentId));
        return;
      }

      sendJson(res, 404, { error: `Route ${method} ${pathname} not found.` });
    } catch (error) {
      sendJson(
        res,
        error instanceof SyntaxError
          ? 400
          : Number((error as { status?: number }).status ?? 500),
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };
}
export function createApiServer(service: TreasuryApiService): http.Server {
  return http.createServer(createSimulationHandler(service));
}
