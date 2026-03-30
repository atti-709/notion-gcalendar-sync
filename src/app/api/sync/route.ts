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
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: String(error) },
      { status: 500 }
    );
  }
}
