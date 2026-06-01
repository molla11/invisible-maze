import { NextResponse } from "next/server";
import { cancelQueue } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await cancelQueue());
}
