/* ChatScreen — talk to an agent. Left rail of recent chats, a message thread,
   and a composer. Cosmetic recreation of the app's chat workspace. */

const HMc = window.HivemindOSDesignSystem_65eabf;
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC } = React;

const RECENT = [
  { id: "1", title: "Swarm bridge refactor", agent: "Hermes-α", since: "2m", active: true },
  { id: "2", title: "Research brief · x402", agent: "Hermes-research", since: "18m" },
  { id: "3", title: "Nightly index rebuild", agent: "Aeon-night", since: "5h" },
  { id: "4", title: "X channel re-login", agent: "OpenClaw-x", since: "1h" },
];

const SEED = [
  { who: "you", text: "Where are we on the swarm agent bridge?" },
  { who: "agent", text: "Coder finished streaming over Tailscale SSH. Reviewer flagged one risk: the reconnect path retries without backoff. I've queued a fix and paused the deploy until you approve." },
  { who: "agent", kind: "attribution", steps: [
    ["Planner", "created the task"],
    ["Coder", "made changes to bridge.ts"],
    ["Reviewer", "flagged 1 risk"],
  ] },
  { who: "you", text: "Approve the fix, keep the deploy paused." },
];

function ChatScreen() {
  const [msgs, setMsgs] = useStateC(SEED);
  const [draft, setDraft] = useStateC("");
  const endRef = useRefC(null);
  useEffectC(() => { endRef.current && endRef.current.scrollIntoView && null; }, [msgs]);

  const send = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setMsgs((m) => [...m, { who: "you", text }]);
    setDraft("");
    setTimeout(() => {
      setMsgs((m) => [...m, { who: "agent", text: "On it — I'll dispatch that to the crew and report back with attribution when each step completes." }]);
    }, 700);
  };

  return (
    <div className="chat-workspace">
      <aside className="chat-rail">
        <div className="chat-rail-head">
          <span className="rail-eyebrow">Recent chats</span>
          <HMc.Button size="xs" variant="outline">New</HMc.Button>
        </div>
        {RECENT.map((c) => (
          <button key={c.id} className="chat-rail-item" data-active={c.active ? "" : undefined}>
            <div className="rail-item-title">{c.title}</div>
            <div className="rail-item-meta">{c.agent} · {c.since}</div>
          </button>
        ))}
      </aside>

      <section className="chat-main">
        <div className="chat-head">
          <div className="chat-head-l">
            <HMc.HexCell tone="live" pulse size={40}>
              <img src="../../assets/bees/worker-bee-code.png" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </HMc.HexCell>
            <div>
              <div className="chat-head-name">Hermes-α</div>
              <div className="chat-head-sub">Lead · atlas · Hermes runtime</div>
            </div>
          </div>
          <div className="chat-head-r">
            <HMc.Badge variant="success">Working</HMc.Badge>
            <HMc.Button size="sm" variant="outline">Call</HMc.Button>
          </div>
        </div>

        <div className="chat-thread">
          {msgs.map((m, i) => {
            if (m.kind === "attribution") {
              return (
                <div key={i} className="attribution">
                  {m.steps.map(([who, did], j) => (
                    <div key={j} className="attribution-row">
                      <span className="attribution-who">{who}</span>
                      <span className="attribution-did">{did}</span>
                    </div>
                  ))}
                </div>
              );
            }
            return (
              <div key={i} className={`bubble bubble-${m.who}`}>{m.text}</div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="chat-composer">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Message Hermes-α…"
          />
          <HMc.Button onClick={send}>Send</HMc.Button>
        </div>
      </section>
    </div>
  );
}

window.ChatScreen = ChatScreen;
