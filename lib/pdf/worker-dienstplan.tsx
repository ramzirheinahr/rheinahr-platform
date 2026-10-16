import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import { getCompanyConfig } from "@/lib/config/company";
import { formatWorkerSalutation } from "@/lib/worker-utils";

export type WorkerDienstplanPdfRow = {
  id: string;
  date: string; // YYYY-MM-DD
  dateFormatted: string; // "04.05.2026"
  dayOfWeek: string; // "Mo.", "Di.", etc.
  isWeekend: boolean;
  startTime: string; // "06:00"
  endTime: string; // "14:00"
  timeRange: string; // "06:00 – 14:00"
  breakMinutes: number;
  scheduledHours: number;
  confirmedHours: number | null;
  shiftCode: "FD" | "SD" | "ND" | "TD";
  shiftLabel: string; // "Frühdienst", "Spätdienst", "Nachtdienst", "Tagdienst"
  shiftBadgeBg: string;
  shiftBadgeText: string;
  shiftBadgeBorder: string;
  facilityName: string;
  address: string | null;
  notes: string | null;
  statusLabel: string; // "Bestätigt", "Zugewiesen", "Ausstehend"
  isConfirmed: boolean;
};

export type WorkerDienstplanLeaveRow = {
  dateFormatted: string;
  typeLabel: string;
  hours: number;
};

export type WorkerDienstplanTotals = {
  totalShifts: number;
  earlyShiftsCount: number; // FD
  lateShiftsCount: number; // SD
  nightShiftsCount: number; // ND
  dayShiftsCount: number; // TD
  plannedHours: number;
  confirmedHours: number;
  requiredHours: number;
};

export type WorkerDienstplanPdfData = {
  worker: {
    id: string;
    fullName: string;
    salutation?: string | null;
    internalNumber?: string | null;
    qualification: string;
    birthDate?: string | null;
    phone?: string | null;
  };
  monthLabel: string; // e.g. "Mai 2026"
  year: number;
  month: number;
  generatedAt: string;
  rows: WorkerDienstplanPdfRow[];
  leaves: WorkerDienstplanLeaveRow[];
  totals: WorkerDienstplanTotals;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 8.5,
    color: "#1e293b",
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: "#0284c7",
    paddingBottom: 10,
    marginBottom: 14,
  },
  companyName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    letterSpacing: 0.5,
  },
  companySub: {
    fontSize: 7.5,
    color: "#64748b",
    marginTop: 2,
  },
  headerDocBlock: {
    alignItems: "flex-end",
  },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#0369a1",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  docPeriod: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    marginTop: 2,
  },
  generatedDate: {
    fontSize: 7,
    color: "#94a3b8",
    marginTop: 2,
  },

  // Worker Info & Totals Summary Grid
  topGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  workerCard: {
    flex: 1.2,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 10,
  },
  workerNameTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    marginBottom: 4,
  },
  workerMetaRow: {
    flexDirection: "row",
    marginBottom: 2.5,
  },
  workerMetaLabel: {
    width: 82,
    fontSize: 7.5,
    color: "#64748b",
    fontFamily: "Helvetica-Bold",
  },
  workerMetaValue: {
    flex: 1,
    fontSize: 8,
    color: "#1e293b",
  },

  summaryCard: {
    flex: 1,
    backgroundColor: "#f0f9ff",
    borderWidth: 1,
    borderColor: "#bae6fd",
    borderRadius: 6,
    padding: 10,
  },
  summaryTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#0369a1",
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#bae6fd",
    paddingBottom: 3,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  summaryLabel: {
    fontSize: 7.5,
    color: "#475569",
  },
  summaryValue: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },

  // Shift Legend Badges
  legendBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 12,
    gap: 12,
  },
  legendTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    marginRight: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
  },

  // Shifts Table
  table: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#0f172a",
    color: "#ffffff",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 4.5,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  tableRowAlt: {
    backgroundColor: "#f8fafc",
  },
  tableRowWeekend: {
    backgroundColor: "#fef3c7", // light warm amber for weekend
  },

  // Columns
  colDate: { width: "15%" },
  colShiftType: { width: "16%" },
  colTime: { width: "14%" },
  colBreak: { width: "8%", textAlign: "center" },
  colHours: { width: "10%", textAlign: "right" },
  colFacility: { width: "23%", paddingLeft: 4 },
  colStatus: { width: "14%", textAlign: "right" },

  shiftBadgeContainer: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  shiftBadgeText: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },

  dateText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  dayOfWeekText: {
    fontSize: 7,
    color: "#64748b",
  },
  timeText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  facilityNameText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  notesText: {
    fontSize: 6.5,
    color: "#64748b",
    marginTop: 1,
  },
  statusBadge: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
  },

  // Notes Box
  disclaimerBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    padding: 8,
    marginTop: 4,
  },
  disclaimerTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    marginBottom: 3,
  },
  disclaimerText: {
    fontSize: 7,
    color: "#475569",
    lineHeight: 1.35,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: {
    fontSize: 7,
    color: "#94a3b8",
  },
  pageNumber: {
    fontSize: 7,
    color: "#64748b",
    fontFamily: "Helvetica-Bold",
  },
});

