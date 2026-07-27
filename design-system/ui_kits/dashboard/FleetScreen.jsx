/* FleetScreen — the default Fleet Hive view. The Queen orchestrator at the
   heart, machines ringed as honeycomb cards, each agent a hex petal.
   Machines first, agents second (per UI_RULES). */

const HM = window.HivemindOSDesignSystem_65eabf;

const MACHINES = [
  {
    id: "atlas", name: "atlas", role: "Primary", os: "macOS 15.3 · M3 Max", loc: "Studio · Brooklyn",
    cpu: 38, ram: 62, ver: "v0.18.2", verState: "current",
    agents: [
      { name: "Hermes-α", role: "Lead", tone: "live", bee: "worker-bee-code", task: "Refactoring the swarm agent bridge over Tailscale SSH", since: "2m", badge: ["success", "Working"] },
      { name: "OpenClaw-eng", role: "Engineer", tone: "neutral", bee: "worker-bee-ops", task: "Idle · waiting for next handoff from Hermes-α", since: "11m", badge: ["secondary", "Ready"] },
      { name: "Aeon-night", role: "Background", tone: "neutral", bee: "worker-bee-planner", task: "Nightly skill index rebuild · 02:00 UTC", since: "5h", badge: ["honey", "Scheduled"] },
    ],
  },
  {
    id: "nimbus", name: "nimbus", role: "Workhorse", os: "Ubuntu 24.04 · 32c/128G", loc: "us-east-2 · Hetzner",
    cpu: 71, ram: 48, ver: "v0.18.2", verState: "current",
    agents: [
      { name: "MiroShark-sim", role: "Simulator", tone: "live", bee: "worker-bee-research", task: "Running market-making sim · epoch 8410 / 12000", since: "23m", badge: ["success", "Working"] },
      { name: "Hermes-research", role: "Research", tone: "live", bee: "worker-bee-writer", task: "Synthesizing the research dump into an Obsidian brief", since: "1m", badge: ["warning", "Low compute"] },
      { name: "OpenClaw-x", role: "Channels", tone: "danger", bee: "worker-bee-security", task: "Auth handshake failed against X channel — needs re-login", since: "1h", badge: ["danger", "Failed"] },
    ],
  },
  {
    id: "lattice", name: "lattice", role: "Roaming", os: "macOS 15.3 · M2", loc: "Café · Lisbon",
    cpu: 12, ram: 28, ver: "v0.18.0", verState: "stale",
    agents: [
      { name: "Hermes-mobile", role: "Inbox", tone: "neutral", bee: "worker-bee-qa", task: "Idle · brain sync paused while on hotspot", since: "8m", badge: ["secondary", "Ready"] },
      { name: "Gemini-notes", role: "Notes", tone: "neutral", bee: "worker-bee-general", task: "Needs API key · hive-env-add GOOGLE_API_KEY", since: "—", badge: ["warning", "Needs setup"] },
    ],
  },
];

function AgentRow({ a, onChat }) {
  return (
    <div className="agent-row">
      <HM.HexCell tone={a.tone} pulse={a.tone === "live"} size={46}>
        <img src={`../../assets/bees/${a.bee}.png`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </HM.HexCell>
      <div className="agent-main">
        <div className="agent-head">
          <strong>{a.name}</strong>
          <HM.Badge variant={a.badge[0]}>{a.badge[1]}</HM.Badge>
        </div>
        <div className="agent-task">{a.task}</div>
      </div>
      <div className="agent-side">
        <span className="agent-since">{a.since}</span>
        <HM.Button size="xs" variant="ghost" onClick={onChat}>Chat</HM.Button>
      </div>
    </div>
  );
}

function MachineCard({ m, onChat }) {
  const working = m.agents.filter((a) => a.tone === "live").length;
  return (
    <HM.Card className="machine-card">
      <div className="machine-head">
        <div>
          <div className="machine-title">
            <span className="machine-name">{m.name}</span>
            <HM.Badge variant="outline">{m.role}</HM.Badge>
            {m.verState === "stale" ? <HM.Badge variant="warning">Update ready</HM.Badge> : null}
          </div>
          <div className="machine-os">{m.os} · {m.loc}</div>
        </div>
        <div className="machine-metrics">
          <span>CPU {m.cpu}%</span><span>RAM {m.ram}%</span>
        </div>
      </div>
      <div className="machine-agents">
        {m.agents.map((a) => <AgentRow key={a.name} a={a} onChat={onChat} />)}
      </div>
      <div className="machine-foot">
        <HM.StatusDot tone="working" label={`${m.agents.length} agents · ${working} working`} />
        <div style={{ display: "flex", gap: 8 }}>
          <HM.Button size="sm" variant="outline">Shell</HM.Button>
          <HM.Button size="sm">Open details</HM.Button>
        </div>
      </div>
    </HM.Card>
  );
}

function QueenBanner() {
  return (
    <div className="queen-banner">
      <HM.HexCell tone="honey" pulse size={104}>
        <img src="../../assets/bees/queen-bee.png" alt="Queen" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </HM.HexCell>
      <div className="queen-copy">
        <div className="queen-eyebrow">Queen orchestrator</div>
        <div className="queen-title">The hive is coordinated</div>
        <p className="queen-lede">3 machines online · 8 agents · 4 working. Planner created 2 tasks, Coder is shipping the swarm bridge, Reviewer flagged 1 risk on nimbus.</p>
      </div>
      <div className="queen-actions">
        <HM.Button>Ask the Queen</HM.Button>
        <HM.Button variant="outline">Add machine</HM.Button>
      </div>
    </div>
  );
}

function FleetScreen({ onChat }) {
  return (
    <div className="screen-scroll">
      <window.TopBar eyebrow="Private swarm command" title="Fleet">
        <window.HealthChip dot="healthy" label="Fleet healthy" />
        <window.HealthChip dot="live" label="Tailnet online" />
        <window.HealthChip dot="scheduled" label="Wallets OK" />
      </window.TopBar>
      <QueenBanner />
      <div className="machine-grid">
        {MACHINES.map((m) => <MachineCard key={m.id} m={m} onChat={onChat} />)}
      </div>
    </div>
  );
}

window.FleetScreen = FleetScreen;
