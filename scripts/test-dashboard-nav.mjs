import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const derivedState = readFileSync(new URL("../src/features/dashboard/hooks/use-dashboard-derived-state.tsx", import.meta.url), "utf8");
const dashboardApp = readFileSync(new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url), "utf8");
const pollingEffects = readFileSync(new URL("../src/features/dashboard/hooks/use-dashboard-polling-effects.tsx", import.meta.url), "utf8");
const dashboardHeader = readFileSync(new URL("../src/features/dashboard/views/DashboardHeader.tsx", import.meta.url), "utf8");
const appNavShelf = readFileSync(new URL("../src/components/fleet-hive/AppNavShelf.tsx", import.meta.url), "utf8");
const dashboardSecurityControl = readFileSync(new URL("../src/features/dashboard/DashboardSecurityControl.tsx", import.meta.url), "utf8");
const appNavShelfCss = readFileSync(new URL("../src/components/fleet-hive/app-nav-shelf.css", import.meta.url), "utf8");
const morePanel = readFileSync(new URL("../src/features/dashboard/MorePanel.tsx", import.meta.url), "utf8");
const kanbanBoardUtils = readFileSync(new URL("../src/lib/utils/kanban-board.ts", import.meta.url), "utf8");

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
    ["kanban", "vault", "chat"],
    ["scheduler", "history"],
    ["notifications"],
  ],
  "The default app rail should keep seven stable routes and leave optional destinations in More",
);
assert.equal(navigation.shelfSlotForView("agents"), "agents", "Fleet lights the brand slot");
assert.equal(navigation.shelfSlotForView("my-apps"), "integrations", "Apps & Services lights the Integrations slot");
assert.equal(navigation.shelfSlotForView("memory"), "more", "Memory lights the More slot");
assert.equal(navigation.shelfSlotForView("env"), "more", "Unpinned utility views light the More slot");
assert.equal(navigation.DASHBOARD_ROUTE_LABELS.history, "Work History", "Route labels derive from the catalog");
assert.ok(navigation.DASHBOARD_UTILITY_VIEWS.includes("env"), "Utilities set includes env (the More grid renders every utility view)");
assert.ok(navigation.DASHBOARD_UTILITY_VIEWS.includes("cloud"), "Utilities set includes managed Cloud Agents");
assert.ok(navigation.DASHBOARD_UTILITY_VIEWS.includes("mini-apps"), "Utilities set includes HivemindOS Mini Apps");
assert.equal(
  navigation.dashboardTargetFromSearch("?view=integrations&tab=xbot")?.integrationsTab,
  "xbot",
  "Desktop X OAuth returns should preserve the X Bot subtab through dashboard navigation",
);
assert.match(
  navigation.dashboardUrlForTarget({ view: "integrations", integrationsTab: "xbot" }),
  /tab=xbot/,
  "Dashboard URLs should serialize the X Bot subtab",
);
assert.match(dashboardApp, /activeView === "mini-apps" \? <MiniAppsPanel[ /]/, "Dashboard should render the dedicated Mini Apps view");
assert.match(morePanel, /title: "HivemindOS Mini Apps"/, "More launcher should expose HivemindOS Mini Apps");

assert.match(
  appNavShelf,
  /<NavShelfItem[\s\S]*?badge=\{navBadges\[it\.id\]\}/,
  "Pinned shelf items should receive per-route badge counts",
);
assert.match(
  appNavShelf,
  /<div className="fr-shelf-control-row" role="group" aria-label="Dashboard controls">[\s\S]*?<DashboardSecurityControl onTooltipOpenChange=\{setSecurityTooltipOpen\} \/>[\s\S]*?<Tooltip onOpenChange=\{setThemeTooltipOpen\}>[\s\S]*?aria-label=\{theme === "light" \? "Switch to dark mode" : "Switch to light mode"\}[\s\S]*?<TooltipContent side="right" className="z-\[80\]">/,
  "Security and theme should share the compact footer control row with the custom tooltip treatment",
);
assert.match(
  dashboardSecurityControl,
  /<Tooltip onOpenChange=\{onTooltipOpenChange\}>[\s\S]*?<TooltipTrigger asChild>[\s\S]*?aria-label="Dashboard security"[\s\S]*?<TooltipContent side="right" className="z-\[80\]">Manage security and passkeys<\/TooltipContent>/,
  "The icon-only Security control should explain itself through the custom tooltip",
);
assert.match(
  appNavShelf,
  /data-footer-tooltip-open=\{footerTooltipOpen \? "true" : undefined\}/,
  "The shelf should expose the footer tooltip state so portalled content can hold the expanded rail open",
);
assert.doesNotMatch(dashboardSecurityControl, /fr-nav-label/, "The Security footer action should not render a visible label");
assert.doesNotMatch(appNavShelf, /fr-nav-label">\{theme === "light"/, "The theme footer action should not render a visible label");
assert.match(
  appNavShelfCss,
  /\.fr-shelf:hover \.fr-shelf-control-row,[\s\S]*?grid-template-columns: repeat\(2, 44px\)/,
  "Security and theme controls should sit side by side when the shelf opens",
);
assert.match(
  appNavShelfCss,
  /\.fr-shelf\[data-footer-tooltip-open="true"\][\s\S]*?width: 238px[\s\S]*?\.fr-shelf\[data-footer-tooltip-open="true"\] \.fr-shelf-control-row/,
  "An open footer tooltip should preserve the complete expanded shelf state",
);
assert.match(
  kanbanBoardUtils,
  /export function needsHumanKanbanTaskCount\(tasks: KanbanTask\[\]\)/,
  "Work nav badge counts should share the Kanban attention helper",
);
assert.match(
  dashboardApp,
  /const \[kanbanNavBadgeCount, setKanbanNavBadgeCount\] = useState<number \| null>\(null\)/,
  "DashboardApp should keep a Work nav badge count that is independent of the mounted Kanban board",
);
assert.match(
  dashboardApp,
  /kanban:\s*kanbanNavBadgeCount \?\? \(kanbanBoard \? needsHumanKanbanTaskCount\(kanbanBoard\.tasks\) : 0\)/,
  "Work nav badge should count Needs You items, including before the Kanban panel is opened",
);
assert.match(
  pollingEffects,
  /activeView === "kanban"[\s\S]*?window\.setInterval\(refreshVisibleKanbanNavBadge, 60_000\)/,
  "Dashboard polling should keep the Work nav badge warm while the Work tab is not active",
);
assert.match(
  pollingEffects,
  /setKanbanNavBadgeCount\(data\.counts\["needs-human"\] \?\? 0\)/,
  "Background Kanban polling should update the Needs You nav badge from a count-only response",
);
assert.match(
  morePanel,
  /const notifBadge = notificationUnread > 0[\s\S]*?badge:\s*`\$\{notificationUnread\} unread`[\s\S]*?notifications:\s*\{[\s\S]*?\.\.\.notifBadge/,
  "The More launcher should still surface the unread count on the Alerts card",
);

console.log("Dashboard nav has the expected top-level buttons, derived shelf groups, and no duplicate ids.");
