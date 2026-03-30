import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  // Token will be visible in Vercel request logs as a query parameter
  return NextResponse.json({ logged: true, token });
}
