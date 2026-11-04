"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(user.mustChangePassword ? "/change-password" : "/");
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-brand px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="text-xs font-medium uppercase tracking-wider text-white/60">EHB Technologies · Human Resources</div>
          <h1 className="mt-1 text-2xl font-semibold">HR Self-Service Portal</h1>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg bg-white p-6 shadow-lg">
          {error && <Alert>{error}</Alert>}
          <Field label="Work email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@ehb.local" />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} className="w-full">Log in</Button>
          <p className="text-center text-xs text-slate-500">Forgot your password? Ask HR to reset it.</p>
        </form>
      </div>
    </div>
  );
}
