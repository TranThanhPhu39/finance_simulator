import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test("default dashboard keeps simulation suite, exports and Launchpad without wallet sends", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    (window as unknown as { walletSendCount: number }).walletSendCount = 0;
    window.ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_sendTransaction")
          (window as unknown as { walletSendCount: number }).walletSendCount++;
        throw { code: 4001 };
      },
    } as never;
  });
  await page.goto("/");
  await expect(
    page.getByText("Mô phỏng · Không gửi giao dịch blockchain", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Owner mô phỏng", exact: true })
    .click();
  await expect(
    page.getByText("Owner mô phỏng đã sẵn sàng.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /2\. Phòng Lab/ }).click();
  await page
    .getByRole("button", {
      name: "Chạy Toàn Bộ 10 Tình Huống (Run Full Suite)",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Đã chạy xong toàn bộ Suite: 10/10 tình huống đạt PASS."),
  ).toBeVisible();
  await page.getByRole("button", { name: /3\. Bằng Chứng/ }).click();
  await expect(
    page.getByRole("heading", { name: "Lịch Sử Lượt Chạy (SQLite)" }),
  ).toBeVisible();
  const stored = await (await page.request.get("/api/simulation/runs")).json();
  expect(stored.length).toBeGreaterThanOrEqual(10);
  expect(
    stored.every(
      (r: { executionMode: string }) => r.executionMode === "SIMULATED_POLICY",
    ),
  ).toBe(true);
  const csv = await page.request.get(
    "/api/simulation/runs/" + stored[0].runId + "/export?format=csv",
  );
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain(stored[0].runId);
  await page.getByRole("button", { name: /4\. Launchpad/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Bảng Xếp Hạng StockAgent Launchpad (Topic 16 Leaderboard)",
    }),
  ).toBeVisible();
  const name = "Merge Regression " + Date.now();
  await page.locator('form input[type="text"]').fill(name);
  await page
    .getByRole("button", { name: "Đăng Ký & Cấp Mã ERC-8004", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Paper Trade", exact: true }).click();
  await expect(row.getByText("GRADUATED", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Slash", exact: true }).click();
  await expect(row.getByText("SLASHED", { exact: true })).toBeVisible();
  await mkdir(".runtime/screenshots", { recursive: true });
  await page.screenshot({
    path: ".runtime/screenshots/merged-launchpad-desktop.png",
  });
  expect(
    await page.evaluate(
      () => (window as unknown as { walletSendCount: number }).walletSendCount,
    ),
  ).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".runtime/screenshots/merged-launchpad-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "On-chain Anvil", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quỹ & chính sách", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
