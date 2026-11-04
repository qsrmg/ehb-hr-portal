"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Card, PageHeader, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtMoney } from "@/lib/format";
import { TRAVEL_MODES } from "@/components/TravelForm";

type Trip = {
  requestId: number;
  status: string;
  employee: { fullName: string; code: string; department: string | null };
  route: string;
  departDate: string;
  returnDate: string;
  mode: string;
  needsHotel: boolean;
  bookingStatus: string;
  bookings: number;
  advanceRequested: number;
  advancePaid: boolean;
  advanceDue: number;
  cancelled: boolean;
  cancellationFee: number | null;
  settlement: { requestId: number; status: string; approvedTotal: number | null; toPay: number | null; paid: boolean } | null;
};

type View = "to-book" | "booked" | "advances" | "settlements" | "returns" | "cancelled" | "all";

export default function TravelAdminPage() {
  const { user } = useAuth();
  const finance = hasRole(user, "FINANCE");
  const admin = hasRole(user, "ADMIN");
  const [view, setView] = useState<View>(admin ? "to-book" : finance ? "advances" : "all");
  const { data, loading, error } = useApi<Trip[]>(`/travel/trips?view=${view}`);

  const options: { value: View; label: string }[] = [
    ...(admin || !finance ? [{ value: "to-book" as const, label: "To book" }, { value: "booked" as const, label: "Booked" }] : []),
    ...(finance || !admin ? [
      { value: "advances" as const, label: "Advances to pay" },
      { value: "settlements" as const, label: "Settlements to pay" },
      { value: "returns" as const, label: "Advance returns due" },
    ] : []),
    { value: "cancelled", label: "Cancelled" },
    { value: "all", label: "All trips" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Travel" subtitle="Approved trips to book, advances and settlements to pay, and unspent advances to recover. Open a trip to act on it." />
      <Card>
        <Tabs value={view} onChange={setView} options={options} />
        {loading ? <Spinner /> : error ? <Alert>{error}</Alert> : (
          <Table head={["#", "Traveller", "Trip", "Dates", "Booking", "Advance", "Settlement"]} empty="No trips here.">
            {data?.map((t) => (
              <tr key={t.requestId} className="hover:bg-slate-50">
                <Td className="text-slate-500">{t.requestId}</Td>
                <Td>
                  <div className="font-medium text-slate-900">{t.employee.fullName}</div>
                  <div className="text-xs text-slate-500">{t.employee.code}{t.employee.department ? ` · ${t.employee.department}` : ""}</div>
                </Td>
                <Td>
                  <Link href={`/requests/${t.requestId}`} className="font-medium text-accent hover:underline">{t.route}</Link>
                  <div className="text-xs text-slate-500">{TRAVEL_MODES[t.mode]}{t.needsHotel ? " · hotel" : ""}</div>
                </Td>
                <Td>{fmtDate(t.departDate)} – {fmtDate(t.returnDate)}</Td>
                <Td>
                  {t.cancelled ? (
                    <><StatusBadge status="CANCELLED" />{t.cancellationFee != null && <div className="text-xs text-slate-500">Fee PKR {fmtMoney(t.cancellationFee)}</div>}</>
                  ) : (
                    <StatusBadge status={t.status === "APPROVED" ? t.bookingStatus : t.status} />
                  )}
                </Td>
                <Td className="tabular-nums">
                  {t.advanceRequested > 0 ? (
                    <>
                      PKR {fmtMoney(t.advanceRequested)}
                      <div className="text-xs text-slate-500">{t.advanceDue > 0 ? `PKR ${fmtMoney(t.advanceDue)} to recover` : t.advancePaid ? "Paid" : "Not paid"}</div>
                    </>
                  ) : "—"}
                </Td>
                <Td>
                  {t.settlement ? (
                    <Link href={`/requests/${t.settlement.requestId}`} className="text-sm text-accent hover:underline">
                      #{t.settlement.requestId} <StatusBadge status={t.settlement.status} />
                      {t.settlement.toPay != null && t.settlement.status === "APPROVED" && (
                        <div className="text-xs text-slate-500">{t.settlement.paid ? "Paid" : t.settlement.toPay > 0 ? `PKR ${fmtMoney(t.settlement.toPay)} to pay` : "Covered by advance"}</div>
                      )}
                    </Link>
                  ) : "—"}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
