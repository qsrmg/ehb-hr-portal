"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { post } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ChangePasswordPage() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError("The new passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md">
      <PageHeader title="Change password" />
      {user?.mustChangePassword && <div className="mb-4"><Alert kind="info">Please choose a new password before continuing.</Alert></div>}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 8 characters, with a letter and a number">
            <Input type="password" autoComplete="new-password" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </Field>
          <Button type="submit" loading={busy}>Save password</Button>
        </form>
      </Card>
    </div>
  );
}
