import { NextRequest, NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = request.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.SYNC_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncAll();
    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    const details = error?.response?.data || error?.errors || error?.message || String(error);
    console.error("Sync failed:", JSON.stringify(details, null, 2));
    return NextResponse.json(
      { error: "Sync failed", details },
      { status: 500 }
    );
  }
}
