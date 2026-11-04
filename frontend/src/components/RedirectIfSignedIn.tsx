"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/** On the public pages: a signed-in user goes straight to the dashboard (or must change their password first). */
export function RedirectIfSignedIn() {
  const { user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
  }, [user, router]);
  return null;
}
