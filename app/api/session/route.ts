import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireSession();
  return NextResponse.json({ id: session.id, anonymous: !session.linkedProvider });
}
