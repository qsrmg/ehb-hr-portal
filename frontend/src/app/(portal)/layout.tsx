import { Suspense } from "react";
import { PortalGate } from "@/components/PortalGate";
import { Spinner } from "@/components/ui";

// Portal pages render after the signed-in user is known and load their data in the browser,
// so they are not expected to navigate instantly.
export const instant = false;

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <PortalGate>{children}</PortalGate>
    </Suspense>
  );
}
