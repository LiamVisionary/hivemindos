import {
  archiveMiroSharkRun,
  listArchivedMiroSharkRuns,
  readArchivedMiroSharkRun,
  type ArchivedMiroSharkRunBody,
} from "@/lib/services/miroshark/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vaultPath = searchParams.get("vaultPath") ?? undefined;
    const simulationId = searchParams.get("simulation_id")?.trim();
    if (simulationId) {
      const archived = await readArchivedMiroSharkRun({ vaultPath, simulationId });
      return Response.json({ ok: true, summary: archived.summary, run: archived.run });
    }

    const { archivePath, runs } = await listArchivedMiroSharkRuns(vaultPath);
    return Response.json({ ok: true, archivePath, runs });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not read MiroShark archive" }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ArchivedMiroSharkRunBody;
    const { archivePath, summary } = await archiveMiroSharkRun(body);
    return Response.json({ ok: true, archivePath, summary });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save MiroShark archive" }, { status: 400 });
  }
}
