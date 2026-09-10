import "server-only";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import React from "react";
import path from "path";
import fs from "fs";
import type { CompanyConfig } from "@/lib/config/company";
import type { MonatslisteRow } from "@/lib/reports-data";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 8.5, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.4 },
  header: { marginBottom: 14 },
  logoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoContainer: { width: 220 },
  slogan: { fontSize: 8, color: "#1e3a8a", marginTop: 4, fontFamily: "Helvetica-Bold" },
  metaContainer: { marginTop: 12, marginBottom: 12 },
  workerLine: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#b91c1c", marginBottom: 4 },
  dateLine: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#b91c1c" },
  table: { width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#000", marginTop: 6 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f3f4f6", fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d1d5db" },
  col: { padding: 3, borderRightWidth: 0.5, borderRightColor: "#d1d5db", justifyContent: "center", textAlign: "center" },
  colDate: { width: "13%" },
  colShift: { width: "9%" },
  colHours: { width: "9%" },
  colClient: { width: "25%", borderRightWidth: 0, textAlign: "left", paddingLeft: 6 },
});

export type MonatslistePdfProps = {
  companyConfig: CompanyConfig;
  workerName: string;
  workerNumber: string | null;
  year: number;
  month: number;
  rows: MonatslisteRow[];
};

export const MonatslisteTemplate = ({
  companyConfig,
  workerName,
  workerNumber,
  year,
  month,
  rows,
}: MonatslistePdfProps) => {
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

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoContainer}>
              {logoSrc ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={logoSrc} style={{ width: 170, maxHeight: 50, objectFit: "contain" }} />
              ) : (
                <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: "#b91c1c" }}>
                  {companyConfig?.name || "RheinAhr Dienstleistungen GmbH"}
                </Text>
              )}
            </View>
            <Text style={styles.slogan}>
              INTEGRITÄT    WÜRDE    KOMPETENZ    VERTRAUEN
            </Text>
          </View>

          <View style={styles.metaContainer}>
            <Text style={styles.workerLine}>
              Mitarbeiter : {workerName} {workerNumber ? `- ${workerNumber}` : ""}
            </Text>
            <Text style={styles.dateLine}>
              Jahr : {year}          Monat : {month}
            </Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, styles.colDate]}>Datum</Text>
            <Text style={[styles.col, styles.colShift]}>Kommt 1</Text>
            <Text style={[styles.col, styles.colShift]}>Geht 1</Text>
            <Text style={[styles.col, styles.colShift]}>Pause 1</Text>
            <Text style={[styles.col, styles.colShift]}>Kommt 2</Text>
            <Text style={[styles.col, styles.colShift]}>Geht 2</Text>
            <Text style={[styles.col, styles.colShift]}>Pause 2</Text>
            <Text style={[styles.col, styles.colHours]}>Stunden</Text>
            <Text style={[styles.col, styles.colClient]}>Auftraggeber</Text>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.col, styles.colDate]}>{r.date}</Text>
              <Text style={[styles.col, styles.colShift]}>{r.shift1.kommt}</Text>
              <Text style={[styles.col, styles.colShift]}>{r.shift1.geht}</Text>
              <Text style={[styles.col, styles.colShift]}>{r.shift1.pause}</Text>
              <Text style={[styles.col, styles.colShift]}>{r.shift2.kommt}</Text>
              <Text style={[styles.col, styles.colShift]}>{r.shift2.geht}</Text>
              <Text style={[styles.col, styles.colShift]}>{r.shift2.pause}</Text>
              <Text style={[styles.col, styles.colHours]}>
                {r.hours.toFixed(2).replace(".", ",")}
              </Text>
              <Text style={[styles.col, styles.colClient]}>{r.customerName}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
};
