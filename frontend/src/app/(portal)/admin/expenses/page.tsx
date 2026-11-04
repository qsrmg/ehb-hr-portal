"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Card, PageHeader, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";

type Claim = {
  requestId: number;
  status: string;
  employee: { fullName: string; code: string; department: string | null };
  purpose: string;
  items: number;
  totalClaimed: number;
  totalApproved: number;
  submittedAt: string;
  decidedAt: string | null;
  paid: { paidOn: string | null; method: "BANK_TRANSFER" | "WITH_SALARY" | null; reference: string | null; paidBy: string | null } | null;
};

type View = "to-pay" | "pending" | "paid" | "all";
const METHOD = { BANK_TRANSFER: "Bank transfer", WITH_SALARY: "With salary" } as const;

export default function ExpenseClaimsPage() {
  const [view, setView] = useState<View>("to-pay");
  const { data, loading, error } = useApi<Claim[]>(`/expenses/claims?view=${view}`);
  const total = data?.reduce((s, c) => s + c.totalApproved, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Expense claims" subtitle="Approved claims waiting for payment, claims in approval, and payment history." />
      <Card>
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "to-pay", label: "Waiting for payment" },
            { value: "pending", label: "In approval" },
            { value: "paid", label: "Paid" },
            { value: "all", label: "All" },
          ]}
        />
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <>
            {view === "to-pay" && data && data.length > 0 && (
              <p className="mb-3 text-sm text-slate-600">{data.length} claim(s) to pay, PKR {fmtMoney(total)} in total. Open a claim to mark it as paid.</p>
            )}
            <Table head={["#", "Employee", "Purpose", "Items", "Claimed", "Approved", view === "paid" ? "Paid" : "Status"]} empty="No claims here.">
              {data?.map((c) => (
                <tr key={c.requestId} className="hover:bg-slate-50">
                  <Td className="text-slate-500">{c.requestId}</Td>
                  <Td>
                    <div className="font-medium text-slate-900">{c.employee.fullName}</div>
                    <div className="text-xs text-slate-500">{c.employee.code}{c.employee.department ? ` · ${c.employee.department}` : ""}</div>
                  </Td>
                  <Td className="whitespace-normal"><Link href={`/requests/${c.requestId}`} className="text-accent hover:underline">{c.purpose}</Link></Td>
                  <Td className="tabular-nums">{c.items}</Td>
                  <Td className="tabular-nums">{fmtMoney(c.totalClaimed)}</Td>
                  <Td className={`tabular-nums font-medium ${c.totalApproved !== c.totalClaimed ? "text-orange-700" : ""}`}>{fmtMoney(c.totalApproved)}</Td>
                  <Td>
                    {c.paid ? (
                      <div className="text-sm">
                        {fmtDate(c.paid.paidOn)} · {c.paid.method ? METHOD[c.paid.method] : ""}
                        <div className="text-xs text-slate-500">Ref {c.paid.reference}</div>
                      </div>
                    ) : (
                      <StatusBadge status={c.status} label={c.status === "APPROVED" ? "Approved, not paid" : undefined} />
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
