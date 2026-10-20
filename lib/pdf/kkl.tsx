import "server-only";

import React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { KklReportData } from "@/lib/kkl";

function getLogoSrc(): string | null {
  const candidates = [
    path.join(process.cwd(), "smartstart logo.jpg"),
    path.join(process.cwd(), "public", "smartstart-logo.jpg"),
    path.join(process.cwd(), "public", "smartstart logo.jpg"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const buf = fs.readFileSync(p);
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      } catch {}
    }
  }
  return null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 30,
    paddingHorizontal: 40,
    fontSize: 9,
    color: "#000000",
    fontFamily: "Helvetica",
    lineHeight: 1.25,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 14,
  },
  logo: {
    width: 240,
    height: 78,
    objectFit: "contain",
  },
  docTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: "#000000",
  },
  partiesBox: {
    marginBottom: 10,
    fontSize: 8.5,
    lineHeight: 1.3,
  },
  partyLabel: {
    fontFamily: "Helvetica",
    marginTop: 4,
    marginBottom: 2,
  },
  partyLine: {
    fontFamily: "Helvetica",
  },
  partyRole: {
    fontFamily: "Helvetica",
    color: "#333333",
    marginTop: 1,
    marginBottom: 4,
  },
  facilityLine: {
    fontFamily: "Helvetica",
    marginTop: 4,
    marginBottom: 6,
  },
  table: {
    width: "100%",
    borderStyle: "solid",
    borderWidth: 0.5,
    borderColor: "#000000",
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#D9D9D9",
    borderBottomWidth: 0.5,
    borderBottomColor: "#000000",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#000000",
    fontSize: 7.5,
    minHeight: 14,
  },
  col: {
    paddingVertical: 2.5,
    paddingHorizontal: 3,
    borderRightWidth: 0.5,
    borderRightColor: "#000000",
    justifyContent: "center",
  },
  colLast: {
    borderRightWidth: 0,
  },
  // Column widths matching the exact DOCX template proportions
  colName: { width: "11.1%", textAlign: "left" },
  colDob: { width: "11.9%", textAlign: "left" },
  colSv: { width: "13.5%", textAlign: "left" },
  colQual: { width: "13.3%", textAlign: "left" },
  colRate: { width: "9.3%", textAlign: "left" },
  colBegin: { width: "10.7%", textAlign: "left" },
  colEnd: { width: "10.5%", textAlign: "left" },
  colHours: { width: "9.6%", textAlign: "left" },
  colHuel: { width: "10.1%", textAlign: "left" },
  headerCol: {
    textAlign: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    bottom: 12,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#666666",
    borderTopWidth: 0.5,
    borderTopColor: "#cccccc",
    paddingTop: 4,
  },
});

export const KklPdfDocument = ({ data }: { data: KklReportData }) => {
  const logoSrc = getLogoSrc();

  // Pad data rows with empty lines if fewer than 25 to preserve table template look
  const totalTarget = Math.max(25, data.rows.length + 3);
  const emptyCount = totalTarget - data.rows.length;
  const emptyRows = Array.from({ length: emptyCount });

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Header Logo */}
        {logoSrc && (
          <View style={styles.logoContainer}>
            <Image src={logoSrc} style={styles.logo} />
          </View>
        )}

        {/* Title */}
        <Text style={styles.docTitle}>Anlage zum Arbeitnehmerüberlassungsvertrag</Text>

        {/* Contractual Parties */}
        <View style={styles.partiesBox}>
          <Text style={styles.partyLabel}>Zwischen</Text>
          <Text style={styles.partyLine}>{data.company.name || "Personaldienstleister"}</Text>
          <Text style={styles.partyLine}>{data.company.street || ""}</Text>
          <Text style={styles.partyLine}>{data.company.city || ""}</Text>
          <Text style={styles.partyRole}>(nachfolgend: Personaldienstleister)</Text>

          <Text style={styles.partyLabel}>und</Text>
          <Text style={styles.partyLine}>
            {data.client.companyAndAddress ||
              "Rheinische Gesellschaft für Diakonie gGmbH, Hasensprung 1, 42799 Leichlingen"}
          </Text>
          <Text style={styles.partyRole}>(nachfolgend: Kundenunternehmen)</Text>

          <Text style={styles.facilityLine}>Einrichtung: {data.client.facilityName}</Text>
        </View>

        {/* 9-Column Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, styles.colName, styles.headerCol]}>Name, Vorname</Text>
            <Text style={[styles.col, styles.colDob, styles.headerCol]}>Geburtsdatum</Text>
            <Text style={[styles.col, styles.colSv, styles.headerCol]}>SV-Nummer</Text>
            <Text style={[styles.col, styles.colQual, styles.headerCol]}>Tätigkeitsbereich</Text>
            <Text style={[styles.col, styles.colRate, styles.headerCol]}>VS netto</Text>
            <Text style={[styles.col, styles.colBegin, styles.headerCol]}>Beginn</Text>
            <Text style={[styles.col, styles.colEnd, styles.headerCol]}>Ende</Text>
            <Text style={[styles.col, styles.colHours, styles.headerCol]}>Stunden, Woche</Text>
            <Text style={[styles.col, styles.colHuel, styles.colLast, styles.headerCol]}>HÜL</Text>
          </View>

          {data.rows.map((r, i) => (
            <View key={`row-${i}`} style={styles.tableRow}>
              <Text style={[styles.col, styles.colName]}>{r.workerName}</Text>
              <Text style={[styles.col, styles.colDob]}>{r.birthDate || ""}</Text>
              <Text style={[styles.col, styles.colSv]}>{r.socialSecurityNumber || ""}</Text>
              <Text style={[styles.col, styles.colQual]}>{r.qualificationCode}</Text>
              <Text style={[styles.col, styles.colRate]}>{r.hourlyRateFormatted}</Text>
              <Text style={[styles.col, styles.colBegin]}>{r.startDateFormatted}</Text>
              <Text style={[styles.col, styles.colEnd]}>{r.endDateFormatted}</Text>
              <Text style={[styles.col, styles.colHours]}>{r.weeklyHoursFormatted}</Text>
              <Text style={[styles.col, styles.colHuel, styles.colLast]}>{r.shiftCodesFormatted || ""}</Text>
            </View>
          ))}

          {/* Empty rows padding */}
          {emptyRows.map((_, i) => (
            <View key={`empty-${i}`} style={styles.tableRow}>
              <Text style={[styles.col, styles.colName]}></Text>
              <Text style={[styles.col, styles.colDob]}></Text>
              <Text style={[styles.col, styles.colSv]}></Text>
              <Text style={[styles.col, styles.colQual]}></Text>
              <Text style={[styles.col, styles.colRate]}></Text>
              <Text style={[styles.col, styles.colBegin]}></Text>
              <Text style={[styles.col, styles.colEnd]}></Text>
              <Text style={[styles.col, styles.colHours]}></Text>
              <Text style={[styles.col, styles.colHuel, styles.colLast]}></Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>
            KKL-Liste: {data.client.facilityName} · {data.monthLabel}
          </Text>
          <Text>
            Erstellt am {data.generatedAt} · Seite{" "}
            <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export async function renderKklPdf(data: KklReportData): Promise<Buffer> {
  return await renderToBuffer(<KklPdfDocument data={data} />);
}
