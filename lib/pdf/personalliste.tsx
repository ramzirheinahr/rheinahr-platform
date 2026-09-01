import "server-only";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import React from "react";
import { companyConfig } from "@/lib/config/company";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 8 },
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
    padding: 6,
    justifyContent: "center",
    alignItems: "flex-start"
  },
  colName: { width: "40%" },
  colNumber: { width: "20%", alignItems: "center" },
  colNumberLast: { width: "20%", alignItems: "center", borderRightWidth: 0 },
});

export type PersonallistePdfData = {
  month: string;
  workers: {
    fullName: string;
    standAlt: number;
    zuAbgang: number;
    standNeu: number;
  }[];
};

export const PersonallisteTemplate = ({ data }: { data: PersonallistePdfData }) => {
  const formatSum = (h: number) => {
    return h.toFixed(2).replace(".", ",");
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View fixed style={{ position: "absolute", top: 20, left: 48, right: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", fontSize: 8, color: "#6b7280", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingBottom: 4 }}>
          <Text>Personalliste / Arbeitszeitkonto - Monat: {data.month}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

        <View style={styles.header}>
          <View>
            <Image src={process.cwd() + "/public" + companyConfig.logoUrl.replace(/^\//, '')} style={{ height: 40 }} />
          </View>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
            <Text style={{ color: "#d32f2f", fontFamily: "Helvetica-Bold" }}>INTEGRITÄT</Text>
            <Text style={{ color: "#1e3a8a", fontFamily: "Helvetica-Bold" }}>WÜRDE</Text>
            <Text style={{ color: "#d32f2f", fontFamily: "Helvetica-Bold" }}>KOMPETENZ</Text>
            <Text style={{ color: "#1e3a8a", fontFamily: "Helvetica-Bold" }}>VERTRAUEN</Text>
          </View>
        </View>

        <View style={{ marginBottom: 24, marginTop: 24 }}>
          <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: "#d32f2f", marginBottom: 8 }}>Personalliste / Arbeitszeitkonto</Text>
          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <Text style={{ width: 100, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>Monat:</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.month}</Text>
          </View>
        </View>

        <View style={styles.table}>
          {/* Header */}
          <View fixed style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.tableCol, styles.colName]}><Text>Name, Vorname</Text></View>
            <View style={[styles.tableCol, styles.colNumber]}><Text>Stand alt</Text></View>
            <View style={[styles.tableCol, styles.colNumber]}><Text>Zu-/Abgang</Text></View>
            <View style={[styles.tableCol, styles.colNumberLast]}><Text>Stand neu</Text></View>
          </View>
          
          {/* Body */}
          {data.workers.map((w, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <View style={[styles.tableCol, styles.colName]}><Text>{w.fullName}</Text></View>
              <View style={[styles.tableCol, styles.colNumber]}><Text>{formatSum(w.standAlt)}</Text></View>
              <View style={[styles.tableCol, styles.colNumber]}><Text>{formatSum(w.zuAbgang)}</Text></View>
              <View style={[styles.tableCol, styles.colNumberLast]}><Text>{formatSum(w.standNeu)}</Text></View>
            </View>
          ))}
        </View>

      </Page>
    </Document>
  );
};
