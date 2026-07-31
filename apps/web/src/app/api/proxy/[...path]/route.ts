import { NextResponse, type NextRequest } from "next/server";
import { authHeaders, getSession } from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Same-origin proxy: client components fetch("/api/proxy/...") instead of
 * hitting the NestJS API directly, so the session cookie never has to leave
 * the server and no CORS configuration is needed for browser calls.
 *
 * Which credential goes out is `authHeaders`' decision, not this file's — a
 * Keycloak bearer under OIDC, x-dev-* headers in dev mode. The access token
 * is refreshed in middleware before the request reaches here.
 */
async function forward(req: NextRequest, path: string[]) {
  const session = await getSession();
  const headers: Record<string, string> = { ...authHeaders(session) };

  const contentType = req.headers.get("content-type");
  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (contentType?.includes("multipart/form-data")) {
      body = await req.formData();
    } else {
      headers["content-type"] = contentType ?? "application/json";
      body = await req.text();
    }
  }

  const search = req.nextUrl.search;
  const res = await fetch(`${API_URL}/${path.join("/")}${search}`, {
    method: req.method,
    headers,
    body,
  });

  const resContentType = res.headers.get("content-type") ?? "application/json";
  if (resContentType.includes("application/pdf") || resContentType.includes("octet-stream")) {
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, { status: res.status, headers: { "content-type": resContentType } });
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": resContentType },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
