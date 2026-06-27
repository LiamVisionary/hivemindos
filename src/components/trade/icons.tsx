/* icons.tsx — the small inline icon set for the Trade desk (ported from the
   drop-in's BIcon) plus the activity-kind → icon map. */
import React from "react";

export type IconName =
  | "brain" | "search" | "doc" | "trade" | "spark" | "activity" | "key" | "network"
  | "branch" | "sync" | "refresh" | "download" | "plug" | "check" | "plus" | "shield"
  | "alert" | "repeat" | "sparkles" | "eye" | "copy" | "promote" | "bot" | "hex" | "wallet";

export function BIcon({ name, color = "currentColor", size = 16, sw = 1.7 }: { name: IconName; color?: string; size?: number; sw?: number }) {
  const c = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "brain": return (<svg {...c}><path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 11c0 1 .5 1.8 1.2 2.3A2.6 2.6 0 0 0 7 18c.8.6 2 .6 2.5-.2V4z" /><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19 11c0 1-.5 1.8-1.2 2.3A2.6 2.6 0 0 1 17 18c-.8.6-2 .6-2.5-.2V4z" /></svg>);
    case "search": return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>);
    case "doc": return (<svg {...c}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 13h5M9.5 16.5h5" /></svg>);
    case "trade": return (<svg {...c}><path d="M3 17l5-5 3 3 4-6 3 3 3-3" /></svg>);
    case "spark": return (<svg {...c}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>);
    case "activity": return (<svg {...c}><path d="M3 12h4l2.5 7 5-14L17 12h4" /></svg>);
    case "key": return (<svg {...c}><circle cx="8" cy="14" r="4" /><path d="M11 11l8-8M16 4l3 3M14 6l2.5 2.5" /></svg>);
    case "network": return (<svg {...c}><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M10.5 6.6 6.5 16M13.5 6.6 17.5 16M7 18h10" /></svg>);
    case "branch": return (<svg {...c}><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" /><path d="M6 8.4v7.2M8.2 7.2c6 1 4 6 9.4 1.2" /></svg>);
    case "sync": return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12a8.5 8.5 0 0 1-14.5 6" /><path d="M18 3v3.5h-3.5M6 21v-3.5h3.5" /></svg>);
    case "refresh": return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 2.6-6.1" /><path d="M3 4v4h4" /><path d="M20.5 12a8.5 8.5 0 0 1-2.6 6.1" /><path d="M21 20v-4h-4" /></svg>);
    case "download": return (<svg {...c}><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>);
    case "plug": return (<svg {...c}><path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4" /></svg>);
    case "check": return (<svg {...c}><path d="M20 6 9 17l-5-5" /></svg>);
    case "plus": return (<svg {...c}><path d="M12 5v14M5 12h14" /></svg>);
    case "shield": return (<svg {...c}><path d="M12 3l7 4v5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V7z" /><path d="M9 12l2 2 4-4" /></svg>);
    case "alert": return (<svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>);
    case "repeat": return (<svg {...c}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>);
    case "sparkles": return (<svg {...c}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>);
    case "eye": return (<svg {...c}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
    case "copy": return (<svg {...c}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>);
    case "promote": return (<svg {...c}><path d="M12 19V7M7 11l5-4 5 4M5 21h14" /></svg>);
    case "bot": return (<svg {...c}><rect x="5" y="8" width="14" height="11" rx="2.4" /><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" /></svg>);
    case "hex": return (<svg {...c}><path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" /></svg>);
    case "wallet": return (<svg {...c}><rect x="3" y="6" width="18" height="13" rx="2.2" /><path d="M3 9.5h18" /><circle cx="16.5" cy="13.5" r="1.1" fill={color} stroke="none" /></svg>);
    default: return null;
  }
}

/** Activity kind → desk icon. Covers both crypto ledger kinds and stock sides. */
export function activityIcon(kind: string): IconName {
  const map: Record<string, IconName> = {
    Swap: "repeat", DCA: "refresh", Bridge: "branch", Bet: "spark", Send: "promote",
    Perp: "activity", Mint: "hex", Receive: "download", Buy: "trade", Sell: "trade",
    Limit: "activity", Dividend: "spark", Recurring: "refresh", Trade: "repeat",
    Pay: "plug", Private: "shield", Fee: "doc",
  };
  return map[kind] ?? "activity";
}

export function walletKindIcon(kind: string): IconName {
  return kind === "agent" ? "bot" : kind === "bankr" ? "spark" : "wallet";
}
