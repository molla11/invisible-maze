import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    return NextResponse.json({ id: session.id, anonymous: !session.linkedProvider });
  } catch (error) {
    console.error("session_failed", error);
    return NextResponse.json({ error: "session_failed" }, { status: 500 });
  }
}
