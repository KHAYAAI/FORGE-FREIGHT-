export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-16 animate-pulse rounded border border-hairline bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded border border-hairline bg-surface" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded border border-hairline bg-surface" />
    </div>
  );
}
