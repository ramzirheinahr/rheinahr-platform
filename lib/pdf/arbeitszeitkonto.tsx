import "server-only";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import React from "react";
import path from "path";
import fs from "fs";
import { getCompanyConfig } from "@/lib/config/company";
import { MonthlyHoursAccount } from "@/lib/hours-account";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  paragraph: { marginBottom: 12 },
  bold: { fontFamily: "Helvetica-Bold" },
  table: { display: "flex", flexDirection: "column", width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#000" },
  tableRow: { flexDirection: "row" },
  tableHeader: { backgroundColor: "#f3f4f6", fontFamily: "Helvetica-Bold", fontWeight: "bold", fontSize: 9 },
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
  colMonth: { width: "11%" },
  colSoll: { width: "9%" },
  colIst: { width: "9%" },
  colAusgleich: { width: "14%" },
  colUrlaub: { width: "9%" },
  colKrank: { width: "9%" },
  colSonstige: { width: "10%" },
  colSumme: { width: "13%" },
  colCumSum: { width: "16%", borderRightWidth: 0 },
});

export type ArbeitszeitkontoPdfData = {
  workerName: string;
  workerId: string;
  workerNumber?: string | null;
  startMonth: string;
  endMonth: string;
  months: MonthlyHoursAccount[];
  initialCarryover: number;
};

export const ArbeitszeitkontoTemplate = ({ data, companyConfig }: { data: ArbeitszeitkontoPdfData, companyConfig: any }) => {
  const formatHour = (h: number) => {
    if (h === 0) return "";
    return h.toFixed(2).replace(".", ",");
  };

  const formatSum = (h: number) => {
    return h.toFixed(2).replace(".", ",");
  };

  let logoSrc: string | null = null;
  if (companyConfig?.logoUrl) {
    if (companyConfig.logoUrl.startsWith("http") || companyConfig.logoUrl.startsWith("data:")) {
      logoSrc = companyConfig.logoUrl;
    } else {
      const fullPath = path.join(process.cwd(), "public", companyConfig.logoUrl.replace(/^\//, ""));
      if (fs.existsSync(fullPath)) {
        logoSrc = fullPath;
      }
    }
  }

  const finalBalance = data.months.length > 0 ? data.months[data.months.length - 1].cumulativeBalance : data.initialCarryover;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View fixed style={{ position: "absolute", top: 20, left: 48, right: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", fontSize: 8, color: "#6b7280", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingBottom: 4 }}>
          <Text>
            Arbeitszeitkonto - Mitarbeiter: {data.workerName}
            {data.workerNumber ? ` (Personal-Nr. ${data.workerNumber})` : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

        <View style={styles.header}>
          <View style={{ width: 140, minHeight: 45, justifyContent: "center" }}>
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoSrc} style={{ width: 140, maxHeight: 45, objectFit: "contain" }} />
            ) : (
              <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1e3a8a" }}>
                {companyConfig?.name || "RheinAhr"}
              </Text>
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 14 }}>
            <Text style={{ color: "#d32f2f", fontFamily: "Helvetica-Bold" }}>INTEGRITÄT</Text>
            <Text style={{ color: "#1e3a8a", fontFamily: "Helvetica-Bold" }}>WÜRDE</Text>
            <Text style={{ color: "#d32f2f", fontFamily: "Helvetica-Bold" }}>KOMPETENZ</Text>
            <Text style={{ color: "#1e3a8a", fontFamily: "Helvetica-Bold" }}>VERTRAUEN</Text>
          </View>
        </View>

        <View style={{ marginBottom: 20, marginTop: 16 }}>
          {data.workerNumber ? (
            <View style={{ flexDirection: "row", marginBottom: 6 }}>
              <Text style={{ width: 110, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>Personal-Nr. :</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.workerNumber}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            <Text style={{ width: 110, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>Mitarbeiter :</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.workerName}</Text>
          </View>
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            <Text style={{ width: 110, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>From :</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.startMonth}</Text>
          </View>
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            <Text style={{ width: 110, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>To :</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.endMonth}</Text>
          </View>
        </View>

        <View style={styles.table}>
          {/* Header */}
          <View fixed style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.tableCol, styles.colMonth]}><Text>Monat</Text></View>
            <View style={[styles.tableCol, styles.colSoll]}><Text>Soll</Text></View>
            <View style={[styles.tableCol, styles.colIst]}><Text>Ist</Text></View>
            <View style={[styles.tableCol, styles.colAusgleich]}><Text>K.Ausgleich</Text></View>
            <View style={[styles.tableCol, styles.colUrlaub]}><Text>Urlaub</Text></View>
            <View style={[styles.tableCol, styles.colKrank]}><Text>Krank</Text></View>
            <View style={[styles.tableCol, styles.colSonstige]}><Text>Sonstige</Text></View>
            <View style={[styles.tableCol, styles.colSumme]}><Text>Monatsaldo</Text></View>
            <View style={[styles.tableCol, styles.colCumSum]}><Text>Gesamtsaldo</Text></View>
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
            <View key={i} style={styles.tableRow} wrap={false}>
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

          {/* Footer (Total) */}
          <View style={[styles.tableRow, { backgroundColor: "#e5e7eb" }]}>
            <View style={[styles.tableCol, styles.colMonth]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSoll]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colIst]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colAusgleich]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colUrlaub]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colKrank]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSonstige]}><Text></Text></View>
            <View style={[styles.tableCol, styles.colSumme]}><Text style={[styles.bold, { color: "#1e3a8a" }]}>Total:</Text></View>
            <View style={[styles.tableCol, styles.colCumSum]}><Text style={[styles.bold, { color: "#1e3a8a" }]}>{formatSum(finalBalance)}</Text></View>
          </View>
        </View>

      </Page>
    </Document>
  );
};
