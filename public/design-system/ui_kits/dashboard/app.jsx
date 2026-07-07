/* app.jsx — DashboardApp shell: nav rail + active view. */

const { useState: useStateApp } = React;

function EmptyView({ title, eyebrow, headline, body, cta }) {
  return (
    <div className="screen-scroll">
      <window.TopBar eyebrow={eyebrow} title={title} />
      <div className="empty-state">
        <img src="../../assets/brand/honey-hive-icon.png" alt="" className="empty-icon" />
        <div className="empty-headline">{headline}</div>
        <p className="empty-body">{body}</p>
        <window.HMDS.Button>{cta}</window.HMDS.Button>
      </div>
    </div>
  );
}

function DashboardApp() {
  const [view, setView] = useStateApp("fleet");
  const [theme, setTheme] = useStateApp("dark");

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next === "light" ? "hive-light" : "");
  };

  let screen;
  if (view === "fleet") screen = <window.FleetScreen onChat={() => setView("chat")} />;
  else if (view === "chat") screen = <window.ChatScreen />;
  else if (view === "wallets") screen = <window.WalletsScreen />;
  else if (view === "swarm") screen = <EmptyView eyebrow="Coordination with attribution" title="Swarm" headline="No active swarm pass" body="Launch a multi-agent pass with /swarm in chat. You'll see the objective, who's assigned, the current phase, and what needs approval." cta="Start a swarm" />;
  else if (view === "brain") screen = <EmptyView eyebrow="Shared memory" title="Shared Brain" headline="No shared brain connected yet" body="Connect an Obsidian vault to give agents a common place for memory, handoffs, and shared project context." cta="Connect a vault" />;
  else if (view === "security") screen = <EmptyView eyebrow="Trust made visible" title="Security" headline="Your fleet is private by default" body="Everything runs on your Tailnet with read-only collectors and no public ports. Secrets are stored locally and never exposed in overview UI." cta="Review trust posture" />;

  return (
    <div className="app-shell">
      <window.NavRail active={view} onNavigate={setView} theme={theme} onToggleTheme={toggleTheme} />
      <main className="app-main">{screen}</main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<DashboardApp />);
