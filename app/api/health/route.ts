import { NextResponse } from "next/server";
import { publicStats } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, ...(await publicStats()) });
}
