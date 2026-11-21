"use client";

import { Alert, Card, Empty, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { useApi } from "@/lib/useApi";
import { hasRole, useAuth } from "@/lib/auth";

type Person = { id: number; fullName: string; code: string };
type Summary = { people: { assignee: Person; backlog: number; todo: number; inProgress: number; done: number; overdue: number }[]; overdueCount: number; totalCount: number };

function SummaryStrip() {
  const { data, loading, error } = useApi<Summary>("/tasks/team-summary");
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  return (
    <Card title="Who has what" actions={<span className="text-sm text-slate-600">{data.totalCount} tasks · <span className={data.overdueCount ? "font-semibold text-red-600" : ""}>{data.overdueCount} overdue</span></span>}>
      <Table head={["Assignee", "Backlog", "To Do", "In Progress", "Done", "Overdue"]} empty="No team tasks yet.">
        {data.people.map((p) => (
          <tr key={p.assignee.id}>
            <Td><div className="font-medium text-slate-900">{p.assignee.fullName}</div><div className="text-xs text-slate-500">{p.assignee.code}</div></Td>
            <Td>{p.backlog}</Td>
            <Td>{p.todo}</Td>
            <Td>{p.inProgress}</Td>
            <Td>{p.done}</Td>
            <Td className={p.overdue ? "font-semibold text-red-600" : ""}>{p.overdue}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export default function TeamTasksPage() {
  const { user } = useAuth();
  const isHr = hasRole(user, "HR");
  // HR picks from the full employee list; a manager picks from their own (recursive) team roster.
  const { data: employees } = useApi<Person[]>(isHr ? "/employees" : null);
  const { data: team } = useApi<Person[]>(isHr ? null : "/tasks/team-members");
  const assigneeOptions = isHr ? employees : team;

  if (!user) return null;
  if (!isHr && !user.hasTeam) {
    return (
      <div className="space-y-6">
        <PageHeader title="Team tasks" />
        <Empty>You have no team.</Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team tasks" subtitle="Tasks across your team, with who has what." />
      <SummaryStrip />
      <TaskBoard mine={false} assigneeOptions={assigneeOptions ?? undefined} createFor={assigneeOptions ?? undefined} />
    </div>
  );
}
