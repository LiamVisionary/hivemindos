/* Dashboard shell — left nav rail + top bar + shared bits, ported cosmetically
   from AppNavShelf.tsx / globals.css. Exports to window for the other screens. */

const { useState } = React;
const HMDS = window.HivemindOSDesignSystem_65eabf;

const NAV = [
  { id: "fleet", label: "Fleet" },
  { id: "chat", label: "Chat" },
  { id: "swarm", label: "Swarm" },
  { id: "brain", label: "Brain" },
  { id: "wallets", label: "Wallets" },
  { id: "security", label: "Security" },
];

function NavIcon({ id }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (id) {
    case "fleet": return (<svg {...p}><polygon points="12 2 20 7 20 17 12 22 4 17 4 7" /><circle cx="12" cy="12" r="2.4" /></svg>);
    case "chat": return (<svg {...p}><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z" /></svg>);
    case "swarm": return (<svg {...p}><circle cx="12" cy="12" r="2" /><circle cx="5" cy="6.5" r="1.6" /><circle cx="19" cy="6.5" r="1.6" /><circle cx="5.5" cy="18" r="1.6" /><circle cx="18.5" cy="18" r="1.6" /><path d="M10.4 10.7 6.3 7.6M13.6 10.7l3.9-3M10.6 13.4 6.7 16.6M13.4 13.4l3.6 3" /></svg>);
    case "brain": return (<svg {...p}><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.5A3 3 0 0 0 9 18V4z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.5A3 3 0 0 1 15 18V4z" /></svg>);
    case "wallets": return (<svg {...p}><rect x="3" y="6" width="18" height="13" rx="2.2" /><path d="M3 9.5h18" /><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" /></svg>);
    case "security": return (<svg {...p}><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z" /><path d="m9.5 12 1.8 1.8L15 10" /></svg>);
    default: return null;
  }
}

function NavRail({ active, onNavigate, theme, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  return (
    <nav
      className="nav-rail"
      data-open={open ? "" : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="nav-brand" onClick={() => onNavigate("fleet")} title="HivemindOS · Fleet">
        <img src="../../assets/logo/icon-512.png" alt="HivemindOS" />
        <span className="nav-label">HivemindOS</span>
      </button>
      <div className="nav-group">
        {NAV.map((n) => (
          <button key={n.id} className="nav-item" data-active={active === n.id ? "" : undefined} onClick={() => onNavigate(n.id)} title={n.label}>
            <span className="nav-ico"><NavIcon id={n.id} /></span>
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
      </div>
      <div className="nav-foot">
        <button className="nav-item" onClick={onToggleTheme} title="Toggle theme">
          <span className="nav-ico">
            {theme === "light"
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></svg>}
          </span>
          <span className="nav-label">{theme === "light" ? "Dark mode" : "Light mode"}</span>
        </button>
        <div className="nav-ver">v0.18.2</div>
      </div>
    </nav>
  );
}

function TopBar({ title, eyebrow, children }) {
  return (
    <header className="topbar">
      <div>
        <div className="topbar-eyebrow">{eyebrow}</div>
        <h1 className="topbar-title">{title}</h1>
      </div>
      <div className="topbar-right">{children}</div>
    </header>
  );
}

// Health chip used in top bars
function HealthChip({ dot, label }) {
  return (
    <span className="health-chip">
      <HMDS.StatusDot tone={dot} />
      <span>{label}</span>
    </span>
  );
}

Object.assign(window, { NavRail, TopBar, HealthChip, HMDS });
