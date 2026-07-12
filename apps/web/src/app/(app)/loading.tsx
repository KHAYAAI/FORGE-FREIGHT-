import { SkeletonPageHeader, SkeletonStatTile, SkeletonPanel, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStatTile key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <SkeletonPanel className="xl:col-span-3">
          <SkeletonTable rows={5} cols={4} />
        </SkeletonPanel>
        <SkeletonPanel className="xl:col-span-2" />
      </div>
    </div>
  );
}
