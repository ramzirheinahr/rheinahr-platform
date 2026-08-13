import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* KPI Widgets */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20 mb-1" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-7 lg:grid-cols-4">
        {/* Main Charts Area */}
        <div className="md:col-span-4 lg:col-span-3 space-y-4">
          <Card className="h-[400px]">
            <CardContent className="h-full flex items-center justify-center">
              <Skeleton className="h-[350px] w-full" />
            </CardContent>
          </Card>
          
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="h-[300px]">
              <CardContent className="h-full flex items-center justify-center">
                <Skeleton className="h-[250px] w-full" />
              </CardContent>
            </Card>
            <Card className="h-[300px]">
              <CardContent className="h-full flex items-center justify-center">
                <Skeleton className="h-[250px] w-full" />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Action Items Sidebar */}
        <div className="md:col-span-3 lg:col-span-1">
          <Card className="h-[716px]">
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
