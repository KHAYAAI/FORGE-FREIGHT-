import { SkeletonPageHeader, SkeletonPanel, SkeletonTable, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-sm" />
        ))}
      </div>
      <SkeletonPanel>
        <SkeletonTable rows={8} cols={4} />
      </SkeletonPanel>
    </div>
  );
}
