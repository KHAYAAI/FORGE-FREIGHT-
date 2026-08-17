import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Belt-and-braces alongside the ALB's own TLS termination and redirect
  // (infra/aws/alb.tf) — this is what tells the *browser* to never even try
  // plain HTTP again for this origin, closing the one-request window a
  // network attacker gets before the 80→443 redirect fires. Harmless when
  // served over plain HTTP locally: browsers ignore HSTS on non-HTTPS
  // responses.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Linting runs once at the repo root (`pnpm lint`, ESLint flat config
  // covering the whole workspace) — skip Next's separate built-in pass.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
