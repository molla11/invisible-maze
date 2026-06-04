import { NextResponse } from "next/server";
import { publicStats, requireSession } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireSession();
  return NextResponse.json({ ok: true, ...(await publicStats()) });
}
