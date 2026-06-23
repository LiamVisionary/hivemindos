// src/app/swarm/page.tsx
// The real Simulation view lives in the dashboard (it needs the MiroShark
// controller for live runs/launch/publish). Send /swarm there so it shows real
// data via ?view=swarm instead of a standalone shell with no live wiring.
import { redirect } from "next/navigation";

export default function SwarmPage() {
  redirect("/?view=swarm");
}
