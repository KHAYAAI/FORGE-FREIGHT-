import { NextResponse } from "next/server";
import { encodeSession, SESSION_COOKIE, type Session } from "@/lib/session";

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Session>;
  if (!body.tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }
  const session: Session = {
    tenantId: body.tenantId,
    tenantLabel: body.tenantLabel ?? body.tenantId,
    userId: body.userId ?? "dev",
  };
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
