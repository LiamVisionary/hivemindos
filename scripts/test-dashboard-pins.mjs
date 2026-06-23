#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-dashboard-pins-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = join(tempHome, "missing-vault");
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "a".repeat(64);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "b".repeat(64);

try {
  const pins = await import("../src/lib/services/dashboard-pins.ts");
  const kanban = await import("../src/lib/services/kanban/local-kanban-store.ts");
  const route = await import("../src/app/api/dashboard/pins/route.ts");
  const { NextRequest } = await import("next/server");

  await assert.rejects(
    () => pins.createDashboardPin({ route: "wallet", comment: "missing slash" }),
    /route must start/,
  );
  await assert.rejects(
    () => pins.createDashboardPin({ route: "/wallet", comment: " " }),
    /comment is required/,
  );
  await assert.rejects(
    () =>
      pins.createDashboardPin({
        route: "/wallet",
        comment: "absolute path must not leak",
        sourceFileHint: "/Users/liam/private.tsx",
      }),
    /relative project path/,
  );

  const created = await pins.createDashboardPin({
    route: "/?view=wallet",
    comment: "The wallet setup affordance needs clearer copy.",
    selector: "[data-testid='wallet-setup']",
    textSnippet: "Create or Import Wallet",
    componentHint: "WalletPanel",
    sourceFileHint: "src/features/dashboard/views/WalletPanel.tsx",
    boundingBox: { x: 12, y: 24, width: 320, height: 44 },
  });
  assert.equal(created.pin.status, "open");
  assert.equal(created.pin.route, "/?view=wallet");
  assert.equal(created.pin.sourceFileHint, "src/features/dashboard/views/WalletPanel.tsx");

  const open = await pins.listDashboardPins({ status: "open" });
  assert.equal(open.pins.length, 1);

  const resolved = await pins.updateDashboardPinStatus(created.pin.id, "resolved");
  assert.equal(resolved.pin.status, "resolved");
  assert.equal((await pins.listDashboardPins({ status: "open" })).pins.length, 0);

  const workPin = await pins.createDashboardPin({
    route: "/?view=fleet",
    comment: "Add a visible retry affordance near stale fleet snapshots.",
    textSnippet: "Last seen 8m ago",
  });
  const sent = await pins.sendDashboardPinToWorkBoard(workPin.pin.id);
  assert.equal(sent.pin.status, "sent-to-work-board");
  assert.equal(typeof sent.taskId, "string");
  const sentAgain = await pins.sendDashboardPinToWorkBoard(workPin.pin.id);
  assert.equal(sentAgain.created, false, "sending the same pin should be idempotent");
  assert.equal(sentAgain.taskId, sent.taskId);

  const board = await kanban.readBoard(null);
  const task = board.tasks.find((item) => item.id === sent.taskId);
  assert.ok(task, "pin should create a Work Board task");
  assert.equal(task?.source, `dashboard-pin:${workPin.pin.id}`);
  assert.match(task?.body ?? "", /Last seen 8m ago/);

  await pins.deleteDashboardPin(created.pin.id);
  assert.equal((await pins.readDashboardPins()).pins.some((pin) => pin.id === created.pin.id), false);

  const rawStore = await readFile(
    join(tempHome, ".hivemindos", "dashboard-pins.json"),
    "utf8",
  );
  assert.match(rawStore, /sent-to-work-board/);

  const anonymous = await route.GET(new NextRequest("http://127.0.0.1/api/dashboard/pins"));
  assert.equal(anonymous.status, 401);

  const apiCreate = await route.POST(authenticatedRequest(NextRequest, "http://127.0.0.1/api/dashboard/pins", {
    action: "create",
    route: "/?view=brain",
    comment: "Surface pending review proposals in the brain view.",
  }));
  assert.equal(apiCreate.status, 200);
  const apiCreateBody = await apiCreate.json();
  assert.equal(apiCreateBody.ok, true);
  assert.equal(apiCreateBody.pin.status, "open");

  const apiList = await route.GET(authenticatedRequest(NextRequest, "http://127.0.0.1/api/dashboard/pins?status=open"));
  assert.equal(apiList.status, 200);
  const apiListBody = await apiList.json();
  assert.ok(apiListBody.pins.some((pin) => pin.id === apiCreateBody.pin.id));

  const apiUpdate = await route.POST(authenticatedRequest(NextRequest, "http://127.0.0.1/api/dashboard/pins", {
    action: "update-status",
    id: apiCreateBody.pin.id,
    status: "archived",
  }));
  assert.equal(apiUpdate.status, 200);
  assert.equal((await apiUpdate.json()).pin.status, "archived");

  const apiDelete = await route.DELETE(authenticatedRequest(
    NextRequest,
    `http://127.0.0.1/api/dashboard/pins?id=${apiCreateBody.pin.id}`,
  ));
  assert.equal(apiDelete.status, 200);

  console.log("Dashboard pins store and API tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function authenticatedRequest(NextRequest, url, body) {
  return new NextRequest(url, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-hivemindos-device-token": process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
