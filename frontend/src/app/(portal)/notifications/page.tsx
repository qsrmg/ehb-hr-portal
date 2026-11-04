"use client";

import Link from "next/link";
import { Alert, Button, Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDateTime } from "@/lib/format";

type Notifications = { unread: number; items: { id: number; title: string; body: string; link: string | null; read: boolean; createdAt: string }[] };

export default function NotificationsPage() {
  const { data, loading, error, reload } = useApi<Notifications>("/notifications");
  const markAll = async () => {
    await post("/notifications/read-all");
    reload();
  };
  const open = (id: number) => post(`/notifications/${id}/read`).catch(() => {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Every step of your requests, approvals waiting for you, and reminders. The same messages are sent by email."
        actions={data && data.unread > 0 ? <Button variant="secondary" onClick={markAll}>Mark all as read</Button> : undefined}
      />
      <Card>
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : !data?.items.length ? <Empty>No notifications yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((n) => {
              const body = (
                <div className={`flex gap-3 py-3 ${n.read ? "" : "font-medium"}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent"}`} />
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900">{n.title}</div>
                    <div className="text-sm font-normal text-slate-600">{n.body}</div>
                    <div className="text-xs font-normal text-slate-400">{fmtDateTime(n.createdAt)}</div>
                  </div>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.link ? <Link href={n.link} onClick={() => open(n.id)} className="block hover:bg-slate-50">{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
