"use client";

import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";

interface ChartDataProps {
  fulfillmentData: { name: string; value: number }[];
  qualificationData: { name: string; value: number }[];
  invoiceData: { name: string; value: number }[];
}

const COLORS = ["#10b981", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"];

export function DashboardCharts({ fulfillmentData, qualificationData, invoiceData }: ChartDataProps) {
  const t = useTranslations("adminDashboard");
  const localizedInvoiceData = invoiceData.map((item) => ({
    ...item,
    label: t(`invoiceStatus.${item.name}`),
  }));

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
          <CardTitle className="text-sm font-medium">{t("invoiceFinanceTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {invoiceData.every((d) => d.value === 0) ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={localizedInvoiceData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="label" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false} 
                    interval={0} 
                    angle={-25}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    formatter={(value: unknown) => [
                      new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(Number(value) || 0),
                      t("amount"),
                    ]}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {localizedInvoiceData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.name === "allTimeUnpaid" ? "#0f766e" : "#8b5cf6"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
