import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mockRequirement = {
  x402Version: 2,
  resource: {
    url: "http://localhost:5020/api/wallet/x402/mock-paid",
    description: "Local x402 signing smoke test",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      amount: "10000",
      asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      payTo: "11111111111111111111111111111111",
      maxTimeoutSeconds: 300,
      extra: {
        feePayer: "11111111111111111111111111111111",
        memo: "openclaw-local-x402-smoke",
      },
    },
  ],
};

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const payment = request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT");
  if (!payment) {
    return NextResponse.json(mockRequirement, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(mockRequirement), "utf8").toString("base64"),
      },
    });
  }
  return NextResponse.json(
    {
      ok: true,
      paid: true,
      receivedPaymentHeader: payment.slice(0, 24),
    },
    {
      headers: {
        "PAYMENT-RESPONSE": JSON.stringify({ success: true, mock: true }),
      },
    },
  );
}
