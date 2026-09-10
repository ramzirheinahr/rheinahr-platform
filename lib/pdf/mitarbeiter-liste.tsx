import "server-only";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import React from "react";
import path from "path";
import fs from "fs";
import type { CompanyConfig } from "@/lib/config/company";
import type { MitarbeiterListeRow } from "@/lib/reports-data";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 8.5, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.4 },
  header: { alignItems: "center", marginBottom: 12 },
  logoContainer: { width: 220, marginBottom: 4 },
  slogan: { fontSize: 8, color: "#1e3a8a", fontFamily: "Helvetica-Bold" },
  titleContainer: { textAlign: "center", marginVertical: 12 },
  facilityTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 4, textAlign: "center" },
  periodSubtitle: { fontSize: 11, color: "#374151", textAlign: "center" },
  table: { width: "100%", borderStyle: "solid", borderWidth: 1, borderColor: "#000", marginTop: 8 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f3f4f6", fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#9ca3af" },
  col: { padding: 4, borderRightWidth: 0.5, borderRightColor: "#9ca3af", justifyContent: "center" },
  colNr: { width: "10%", textAlign: "center" },
  colName: { width: "13%" },
  colBirth: { width: "12%", textAlign: "center" },
  colGender: { width: "10%", textAlign: "center" },
  colAddress: { width: "30%" },
  colContact: { width: "25%", borderRightWidth: 0 },
});

export type MitarbeiterListePdfProps = {
  companyConfig: CompanyConfig;
  clientName: string;
  startDate: string;
  endDate: string;
  rows: MitarbeiterListeRow[];
};

export const MitarbeiterListeTemplate = ({
  companyConfig,
  clientName,
  startDate,
  endDate,
  rows,
}: MitarbeiterListePdfProps) => {
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

  const formatD = (dStr: string) => {
    if (!dStr) return "";
    const [y, m, d] = dStr.split("-");
    return `${d}.${m}.${y}`;
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
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

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.facilityTitle}>{clientName}</Text>
          <Text style={styles.periodSubtitle}>
            Vom {formatD(startDate)} bis {formatD(endDate)}
          </Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, styles.colNr]}>Personal-Nr.</Text>
            <Text style={[styles.col, styles.colName]}>Vorname</Text>
            <Text style={[styles.col, styles.colName]}>Nachname</Text>
            <Text style={[styles.col, styles.colBirth]}>Geburtsdatum</Text>
            <Text style={[styles.col, styles.colGender]}>Geschlecht</Text>
            <Text style={[styles.col, styles.colAddress]}>Adresse</Text>
            <Text style={[styles.col, styles.colContact]}>Telefon / E-Mail</Text>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.col, styles.colNr]}>{r.internalNumber}</Text>
              <Text style={[styles.col, styles.colName]}>{r.firstName}</Text>
              <Text style={[styles.col, styles.colName]}>{r.lastName}</Text>
              <Text style={[styles.col, styles.colBirth]}>{r.birthDate}</Text>
              <Text style={[styles.col, styles.colGender]}>{r.gender}</Text>
              <Text style={[styles.col, styles.colAddress]}>{r.address}</Text>
              <View style={[styles.col, styles.colContact]}>
                <Text>{r.phone}</Text>
                {r.email && r.email !== "—" && (
                  <Text style={{ fontSize: 7, color: "#4b5563" }}>{r.email}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
};
