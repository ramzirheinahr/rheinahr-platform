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
import { qualLabel } from "@/lib/invoicing";
import { germanHolidays } from "@/lib/holidays";
import type { ClientScheduleRow, ClientScheduleTotals } from "@/lib/client-schedule";

export type MonatsuebersichtData = {
  facilityName: string;
  monthLabel: string; // e.g. "Oktober 2026"
  rows: ClientScheduleRow[];
  totals: ClientScheduleTotals;
  generatedAt: string; // formatted timestamp
};

const styles = StyleSheet.create({
  page: {
    paddingVertical: 32,
    paddingHorizontal: 36,
    fontSize: 8.5,
    color: "#1f2937",
    fontFamily: "Helvetica",
  },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#1e3a8a" },
  brandSub: { fontSize: 8.5, color: "#6b7280", marginTop: 2 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 8,
    marginBottom: 16,
  },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9.5, color: "#6b7280", marginTop: 3, marginBottom: 12 },
  th: {
    flexDirection: "row",
    backgroundColor: "#eef2ff",
    borderBottomWidth: 1,
    borderBottomColor: "#c7d2fe",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    alignItems: "center",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 3.5,
    paddingHorizontal: 4,
    fontSize: 8,
    alignItems: "center",
  },
  // Distinctive background colors for Saturday and Sunday/Holidays
  trSaturday: {
    backgroundColor: "#fef3c7", // Distinctive warm amber/yellow for Samstag
  },
  trSundayHoliday: {
    backgroundColor: "#fee2e2", // Distinctive soft rose/red for Sonntag & gesetzliche Feiertage
  },
  total: {
    flexDirection: "row",
    backgroundColor: "#ecfdf5",
    borderTopWidth: 1.5,
    borderTopColor: "#059669",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
  },
  cDate: { width: 54 },
  cWorker: { flex: 1.2 },
  cDob: { width: 56, textAlign: "center" },
  cQual: { flex: 0.9 },
  cWard: { flex: 0.7 },
  cTime: { width: 30, textAlign: "center" },
  cStatus: { flex: 1 },
  cHours: { width: 48, textAlign: "right" },
  confirmed: { color: "#059669" },
  accepted: { color: "#b45309" },
  muted: { color: "#9ca3af" },
  legendRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendBox: {
    width: 10,
    height: 10,
    borderWidth: 0.5,
    borderColor: "#d1d5db",
  },
  legendText: {
    fontSize: 7.5,
    color: "#4b5563",
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  totalLabel: { color: "#374151", fontSize: 8.5 },
  totalValue: { width: 150, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  grandValue: { width: 150, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 10 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 7.5,
    color: "#9ca3af",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
  },
});

const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// Clean rounding to max 2 decimal places to prevent floating-point decimals like 7.333333333333333
const deNum = (n: number) => {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.00$/, "").replace(".", ",");
};

const statusText = (r: ClientScheduleRow): string =>
  r.billing === "confirmed"
    ? "Vom Kunden bestätigt"
    : r.billing === "accepted"
      ? "Angenommen (vorläufig)"
      : r.status === "pending"
        ? "Ausstehend"
        : r.status === "declined"
          ? "Abgelehnt"
          : "Bestätigt";

