import Image from "next/image";
import { cn } from "@/lib/utils";

// Company logo (public/logo.png, 364×100). Control the rendered size via the
// className height — width stays auto to preserve the aspect ratio.
export function Logo({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="RheinAhr Dienstleistungen GmbH"
      width={364}
      height={100}
      priority={priority}
      className={cn("h-9 w-auto", className)}
    />
  );
}
