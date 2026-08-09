import "server-only";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { MonthlyHoursAccount } from "@/lib/hours-account";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  paragraph: { marginBottom: 12 },
  bold: { fontFamily: "Helvetica-Bold" },
  table: { display: "flex", flexDirection: "column", width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#000" },
  tableRow: { flexDirection: "row" },
  tableHeader: { backgroundColor: "#f3f4f6", fontFamily: "Helvetica-Bold", fontWeight: "bold" },
  tableCol: { 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderColor: "#000",
    borderTopWidth: 0,
    borderLeftWidth: 0,
    padding: 4,
    justifyContent: "center",
    alignItems: "center"
  },
  colMonth: { width: "12%" },
  colSoll: { width: "10%" },
  colIst: { width: "10%" },
  colAusgleich: { width: "12%" },
  colUrlaub: { width: "10%" },
  colKrank: { width: "10%" },
  colSonstige: { width: "10%" },
  colSumme: { width: "11%" },
  colCumSum: { width: "15%", borderRightWidth: 0 },
});

export type ArbeitszeitkontoPdfData = {
  workerName: string;
  workerId: string;
  startMonth: string;
  endMonth: string;
  months: MonthlyHoursAccount[];
  initialCarryover: number;
};

export const ArbeitszeitkontoTemplate = ({ data }: { data: ArbeitszeitkontoPdfData }) => {
  const formatHour = (h: number) => {
    if (h === 0) return "";
    return h.toFixed(2).replace(".", ",");
  };

  const formatSum = (h: number) => {
    return h.toFixed(2).replace(".", ",");
  };

  const totalSumme = data.months.reduce((acc, m) => acc + m.monthBalance, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={{ fontSize: 24, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>RheinAhr</Text>
            <Text style={{ fontSize: 14, color: "#1e3a8a", marginTop: 4 }}>Dienstleistungen GmbH</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
            <Text style={{ color: "#d32f2f", fontFamily: "Helvetica-Bold" }}>INTEGRITÄT</Text>
            <Text style={{ color: "#1e3a8a", fontFamily: "Helvetica-Bold" }}>WÜRDE</Text>
            <Text style={{ color: "#d32f2f", fontFamily: "Helvetica-Bold" }}>KOMPETENZ</Text>
            <Text style={{ color: "#1e3a8a", fontFamily: "Helvetica-Bold" }}>VERTRAUEN</Text>
          </View>
        </View>

        <View style={{ marginBottom: 24, marginTop: 24 }}>
          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <Text style={{ width: 100, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>Mitarbeiter :</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.workerName}</Text>
          </View>
          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <Text style={{ width: 100, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>From :</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.startMonth}</Text>
          </View>
          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <Text style={{ width: 100, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>To :</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.endMonth}</Text>
          </View>
        </View>

        <View style={styles.table}>
          {/* Header */}
          <View style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.tableCol, styles.colMonth]}><Text>Month</Text></View>
            <View style={[styles.tableCol, styles.colSoll]}><Text>Soll</Text></View>
            <View style={[styles.tableCol, styles.colIst]}><Text>Ist</Text></View>
            <View style={[styles.tableCol, styles.colAusgleich]}><Text>K.Ausgleich</Text></View>
            <View style={[styles.tableCol, styles.colUrlaub]}><Text>Urlaub</Text></View>
            <View style={[styles.tableCol, styles.colKrank]}><Text>Krank</Text></View>
            <View style={[styles.tableCol, styles.colSonstige]}><Text>Sonstige</Text></View>
            <View style={[styles.tableCol, styles.colSumme]}><Text>Summe</Text></View>
            <View style={[styles.tableCol, styles.colCumSum]}><Text>Cumulative Sum</Text></View>
          </View>
          
          {/* Übertrag Row */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol, styles.colMonth]}><Text>Übertrag</Text></View>
            <View style={[styles.tableCol, styles.colSoll]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colIst]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colAusgleich]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colUrlaub]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colKrank]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSonstige]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSumme]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colCumSum]}><Text>{formatSum(data.initialCarryover)}</Text></View>
          </View>

          {/* Body */}
          {data.months.map((m, i) => (
            <View key={i} style={styles.tableRow}>
              <View style={[styles.tableCol, styles.colMonth]}><Text>{m.month}</Text></View>
              <View style={[styles.tableCol, styles.colSoll]}><Text>{formatSum(m.requiredHours)}</Text></View>
              <View style={[styles.tableCol, styles.colIst]}><Text>{formatHour(m.workedHours)}</Text></View>
              <View style={[styles.tableCol, styles.colAusgleich]}><Text>{formatHour(m.kAusgleichHours)}</Text></View>
              <View style={[styles.tableCol, styles.colUrlaub]}><Text>{formatHour(m.vacationHours)}</Text></View>
              <View style={[styles.tableCol, styles.colKrank]}><Text>{formatHour(m.sickHours)}</Text></View>
              <View style={[styles.tableCol, styles.colSonstige]}><Text>{formatHour(m.sonstigeHours)}</Text></View>
              <View style={[styles.tableCol, styles.colSumme]}><Text>{formatSum(m.monthBalance)}</Text></View>
              <View style={[styles.tableCol, styles.colCumSum]}><Text>{formatSum(m.cumulativeBalance)}</Text></View>
            </View>
          ))}

          {/* Footer (Total Summe) */}
          <View style={styles.tableRow}>
            <View style={[styles.tableCol, styles.colMonth]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSoll]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colIst]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colAusgleich]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colUrlaub]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colKrank]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSonstige]}><Text style={styles.bold}>Summe</Text></View>
            <View style={[styles.tableCol, styles.colSumme]}><Text style={styles.bold}>{formatSum(totalSumme)}</Text></View>
            <View style={[styles.tableCol, styles.colCumSum]}><Text></Text></View>
          </View>
        </View>

      </Page>
    </Document>
  );
};
