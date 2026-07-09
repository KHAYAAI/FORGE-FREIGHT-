/**
 * Portal API client. In production the browser carries the user's Keycloak
 * bearer token; the dev headers below exist only for AUTH_MODE=dev backends
 * and are configured via env, never hardcoded.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function headers(): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (process.env.NEXT_PUBLIC_DEV_TENANT_ID) {
    h["x-dev-tenant-id"] = process.env.NEXT_PUBLIC_DEV_TENANT_ID;
  }
  return h;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} → ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
}
