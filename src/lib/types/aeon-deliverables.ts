export type AeonDeliverable = {
  id: string;
  title: string;
  kind: "verdict" | "miroshark-run" | "posts" | "json" | "output" | "document" | "file" | "url";
  source: "vault" | "aeon-output" | "remote";
  repository?: string;
  simulationId?: string;
  status?: string;
  path?: string;
  url?: string;
  relativePath?: string;
  size?: number;
  updatedAt: string;
  availableOnMachine: boolean;
  machineName?: string;
  summary?: string;
};
