import { RouteModal } from "@/components/admin/route-modal";
import { Loader2 } from "lucide-react";

export default function LoadingClientEdit() {
  return (
    <RouteModal>
      <div className="flex h-[400px] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    </RouteModal>
  );
}
