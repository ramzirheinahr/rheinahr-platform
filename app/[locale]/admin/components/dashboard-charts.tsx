"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";

interface ChartDataProps {
  fulfillmentData: { name: string; value: number }[];
  qualificationData: { name: string; value: number }[];
  invoiceData: { name: string; value: number }[];
}

const COLORS = ["#10b981", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"];

export function DashboardCharts({ fulfillmentData, qualificationData, invoiceData }: ChartDataProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Fulfillment Rate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Erfüllungsquote (Fulfillment Rate)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {fulfillmentData.every((d) => d.value === 0) ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Keine Daten verfügbar</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={fulfillmentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {fulfillmentData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Demand by Qualification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Bedarf nach Qualifikation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {qualificationData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Keine Daten verfügbar</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={qualificationData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "transparent" }} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Financials (Invoices) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Finanzen (Rechnungen)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {invoiceData.every((d) => d.value === 0) ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Keine Daten verfügbar</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={invoiceData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "transparent" }} formatter={(value: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
