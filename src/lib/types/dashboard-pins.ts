export const DASHBOARD_PIN_STATUSES = [
  "open",
  "sent-to-work-board",
  "resolved",
  "archived",
] as const;

export type DashboardPinStatus = (typeof DASHBOARD_PIN_STATUSES)[number];

export type DashboardPinBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DashboardPin = {
  id: string;
  createdAt: string;
  updatedAt: string;
  route: string;
  comment: string;
  selector?: string;
  textSnippet?: string;
  boundingBox?: DashboardPinBoundingBox;
  componentHint?: string;
  sourceFileHint?: string;
  screenshotPath?: string;
  status: DashboardPinStatus;
  workBoardTaskId?: string;
};

export type DashboardPinCreateInput = {
  route?: unknown;
  comment?: unknown;
  selector?: unknown;
  textSnippet?: unknown;
  boundingBox?: unknown;
  componentHint?: unknown;
  sourceFileHint?: unknown;
  screenshotPath?: unknown;
};

export type DashboardPinsFile = {
  version: 1;
  pins: DashboardPin[];
  updatedAt: string;
};
