import "server-only";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import type { CompanyConfig } from "@/lib/config/company";
import type { AuegRow } from "@/lib/reports-data";

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 7.5, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.3 },
  banner: { backgroundColor: "#dc2626", color: "#ffffff", padding: 4, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 8, textTransform: "lowercase" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8, fontSize: 8.5 },
  table: { width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#000" },
  tableHeader: { flexDirection: "row", backgroundColor: "#f9fafb", fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#9ca3af" },
  col: { padding: 3, borderRightWidth: 0.5, borderRightColor: "#9ca3af", justifyContent: "center" },
  colNr: { width: "5%", textAlign: "center" },
  colName: { width: "15%" },
  colDate: { width: "8%", textAlign: "center" },
  colRole: { width: "12%" },
  colWorkTime: { width: "6%", textAlign: "center" },
  colPeriod: { width: "12%", textAlign: "center" },
  colHirer: { width: "22%" },
  colBranch: { width: "12%", borderRightWidth: 0 },
});

export type AuegPdfProps = {
  companyConfig: CompanyConfig;
  rows: AuegRow[];
};

export const AuegTemplate = ({ companyConfig, rows }: AuegPdfProps) => {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Banner */}
        <View style={styles.banner}>
          <Text>liste der leiharbeitskräfte : aktuell und ausgeschieden</Text>
        </View>

        {/* Subheader */}
        <View style={styles.headerRow}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            Firma: {companyConfig?.name || "RheinAhr Dienstleistungen GmbH"}
          </Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            AÜG-Nr. 30101/020218/40517
          </Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, styles.colNr]}>Lfd. Nr.</Text>
            <Text style={[styles.col, styles.colName]}>Nachname, Vorname</Text>
            <Text style={[styles.col, styles.colDate]}>Geburtsdatum</Text>
            <Text style={[styles.col, styles.colDate]}>Eintritt</Text>
            <Text style={[styles.col, styles.colDate]}>Austritt</Text>
            <Text style={[styles.col, styles.colRole]}>Tätigkeit laut Arbeitsvertrag</Text>
            <Text style={[styles.col, styles.colWorkTime]}>Arbeitszeit</Text>
            <Text style={[styles.col, styles.colPeriod]}>Einsatzzeiträume von - bis</Text>
            <Text style={[styles.col, styles.colHirer]}>Entleiher</Text>
            <Text style={[styles.col, styles.colBranch]}>Branche des Entleihers</Text>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.col, styles.colNr]}>{r.internalNumber}</Text>
              <Text style={[styles.col, styles.colName]}>
                {r.lastName}, {r.firstName}
              </Text>
              <Text style={[styles.col, styles.colDate]}>{r.birthDate}</Text>
              <Text style={[styles.col, styles.colDate]}>{r.entryDate}</Text>
              <Text style={[styles.col, styles.colDate]}>{r.exitDate}</Text>
              <Text style={[styles.col, styles.colRole]}>{r.qualification}</Text>
              <Text style={[styles.col, styles.colWorkTime]}>{r.employmentType}</Text>
              
              {/* Deployments */}
              <View style={[styles.col, styles.colPeriod, { padding: 0 }]}>
                {r.deployments.map((d, dIdx) => (
                  <Text key={dIdx} style={{ padding: 2, borderBottomWidth: dIdx < r.deployments.length - 1 ? 0.5 : 0, borderBottomColor: "#e5e7eb" }}>
                    {d.period}
                  </Text>
                ))}
              </View>

              <View style={[styles.col, styles.colHirer, { padding: 0 }]}>
                {r.deployments.map((d, dIdx) => (
                  <Text key={dIdx} style={{ padding: 2, borderBottomWidth: dIdx < r.deployments.length - 1 ? 0.5 : 0, borderBottomColor: "#e5e7eb" }}>
                    {d.clientName}
                  </Text>
                ))}
              </View>

              <View style={[styles.col, styles.colBranch, { padding: 0 }]}>
                {r.deployments.map((d, dIdx) => (
                  <Text key={dIdx} style={{ padding: 2, borderBottomWidth: dIdx < r.deployments.length - 1 ? 0.5 : 0, borderBottomColor: "#e5e7eb" }}>
                    {d.industry}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
};
