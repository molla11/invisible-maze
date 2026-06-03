import { NextResponse } from "next/server";
import { getMatchStatus } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMatchStatus());
}
