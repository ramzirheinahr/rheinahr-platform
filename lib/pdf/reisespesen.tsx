import "server-only";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import React from "react";
import path from "path";
import fs from "fs";
import type { CompanyConfig } from "@/lib/config/company";
import type { ReisespesenRow } from "@/lib/reports-data";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 8.5, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.4 },
  header: { marginBottom: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1.5, borderBottomColor: "#b91c1c", paddingBottom: 6, marginBottom: 10 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#b91c1c" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", fontSize: 9.5, marginBottom: 12 },
  table: { width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#000" },
  tableHeader: { flexDirection: "row", backgroundColor: "#f3f4f6", fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#9ca3af" },
  col: { padding: 3.5, borderRightWidth: 0.5, borderRightColor: "#9ca3af", justifyContent: "center" },
  colNr: { width: "5%", textAlign: "center" },
  colDate: { width: "13%", textAlign: "center" },
  colTime: { width: "9%", textAlign: "center" },
  colCustomer: { width: "22%" },
  colAddrFrom: { width: "16%" },
  colAddrTo: { width: "17%" },
  colDistance: { width: "9%", textAlign: "right" },
  colCost: { width: "9%", textAlign: "right", borderRightWidth: 0 },
  footerRow: { flexDirection: "row", backgroundColor: "#e5e7eb", fontFamily: "Helvetica-Bold", borderTopWidth: 1, borderTopColor: "#000" },
});

export type ReisespesenPdfProps = {
  companyConfig: CompanyConfig;
  workerName: string;
  workerNumber: string | null;
  year: number;
  month: number;
  rows: ReisespesenRow[];
  totalDistance: number;
  totalCost: number;
};

export const ReisespesenTemplate = ({
  companyConfig,
  workerName,
  workerNumber,
  year,
  month,
  rows,
  totalDistance,
  totalCost,
}: ReisespesenPdfProps) => {
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
        <View style={styles.titleRow}>
          <Text style={styles.title}>Reisespesen</Text>
          {logoSrc ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logoSrc} style={{ width: 140, maxHeight: 40, objectFit: "contain" }} />
          ) : (
            <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1e3a8a" }}>
              {companyConfig?.name || "RheinAhr Dienstleistungen GmbH"}
            </Text>
          )}
        </View>

        {/* Metadata */}
        <View style={styles.metaRow}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            Mitarbeiter: {workerName} {workerNumber ? `- ${workerNumber}` : ""}
          </Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            Jahr: {year}   Monat: {month}
          </Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, styles.colNr]}>#</Text>
            <Text style={[styles.col, styles.colDate]}>Datum</Text>
            <Text style={[styles.col, styles.colTime]}>Von</Text>
            <Text style={[styles.col, styles.colTime]}>Bis</Text>
            <Text style={[styles.col, styles.colCustomer]}>Kunde</Text>
            <Text style={[styles.col, styles.colAddrFrom]}>Adresse Von</Text>
            <Text style={[styles.col, styles.colAddrTo]}>Adresse Nach</Text>
            <Text style={[styles.col, styles.colDistance]}>km</Text>
            <Text style={[styles.col, styles.colCost]}>Kosten (€)</Text>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.col, styles.colNr]}>{r.index}</Text>
              <Text style={[styles.col, styles.colDate]}>{r.date}</Text>
              <Text style={[styles.col, styles.colTime]}>{r.fromTime}</Text>
              <Text style={[styles.col, styles.colTime]}>{r.toTime}</Text>
              <Text style={[styles.col, styles.colCustomer]}>{r.customerName}</Text>
              <Text style={[styles.col, styles.colAddrFrom]}>{r.addressFrom}</Text>
              <Text style={[styles.col, styles.colAddrTo]}>{r.addressTo}</Text>
              <Text style={[styles.col, styles.colDistance]}>
                {r.distanceKm.toFixed(2).replace(".", ",")}
              </Text>
              <Text style={[styles.col, styles.colCost]}>
                {r.totalCost.toFixed(2).replace(".", ",")}
              </Text>
            </View>
          ))}

          {/* Footer */}
          <View style={styles.footerRow}>
            <Text style={[styles.col, { width: "82%", textAlign: "right", paddingRight: 8 }]}>
              Gesamt:
            </Text>
            <Text style={[styles.col, styles.colDistance]}>
              {totalDistance.toFixed(2).replace(".", ",")}
            </Text>
            <Text style={[styles.col, styles.colCost]}>
              {totalCost.toFixed(2).replace(".", ",")}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
