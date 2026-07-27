/* WalletsScreen — "can agents safely spend?" Calm, money-safe surface.
   Read-only status separated from money-moving actions (per UI_RULES). */

const HMw = window.HivemindOSDesignSystem_65eabf;

const WALLETS = [
  { agent: "Hermes-α", machine: "atlas", balance: "0.42 ETH", state: ["success", "Healthy"], survival: "~28 days at current burn", chain: "Base", spend: true },
  { agent: "Hermes-research", machine: "nimbus", balance: "0.12 ETH", state: ["warning", "Low compute"], survival: "3 days left", chain: "Base", spend: true },
  { agent: "OpenClaw-x", machine: "nimbus", balance: "0.00 ETH", state: ["danger", "Needs funding"], survival: "Stopped — out of funds", chain: "Base", spend: false },
  { agent: "Codex-skill", machine: "nimbus", balance: "0.04 ETH", state: ["success", "Healthy"], survival: "~9 days at current burn", chain: "Solana", spend: true },
];

function WalletCard({ w }) {
  return (
    <HMw.Card className="wallet-card">
      <div className="wallet-head">
        <div>
          <div className="wallet-agent">{w.agent}</div>
          <div className="wallet-machine">on {w.machine} · {w.chain}</div>
        </div>
        <HMw.Badge variant={w.state[0]}>{w.state[1]}</HMw.Badge>
      </div>
      <div className="wallet-balance">{w.balance}</div>
      <div className="wallet-survival">
        <HMw.StatusDot tone={w.state[0] === "danger" ? "danger" : w.state[0] === "warning" ? "warning" : "healthy"} pulse={false} />
        <span>{w.survival}</span>
      </div>
      <div className="wallet-foot">
        <span className="wallet-spend">{w.spend ? "Can spend on approved tools" : "Spending paused"}</span>
        {w.state[0] === "danger"
          ? <HMw.Button size="sm">Add funds</HMw.Button>
          : <HMw.Button size="sm" variant="outline">Manage</HMw.Button>}
      </div>
    </HMw.Card>
  );
}

function WalletsScreen() {
  return (
    <div className="screen-scroll">
      <window.TopBar eyebrow="Money, made calm" title="Wallets">
        <window.HealthChip dot="warning" label="1 needs funding" />
        <window.HealthChip dot="healthy" label="3 healthy" />
      </window.TopBar>

      <HMw.Card className="wallet-summary">
        <div className="summary-cell">
          <span className="summary-num">4</span>
          <span className="summary-lab">Agent wallets</span>
        </div>
        <div className="summary-cell">
          <span className="summary-num" style={{ color: "var(--success)" }}>3</span>
          <span className="summary-lab">Can spend safely</span>
        </div>
        <div className="summary-cell">
          <span className="summary-num" style={{ color: "var(--warning)" }}>1</span>
          <span className="summary-lab">Close to stopping</span>
        </div>
        <div className="summary-cell">
          <span className="summary-num" style={{ color: "var(--danger)" }}>1</span>
          <span className="summary-lab">Needs funding now</span>
        </div>
        <div className="summary-note">
          Money-moving actions require explicit confirmation. Private keys and payment rails stay in advanced setup.
        </div>
      </HMw.Card>

      <div className="wallet-grid">
        {WALLETS.map((w) => <WalletCard key={w.agent} w={w} />)}
      </div>
    </div>
  );
}

window.WalletsScreen = WalletsScreen;
