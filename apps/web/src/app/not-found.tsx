import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-4 text-center">
      <div className="font-mono text-[13px] text-tertiary">404</div>
      <h1 className="text-[20px] font-semibold text-primary">Nothing here</h1>
      <p className="max-w-sm text-[12.5px] text-secondary">
        This shipment, entry, or page doesn&apos;t exist — or you don&apos;t have access to it.
      </p>
      <Link
        href="/"
        className="rounded-sm bg-accent px-3.5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-accent-strong"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
