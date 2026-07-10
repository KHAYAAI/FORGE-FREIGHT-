"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-4 text-center">
      <div className="text-[10.5px] font-semibold uppercase tracking-widest text-critical">
        Unhandled error
      </div>
      <h1 className="text-[20px] font-semibold text-primary">Something broke on this screen</h1>
      <p className="max-w-sm text-[12.5px] text-secondary">
        The error has been logged. Try again, or go back to the dashboard if it persists.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = "/")}>
          Go to dashboard
        </Button>
      </div>
      {error.digest && (
        <div className="mt-2 font-mono text-[10.5px] text-tertiary">Ref: {error.digest}</div>
      )}
    </div>
  );
}
