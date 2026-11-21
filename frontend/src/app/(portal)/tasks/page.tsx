"use client";

import { PageHeader, Spinner } from "@/components/ui";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { useAuth } from "@/lib/auth";

export default function MyTasksPage() {
  const { user } = useAuth();
  if (!user) return <Spinner />;
  return (
    <div className="space-y-6">
      <PageHeader title="My tasks" subtitle="Tasks assigned to you or that you created." />
      <TaskBoard mine createFor={[{ id: user.id, fullName: user.fullName }]} />
    </div>
  );
}
