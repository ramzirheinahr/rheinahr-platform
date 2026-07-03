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
import { qualLabel } from "@/lib/invoicing";
import type { ClientScheduleRow, ClientScheduleTotals } from "@/lib/client-schedule";

export type MonatsuebersichtData = {
  facilityName: string;
  monthLabel: string; // e.g. "Juli 2026"
  rows: ClientScheduleRow[];
  totals: ClientScheduleTotals;
  generatedAt: string; // formatted timestamp
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 9, color: "#1f2937", fontFamily: "Helvetica" },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1e3a8a" },
  brandSub: { fontSize: 9, color: "#6b7280", marginTop: 2 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 10,
    marginBottom: 20,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, color: "#6b7280", marginTop: 4, marginBottom: 16 },
  th: {
    flexDirection: "row",
    backgroundColor: "#eef2ff",
    borderBottomWidth: 1,
    borderBottomColor: "#c7d2fe",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  total: {
    flexDirection: "row",
    backgroundColor: "#ecfdf5",
    borderTopWidth: 1.5,
    borderTopColor: "#059669",
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
  },
  cDate: { width: 58 },
  cWorker: { flex: 1.4 },
  cQual: { flex: 1 },
  cWard: { flex: 0.9 },
  cTime: { width: 40 },
  cStatus: { flex: 1 },
  cHours: { width: 60, textAlign: "right" },
  confirmed: { color: "#059669" },
  muted: { color: "#9ca3af" },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#9ca3af",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
  },
});

const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const deNum = (n: number) => n.toString().replace(".", ",");

const statusLabel: Record<ClientScheduleRow["status"], string> = {
  pending: "Ausstehend",
  confirmed: "Bestätigt",
  declined: "Abgelehnt",
};

function MonatsuebersichtDocument({ d }: { d: MonatsuebersichtData }) {
  return (
    <Document
      title={`Monatsübersicht ${d.monthLabel} – ${d.facilityName}`}
      author="RheinAhr Dienstleistungen GmbH"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow} fixed>
          <View>
            <Text style={styles.brand}>RheinAhr Dienstleistungen GmbH</Text>
            <Text style={styles.brandSub}>Fronhof 4, 53177 Bonn · info@rheinahr-gmbh.de</Text>
          </View>
          <Text style={styles.brandSub}>HRB 23459 · USt-IdNr. DE316507908</Text>
        </View>

        <Text style={styles.title}>Monatsübersicht {d.monthLabel}</Text>
        <Text style={styles.subtitle}>
          {d.facilityName} — Einsätze und vom Kunden bestätigte Stunden (ohne Pausen)
        </Text>

        <View style={styles.th} fixed>
          <Text style={styles.cDate}>Datum</Text>
          <Text style={styles.cWorker}>Pflegekraft</Text>
          <Text style={styles.cQual}>Qualifikation</Text>
          <Text style={styles.cWard}>Wohnbereich</Text>
          <Text style={styles.cTime}>Beginn</Text>
          <Text style={styles.cTime}>Ende</Text>
          <Text style={styles.cStatus}>Status</Text>
          <Text style={styles.cHours}>Stunden</Text>
        </View>

        {d.rows.map((r) => (
          <View key={r.id} style={styles.tr} wrap={false}>
            <Text style={styles.cDate}>{deDate(r.date)}</Text>
            <Text style={styles.cWorker}>{r.workerName}</Text>
            <Text style={styles.cQual}>{qualLabel[r.qualification]}</Text>
            <Text style={styles.cWard}>{r.notes ?? ""}</Text>
            <Text style={styles.cTime}>{r.startTime}</Text>
            <Text style={styles.cTime}>{r.endTime}</Text>
            <Text style={r.confirmedHours != null ? [styles.cStatus, styles.confirmed] : styles.cStatus}>
              {r.confirmedHours != null ? "Vom Kunden bestätigt" : statusLabel[r.status]}
            </Text>
            <Text style={r.confirmedHours != null ? [styles.cHours, styles.confirmed] : [styles.cHours, styles.muted]}>
              {r.confirmedHours != null ? `${deNum(r.confirmedHours)} Std.` : "—"}
            </Text>
          </View>
        ))}

        <View style={styles.total} wrap={false}>
          <Text style={{ flex: 1 }}>
            Gesamtstunden im Monat (ohne Pausen) — {d.totals.confirmedShifts} bestätigte
            Schicht(en)
          </Text>
          <Text style={[styles.cHours, styles.confirmed]}>
            {deNum(d.totals.confirmedHours)} Std.
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          Digital erstellt am {d.generatedAt}. Bestätigte Stunden entsprechen den digital
          signierten Leistungsnachweisen (DSGVO-konform protokolliert).
        </Text>
      </Page>
    </Document>
  );
}

export function renderMonatsuebersichtPdf(d: MonatsuebersichtData): Promise<Buffer> {
  return renderToBuffer(<MonatsuebersichtDocument d={d} />);
}
