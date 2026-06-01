import { NextResponse } from "next/server";
import { publicStats } from "@/lib/server/store";

export async function GET() {
  return NextResponse.json({ ok: true, ...publicStats() });
}
