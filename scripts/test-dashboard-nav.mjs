import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const derivedState = readFileSync(new URL("../src/features/dashboard/hooks/use-dashboard-derived-state.tsx", import.meta.url), "utf8");
const dashboardHeader = readFileSync(new URL("../src/features/dashboard/views/DashboardHeader.tsx", import.meta.url), "utf8");

assert.doesNotMatch(derivedState, /type DashboardView = [^;]*"new"/, "DashboardView should not include the removed test New tab id");
assert.doesNotMatch(derivedState, /id: "new" as const,[\s\S]*?label: "New"/, "Dashboard nav items should not include the removed test New tab");
assert.doesNotMatch(derivedState, /new: \{ label: "New", title: "New test tab" \}/, "Dashboard header copy should not include the removed test New tab");

// Tolerate formatter reflow of the useMemo callback and deps-array boundary.
const navItemsBlock = derivedState.match(/const navItems = useMemo\(\s*\(\) => \[([\s\S]*?)\n\s+\],\s*\[/);
assert.ok(navItemsBlock, "Dashboard nav items block should be present");

const ids = [...navItemsBlock[1].matchAll(/id: "([^"]+)" as const/g)].map((match) => match[1]);
assert.deepEqual([...new Set(ids)], ids, "Dashboard nav ids should be unique");
assert.equal(ids.filter((id) => id === "chat").length, 1, "Dashboard nav should include exactly one Chat tab");
assert.equal(ids.filter((id) => id === "new").length, 0, "Dashboard nav should not include a New tab");
assert.doesNotMatch(dashboardHeader, /"new"/, "Dashboard header copy should not include the removed test New tab");

// The rendered rail derives from the view registry (the old DashboardHeader tab
// list is gone) — assert the real derived shelf composition and slot mapping.
const navigation = await import(new URL("../src/features/dashboard/dashboard-navigation.ts", import.meta.url));
assert.deepEqual(
  navigation.APP_NAV_SHELF_GROUPS.map((group) => group.map((item) => item.id)),
  [
    ["kanban", "vault", "chat", "wallet", "trade"],
    ["scheduler", "swarm", "history"],
    ["aeon", "integrations", "maintenance"],
  ],
  "App nav shelf groups should derive Work/Brain/Chat/Wallets/Trade, Schedules/Swarm/History, Aeon/Integrations/Diagnostics",
);
assert.equal(navigation.shelfSlotForView("agents"), "agents", "Fleet lights the brand slot");
assert.equal(navigation.shelfSlotForView("my-apps"), "integrations", "Apps & Services lights the Integrations slot");
assert.equal(navigation.shelfSlotForView("memory"), "maintenance", "Memory lights the Diagnostics slot");
assert.equal(navigation.shelfSlotForView("env"), "more", "Unpinned utility views light the More slot");
assert.equal(navigation.DASHBOARD_ROUTE_LABELS.history, "Work History", "Route labels derive from the catalog");
assert.ok(navigation.DASHBOARD_UTILITY_VIEWS.includes("env"), "Utilities set includes env (the More grid renders every utility view)");

console.log("Dashboard nav has the expected top-level buttons, derived shelf groups, and no duplicate ids.");
