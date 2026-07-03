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
import {
  availCellText,
  workCellText,
  type GridFacility,
  type GridWorkerRow,
} from "@/lib/master-schedule-core";

// Master Dienstplan as a printable sheet — the same layout the team has used
// in Excel for years: day columns, two lines per worker (availability /
// worked codes), green confirmed cells, weekend tint, facility legend.

export type DienstplanPdfData = {
  qualificationLabel: string;
  monthLabel: string; // e.g. "Juli 2026"
  daysInMonth: number;
  tinted: boolean[]; // index day-1 — weekend or NRW holiday
  rows: GridWorkerRow[];
  facilities: GridFacility[];
  generatedAt: string;
};

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 5.5, color: "#1f2937", fontFamily: "Helvetica" },
  brand: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#7f1d1d" },
  brandSub: { fontSize: 7, color: "#6b7280", marginTop: 2 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1.5,
    borderBottomColor: "#7f1d1d",
    paddingBottom: 6,
    marginBottom: 10,
  },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  row: { flexDirection: "row" },
  nameCell: {
    width: 88,
    backgroundColor: "#7f1d1d",
    color: "#ffffff",
    paddingHorizontal: 3,
    paddingVertical: 2,
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ffffff",
    justifyContent: "center",
  },
  dayHead: {
    flex: 1,
    backgroundColor: "#450a0a",
    color: "#ffffff",
    textAlign: "center",
    paddingVertical: 2,
    fontFamily: "Helvetica-Bold",
    borderRightWidth: 0.5,
    borderRightColor: "#9ca3af",
  },
  cell: {
    flex: 1,
    minHeight: 9,
    textAlign: "center",
    paddingVertical: 1.5,
    borderRightWidth: 0.5,
    borderRightColor: "#d1d5db",
    borderBottomWidth: 0.5,
    borderBottomColor: "#d1d5db",
  },
  tint: { backgroundColor: "#fdecec" },
  confirmed: { backgroundColor: "#059669", color: "#ffffff", fontFamily: "Helvetica-Bold" },
  work: { color: "#dc2626", fontFamily: "Helvetica-Bold" },
  workerEnd: { borderBottomWidth: 1, borderBottomColor: "#6b7280" },
  legendTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  legendWrap: { flexDirection: "row", flexWrap: "wrap" },
  legendItem: { width: "20%", fontSize: 6, marginBottom: 2, flexDirection: "row" },
  legendCode: { fontFamily: "Helvetica-Bold", width: 22 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 24,
    right: 24,
    fontSize: 6,
    color: "#9ca3af",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    paddingTop: 4,
  },
});

function DienstplanDocument({ d }: { d: DienstplanPdfData }) {
  const dayIdx = Array.from({ length: d.daysInMonth }, (_, i) => i);
  return (
    <Document
      title={`Dienstplan ${d.qualificationLabel} ${d.monthLabel}`}
      author="RheinAhr Dienstleistungen GmbH"
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.headerRow} fixed>
          <View>
            <Text style={styles.brand}>RheinAhr Dienstleistungen GmbH</Text>
            <Text style={styles.brandSub}>Fronhof 4, 53177 Bonn · info@rheinahr-gmbh.de</Text>
          </View>
          <Text style={styles.brandSub}>HRB 23459 · USt-IdNr. DE316507908</Text>
        </View>

        <Text style={styles.title}>
          Dienstplan {d.qualificationLabel} — {d.monthLabel}
        </Text>

        <View style={styles.row} fixed>
          <View style={[styles.nameCell, { backgroundColor: "#450a0a" }]}>
            <Text>Name</Text>
          </View>
          {dayIdx.map((i) => (
            <Text key={i} style={styles.dayHead}>
              {String(i + 1).padStart(2, "0")}.
            </Text>
          ))}
        </View>

        {d.rows.map((r) => (
          <View key={r.workerId} wrap={false}>
            <View style={styles.row}>
              <View style={styles.nameCell}>
                <Text>{r.name}</Text>
              </View>
              {dayIdx.map((i) => {
                const { text, confirmed } = availCellText(r.days[i]);
                return (
                  <Text
                    key={i}
                    style={[
                      styles.cell,
                      ...(d.tinted[i] ? [styles.tint] : []),
                      ...(confirmed ? [styles.confirmed] : []),
                    ]}
                  >
                    {text}
                  </Text>
                );
              })}
            </View>
            <View style={styles.row}>
              <View style={[styles.nameCell, styles.workerEnd]}>
                <Text> </Text>
              </View>
              {dayIdx.map((i) => (
                <Text
                  key={i}
                  style={[
                    styles.cell,
                    styles.work,
                    styles.workerEnd,
                    ...(d.tinted[i] ? [styles.tint] : []),
                  ]}
                >
                  {workCellText(r.days[i])}
                </Text>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.legendTitle}>Legende (F = Früh · S = Spät · N = Nacht)</Text>
        <View style={styles.legendWrap}>
          {d.facilities.map((f) => (
            <View key={f.clientId} style={styles.legendItem} wrap={false}>
              <Text style={styles.legendCode}>{f.code}</Text>
              <Text>{f.name}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          Digital erstellt am {d.generatedAt}. Grün = vom Kunden bestätigter Einsatz
          (Wohnbereich, 0 = ohne Angabe). Zeile 1 Verfügbarkeit, Zeile 2 geleistete Dienste.
        </Text>
      </Page>
    </Document>
  );
}

export function renderDienstplanPdf(d: DienstplanPdfData): Promise<Buffer> {
  return renderToBuffer(<DienstplanDocument d={d} />);
}
