import "server-only";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";

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
          <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: "#d32f2f", marginBottom: 8 }}>Personalliste / Arbeitszeitkonto</Text>
          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <Text style={{ width: 100, fontFamily: "Helvetica-Bold", color: "#d32f2f" }}>Monat:</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.month}</Text>
          </View>
        </View>

        <View style={styles.table}>
          {/* Header */}
          <View style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.tableCol, styles.colName]}><Text>Name, Vorname</Text></View>
            <View style={[styles.tableCol, styles.colNumber]}><Text>Stand alt</Text></View>
            <View style={[styles.tableCol, styles.colNumber]}><Text>Zu-/Abgang</Text></View>
            <View style={[styles.tableCol, styles.colNumberLast]}><Text>Stand neu</Text></View>
          </View>
          
          {/* Body */}
          {data.workers.map((w, i) => (
            <View key={i} style={styles.tableRow}>
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