function MonatsuebersichtDocument({
  d,
  companyConfig,
}: {
  d: MonatsuebersichtData;
  companyConfig: any;
}) {
  // Map of holidays for all relevant years in rows
  const holidayCache = new Map<number, Map<string, string>>();
  const getHolidays = (year: number) => {
    if (!holidayCache.has(year)) {
      holidayCache.set(year, germanHolidays(year));
    }
    return holidayCache.get(year)!;
  };

  return (
    <Document
      title={`Monatsübersicht ${d.monthLabel} – ${d.facilityName}`}
      author={companyConfig.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow} fixed>
          <View>
            <Text style={styles.brand}>{companyConfig.name}</Text>
            <Text style={styles.brandSub}>
              {companyConfig.street}, {companyConfig.city} · {companyConfig.email}
            </Text>
          </View>
          <Text style={styles.brandSub}>{companyConfig.hrb} · USt-IdNr. {companyConfig.vatId}</Text>
        </View>

        <Text style={styles.title}>Monatsübersicht {d.monthLabel}</Text>
        <Text style={styles.subtitle}>
          {d.facilityName} — Einsätze und Stunden (ohne Pausen)
        </Text>

        {/* 9 Columns including Geburtsdatum */}
        <View style={styles.th} fixed>
          <Text style={styles.cDate}>Datum</Text>
          <Text style={styles.cWorker}>Pflegekraft</Text>
          <Text style={styles.cDob}>Geburtsdatum</Text>
          <Text style={styles.cQual}>Qualifikation</Text>
          <Text style={styles.cWard}>Wohnbereich</Text>
          <Text style={styles.cTime}>Beginn</Text>
          <Text style={styles.cTime}>Ende</Text>
          <Text style={styles.cStatus}>Status</Text>
          <Text style={styles.cHours}>Stunden</Text>
        </View>

        {d.rows.map((r) => {
          const hours =
            r.billing === "confirmed"
              ? r.confirmedHours ?? 0
              : r.billing === "accepted"
                ? r.scheduledHours
                : null;
          const tone =
            r.billing === "confirmed"
              ? styles.confirmed
              : r.billing === "accepted"
                ? styles.accepted
                : styles.muted;

          // Determine day type for distinctive background coloring
          const rowDate = new Date(`${r.date}T00:00:00Z`);
          const dow = rowDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
          const year = rowDate.getUTCFullYear();
          const holidays = getHolidays(year);
          const holidayName = holidays.get(r.date);
          const isSunday = dow === 0;
          const isSaturday = dow === 6;
          const isHoliday = !!holidayName;

          const rowBgStyle =
            isSunday || isHoliday
              ? styles.trSundayHoliday
              : isSaturday
                ? styles.trSaturday
                : {};

          return (
            <View key={r.id} style={[styles.tr, rowBgStyle]} wrap={false}>
              <Text style={styles.cDate}>{deDate(r.date)}</Text>
              <Text style={styles.cWorker}>{r.workerName}</Text>
              <Text style={styles.cDob}>{r.workerBirthDate || "—"}</Text>
              <Text style={styles.cQual}>{qualLabel[r.qualification] || r.qualification}</Text>
              <Text style={styles.cWard}>{r.notes ?? ""}</Text>
              <Text style={styles.cTime}>{r.startTime}</Text>
              <Text style={styles.cTime}>{r.endTime}</Text>
              <Text style={r.billing ? [styles.cStatus, tone] : styles.cStatus}>
                {statusText(r)}
              </Text>
              <Text style={[styles.cHours, tone]}>
                {hours != null ? `${deNum(hours)} Std.` : "—"}
              </Text>
            </View>
          );
        })}

        {/* Legend for highlighted weekend / holiday colors */}
        <View style={styles.legendRow} wrap={false}>
          <View style={styles.legendItem}>
            <View style={[styles.legendBox, { backgroundColor: "#fef3c7" }]} />
            <Text style={styles.legendText}>Samstag</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendBox, { backgroundColor: "#fee2e2" }]} />
            <Text style={styles.legendText}>Sonn- & gesetzliche Feiertage</Text>
          </View>
        </View>

        <View style={styles.total} wrap={false}>
          <Text style={{ flex: 1 }}>Monatssumme (ohne Pausen)</Text>
        </View>
        {d.totals.acceptedShifts > 0 ? (
          <View style={styles.totalLine} wrap={false}>
            <Text style={styles.totalLabel}>Angenommen (vorläufig): </Text>
            <Text style={[styles.totalValue, styles.accepted]}>
              {deNum(d.totals.acceptedHours)} Std.
            </Text>
          </View>
        ) : null}
        <View style={styles.totalLine} wrap={false}>
          <Text style={styles.totalLabel}>Vom Kunden bestätigt: </Text>
          <Text style={[styles.totalValue, styles.confirmed]}>
            {deNum(d.totals.confirmedHours)} Std.
          </Text>
        </View>
        <View style={styles.totalLine} wrap={false}>
          <Text style={styles.totalLabel}>Gesamt (inkl. vorläufig): </Text>
          <Text style={[styles.grandValue, styles.confirmed]}>
            {deNum(d.totals.totalHours)} Std.
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          Digital erstellt am {d.generatedAt}. „Vom Kunden bestätigt“ entspricht den digital
          signierten Leistungsnachweisen; „vorläufig“ sind angenommene, noch nicht
          unterschriebene Einsätze. Samstage sowie Sonn- und Feiertage sind farblich hervorgehoben.
          (DSGVO-konform protokolliert).
        </Text>
      </Page>
    </Document>
  );
}

export async function renderMonatsuebersichtPdf(d: MonatsuebersichtData): Promise<Buffer> {
  const companyConfig = await getCompanyConfig();
  return renderToBuffer(<MonatsuebersichtDocument d={d} companyConfig={companyConfig} />);
}
