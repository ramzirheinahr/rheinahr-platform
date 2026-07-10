"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchUncontractedAssignments, generateContract } from "@/app/[locale]/admin/contracts/actions";
import { format } from "date-fns";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ClientType = { id: string; facilityName: string };

export function ContractGenerator({ clients }: { clients: ClientType[] }) {
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [period, setPeriod] = useState<string>(format(new Date(), "MMMM yyyy"));
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleClientSelect(clientId: string) {
    setSelectedClient(clientId);
    setLoading(true);
    try {
      const data = await fetchUncontractedAssignments(clientId);
      setAssignments(data);
      // Auto-select all by default
      setSelectedIds(new Set(data.map((a: any) => a.id)));
    } catch (e) {
      toast.error("Failed to fetch assignments");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleGenerate() {
    if (!selectedClient || selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      await generateContract(selectedClient, Array.from(selectedIds), period);
      toast.success("Contract generated successfully");
      router.push("/admin/contracts");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate contract");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Client</Label>
          <Select value={selectedClient} onValueChange={(val) => val && handleClientSelect(val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.facilityName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label>Contract Period (e.g., July 2026)</Label>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
      </div>

      {selectedClient && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Uncontracted Future Shifts</h2>
          
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No confirmed future shifts available for a contract.</p>
          ) : (
            <div className="rounded-md border bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left border-b">
                  <tr>
                    <th className="p-3 w-10">
                      <input 
                        type="checkbox" 
                        className="rounded border-gray-300"
                        checked={selectedIds.size === assignments.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(new Set(assignments.map(a => a.id)));
                          else setSelectedIds(new Set());
                        }}
                      />
                    </th>
                    <th className="p-3">Date & Time</th>
                    <th className="p-3">Worker</th>
                    <th className="p-3">Qualification</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-300"
                          checked={selectedIds.has(a.id)}
                          onChange={() => toggleSelection(a.id)}
                        />
                      </td>
                      <td className="p-3">
                        {format(new Date(a.order.shiftDate), "dd.MM.yyyy")} · {a.order.startTime}-{a.order.endTime}
                      </td>
                      <td className="p-3">{a.worker.fullName}</td>
                      <td className="p-3 capitalize">{a.order.requiredQualification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pt-4 flex justify-end">
            <Button 
              onClick={handleGenerate} 
              disabled={submitting || selectedIds.size === 0}
            >
              {submitting ? "Generating..." : `Generate Contract (${selectedIds.size} shifts)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
