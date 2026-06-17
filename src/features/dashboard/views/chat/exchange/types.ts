export type ExchangeAgentState = "working" | "ready" | "scheduled" | "setup" | "failed" | "online";

export type ExchangeConversation = {
  id: string;
  name: string;
  sub?: string;
  state: ExchangeAgentState;
  kind: "agent" | "general";
  runtime?: string;
  role?: string;
  machine?: string;
};

export type ExchangeThread = {
  taskId?: string;
  task?: string;
  column?: string;
  priority?: string;
  tenant?: string;
  eta?: string;
  repo?: string;
  branch?: string;
  cwd?: string;
  tokens?: string;
  cost?: string;
  elapsed?: string;
  blocked?: boolean;
  general?: boolean;
  scope?: string;
  actions?: string[];
};

export type ExchangeChatRow = {
  key?: string;
  title?: string;
  subtitle?: string;
  active?: boolean;
  agentId?: string;
  updatedAt?: number;
  searchText?: string;
  onOpen?: () => void;
};

export type ExchangeFolder = {
  key?: string;
  label?: string;
  active?: boolean;
  chats?: ExchangeChatRow[];
  onStartChat?: () => void;
};

export type ExchangeMachine = {
  key?: string;
  name?: string;
  folders?: ExchangeFolder[];
  onStartChat?: () => void;
  rosterAgentCount?: number;
};

export type ExchangeMachineGroup = {
  key?: string;
  agents?: Array<{ id?: string; name?: string; runtime?: string; state?: string }>;
};
