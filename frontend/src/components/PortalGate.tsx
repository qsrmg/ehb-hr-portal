"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export function PortalGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.mustChangePassword && pathname !== "/change-password") router.replace("/change-password");
  }, [user, loading, pathname, router]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </AppShell>
  );
}