export function WorkerDienstplanDocument({
  data,
  company,
}: {
  data: WorkerDienstplanPdfData;
  company: any;
}) {
  const salutationFormatted = formatWorkerSalutation(data.worker.salutation);
  const workerFullName = salutationFormatted
    ? `${salutationFormatted} ${data.worker.fullName}`
    : data.worker.fullName;

  return (
    <Document
      title={`Dienstplan ${data.worker.fullName} - ${data.monthLabel}`}
      author={company.name}
      subject="Monatlicher Schicht- und Einsatzplan"
    >
      <Page size="A4" orientation="portrait" style={styles.page}>
        {/* Header */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.companyName}>{company.name}</Text>
            <Text style={styles.companySub}>
              {company.street}, {company.city} · Tel: {company.phone} · {company.email}
            </Text>
          </View>
          <View style={styles.headerDocBlock}>
            <Text style={styles.docTitle}>Dienstplan</Text>
            <Text style={styles.docPeriod}>{data.monthLabel}</Text>
            <Text style={styles.generatedDate}>Stand: {data.generatedAt}</Text>
          </View>
        </View>

        {/* Top Worker & Month Summary Grid */}
        <View style={styles.topGrid}>
          {/* Worker Info Card */}
          <View style={styles.workerCard}>
            <Text style={styles.workerNameTitle}>{workerFullName}</Text>
            <View style={styles.workerMetaRow}>
              <Text style={styles.workerMetaLabel}>Personal-Nr.:</Text>
              <Text style={styles.workerMetaValue}>
                {data.worker.internalNumber || "–"}
              </Text>
            </View>
            <View style={styles.workerMetaRow}>
              <Text style={styles.workerMetaLabel}>Qualifikation:</Text>
              <Text style={styles.workerMetaValue}>{data.worker.qualification}</Text>
            </View>
            {data.worker.birthDate && (
              <View style={styles.workerMetaRow}>
                <Text style={styles.workerMetaLabel}>Geburtsdatum:</Text>
                <Text style={styles.workerMetaValue}>{data.worker.birthDate}</Text>
              </View>
            )}
            {data.worker.phone && (
              <View style={styles.workerMetaRow}>
                <Text style={styles.workerMetaLabel}>Telefon:</Text>
                <Text style={styles.workerMetaValue}>{data.worker.phone}</Text>
              </View>
            )}
          </View>

          {/* Month Totals Summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Monatsübersicht & Soll</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Gesamtanzahl Schichten:</Text>
              <Text style={styles.summaryValue}>{data.totals.totalShifts} Schichten</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Geplante Arbeitszeit:</Text>
              <Text style={styles.summaryValue}>
                {data.totals.plannedHours.toFixed(2).replace(".", ",")} Std.
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Bestätigte Arbeitszeit:</Text>
              <Text style={styles.summaryValue}>
                {data.totals.confirmedHours.toFixed(2).replace(".", ",")} Std.
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Monatliches Soll:</Text>
              <Text style={styles.summaryValue}>
                {data.totals.requiredHours.toFixed(2).replace(".", ",")} Std.
              </Text>
            </View>
          </View>
        </View>

        {/* Prominent Shift Legend (FD / SD / ND / TD) */}
        <View style={styles.legendBar}>
          <Text style={styles.legendTitle}>Dienstarten:</Text>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendBadge,
                { backgroundColor: "#e0f2fe", borderWidth: 1, borderColor: "#bae6fd" },
              ]}
            >
              <Text style={{ color: "#0369a1" }}>FD · Frühdienst</Text>
            </View>
            <Text style={{ fontSize: 7, color: "#64748b" }}>
              ({data.totals.earlyShiftsCount})
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendBadge,
                { backgroundColor: "#ffedd5", borderWidth: 1, borderColor: "#fed7aa" },
              ]}
            >
              <Text style={{ color: "#9a3412" }}>SD · Spätdienst</Text>
            </View>
            <Text style={{ fontSize: 7, color: "#64748b" }}>
              ({data.totals.lateShiftsCount})
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendBadge,
                { backgroundColor: "#ede9fe", borderWidth: 1, borderColor: "#c4b5fd" },
              ]}
            >
              <Text style={{ color: "#5b21b6" }}>ND · Nachtdienst</Text>
            </View>
            <Text style={{ fontSize: 7, color: "#64748b" }}>
              ({data.totals.nightShiftsCount})
            </Text>
          </View>
        </View>

        {/* Shifts Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader} fixed>
            <Text style={styles.colDate}>Datum / Tag</Text>
            <Text style={styles.colShiftType}>Dienst / Schicht</Text>
            <Text style={styles.colTime}>Arbeitszeit</Text>
            <Text style={styles.colBreak}>Pause</Text>
            <Text style={styles.colHours}>Netto-Std.</Text>
            <Text style={styles.colFacility}>Einrichtung & Bereich</Text>
            <Text style={styles.colStatus}>Status</Text>
          </View>

          {/* Table Rows */}
          {data.rows.length === 0 ? (
            <View style={{ padding: 16, textAlign: "center" }}>
              <Text style={{ color: "#64748b", fontSize: 9 }}>
                Für diesen Monat sind keine Schichten geplant.
              </Text>
            </View>
          ) : (
            data.rows.map((row, index) => {
              const isAlt = index % 2 === 1;
              return (
                <View
                  key={row.id}
                  wrap={false}
                  style={[
                    styles.tableRow,
                    isAlt ? styles.tableRowAlt : {},
                    row.isWeekend ? styles.tableRowWeekend : {},
                  ]}
                >
                  {/* Date & Weekday */}
                  <View style={styles.colDate}>
                    <Text style={styles.dateText}>{row.dateFormatted}</Text>
                    <Text style={styles.dayOfWeekText}>{row.dayOfWeek}</Text>
                  </View>

                  {/* Prominent Shift Badge (FD / SD / ND) */}
                  <View style={styles.colShiftType}>
                    <View
                      style={[
                        styles.shiftBadgeContainer,
                        {
                          backgroundColor: row.shiftBadgeBg,
                          borderColor: row.shiftBadgeBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.shiftBadgeText,
                          { color: row.shiftBadgeText },
                        ]}
                      >
                        {row.shiftCode} · {row.shiftLabel}
                      </Text>
                    </View>
                  </View>

                  {/* Time Range */}
                  <View style={styles.colTime}>
                    <Text style={styles.timeText}>{row.timeRange}</Text>
                  </View>

                  {/* Break */}
                  <View style={styles.colBreak}>
                    <Text style={{ fontSize: 7.5, color: "#475569" }}>
                      {row.breakMinutes > 0 ? `${row.breakMinutes}m` : "–"}
                    </Text>
                  </View>

                  {/* Scheduled Net Hours */}
                  <View style={styles.colHours}>
                    <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: "#0f172a" }}>
                      {row.scheduledHours.toFixed(2).replace(".", ",")} Std.
                    </Text>
                    {row.confirmedHours != null && (
                      <Text style={{ fontSize: 6.5, color: "#059669" }}>
                        Bestätigt: {row.confirmedHours.toFixed(2).replace(".", ",")}
                      </Text>
                    )}
                  </View>

                  {/* Facility & Notes / Station */}
                  <View style={styles.colFacility}>
                    <Text style={styles.facilityNameText}>
                      {row.facilityName}
                    </Text>
                    {row.notes && (
                      <Text style={styles.notesText}>{row.notes}</Text>
                    )}
                    {row.address && !row.notes && (
                      <Text style={styles.notesText}>{row.address}</Text>
                    )}
                  </View>

                  {/* Status */}
                  <View style={styles.colStatus}>
                    <Text
                      style={[
                        styles.statusBadge,
                        { color: row.isConfirmed ? "#059669" : "#d97706" },
                      ]}
                    >
                      {row.statusLabel}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Leave Days Section (if any) */}
        {data.leaves.length > 0 && (
          <View style={{ marginBottom: 12 }} wrap={false}>
            <Text
              style={{
                fontSize: 8.5,
                fontFamily: "Helvetica-Bold",
                color: "#0f172a",
                marginBottom: 4,
              }}
            >
              Abwesenheiten / Urlaubstage in diesem Monat:
            </Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {data.leaves.map((l, i) => (
                <View
                  key={i}
                  style={{
                    backgroundColor: "#fef2f2",
                    borderWidth: 1,
                    borderColor: "#fecaca",
                    borderRadius: 4,
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                  }}
                >
                  <Text style={{ fontSize: 7.5, color: "#991b1b" }}>
                    {l.dateFormatted} · {l.typeLabel} ({l.hours} Std.)
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Important Guidelines for Worker */}
        <View style={styles.disclaimerBox} wrap={false}>
          <Text style={styles.disclaimerTitle}>
            Wichtige Hinweise zum Dienst & Pünktlichkeit:
          </Text>
          <Text style={styles.disclaimerText}>
            • Bitte seien Sie pünktlich 10 Minuten vor Schichtbeginn in vollständiger Dienstkleidung in der Einrichtung vor Ort.
          </Text>
          <Text style={styles.disclaimerText}>
            • Achten Sie genau auf Ihre Einteilung (Frühdienst / Spätdienst / Nachtdienst) und die angegebenen Zeiten.
          </Text>
          <Text style={styles.disclaimerText}>
            • Lassen Sie Ihren Stundennachweis nach Schichtende unverzüglich von der verantwortlichen Stationsleitung abzeichnen.
          </Text>
          <Text style={styles.disclaimerText}>
            • Im Falle von unvorhergesehener Krankheit oder Verspätung ist die Disposition der RheinAhr Dienstleistungen GmbH sofort telefonisch zu verständigen.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.name} · Vertraulicher Monatsdienstplan für den internen Dienstgebrauch
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `Seite ${pageNumber} von ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function generateWorkerDienstplanPdf(
  data: WorkerDienstplanPdfData,
): Promise<Buffer> {
  const company = await getCompanyConfig();
  const element = <WorkerDienstplanDocument data={data} company={company} />;
  return renderToBuffer(element);
}
