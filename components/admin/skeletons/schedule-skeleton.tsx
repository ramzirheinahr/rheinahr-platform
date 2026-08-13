import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export function ScheduleSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          {/* Calendar Grid Skeleton */}
          <div className="grid grid-cols-7 gap-px rounded-md border bg-muted/50 overflow-hidden mt-4">
            {/* Days header */}
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={`head-${i}`} className="bg-muted p-2 text-center">
                <Skeleton className="h-4 w-10 mx-auto" />
              </div>
            ))}
            
            {/* Calendar cells */}
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={`cell-${i}`} className="bg-background min-h-24 p-2 border-t flex flex-col gap-2">
                <div className="flex justify-between items-start">
                  <Skeleton className="h-4 w-6" />
                </div>
                <div className="space-y-1 mt-auto">
                  {i % 3 === 0 && <Skeleton className="h-8 w-full rounded-md" />}
                  {i % 5 === 0 && <Skeleton className="h-8 w-full rounded-md" />}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-6 space-y-2">
            <Skeleton className="h-8 w-full max-w-sm" />
            <Skeleton className="h-8 w-full max-w-sm" />
            <Skeleton className="h-8 w-full max-w-sm" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
