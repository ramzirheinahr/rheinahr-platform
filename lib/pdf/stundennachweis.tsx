import "server-only";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import React from "react";
import path from "path";
import fs from "fs";
import type { CompanyConfig } from "@/lib/config/company";
import type { StundennachweisRow } from "@/lib/reports-data";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.4 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  logoContainer: { width: 220 },
  companyDetails: { fontSize: 8, color: "#374151", textAlign: "right" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "left", marginVertical: 12 },
  metaContainer: { marginBottom: 14, fontSize: 9 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 240, fontFamily: "Helvetica-Bold" },
  metaValue: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#9ca3af", paddingBottom: 1 },
  table: { width: "100%", borderStyle: "solid", borderWidth: 1.2, borderColor: "#111827", marginTop: 8 },
  tableHeader: { flexDirection: "row", backgroundColor: "#e5e7eb", fontFamily: "Helvetica-Bold", borderBottomWidth: 1.5, borderBottomColor: "#111827" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#374151" },
  tableRowSunday: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#374151", backgroundColor: "#fef08a" },
  col: { padding: 4, borderRightWidth: 0.8, borderRightColor: "#4b5563", justifyContent: "center" },
  colDate: { width: "13%", textAlign: "center" },
  colWorker: { width: "22%" },
  colArea: { width: "14%", textAlign: "center" },
  colTime: { width: "9%", textAlign: "center" },
  colHours: { width: "9%", textAlign: "right" },
  colNetHours: { width: "10%", textAlign: "right" },
  colStatus: { width: "14%", textAlign: "center", borderRightWidth: 0 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingVertical: 4 },
  totalRowWithNotice: { flexDirection: "column", alignItems: "stretch", marginTop: 10, paddingVertical: 4, gap: 6 },
  totalText: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#111827" },
  disclaimer: { fontSize: 8, color: "#991b1b", fontFamily: "Helvetica-Bold" },
});

export type StundennachweisPdfProps = {
  companyConfig: CompanyConfig;
  client: { facilityName?: string; contactPerson?: string | null; address?: string | null } | null;
  startDate: string;
  endDate: string;
  qualificationLabel: string;
  rows: StundennachweisRow[];
  mode?: "actual" | "planned";
};

export const StundennachweisTemplate = ({
  companyConfig,
  client,
  startDate,
  endDate,
  qualificationLabel,
  rows,
  mode = "actual",
}: StundennachweisPdfProps) => {
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

  const totalActualHours = Math.round(
    rows
      .filter((r) => !r.isPlanned && r.statusType !== "scheduled")
      .reduce((sum, r) => sum + (r.hoursWithoutPause || 0), 0) * 100
  ) / 100;

  const totalPlannedHours = Math.round(
    rows
      .filter((r) => r.isPlanned || r.statusType === "scheduled")
      .reduce((sum, r) => sum + (r.hoursWithoutPause || 0), 0) * 100
  ) / 100;

  const hasPlannedShifts = rows.some((r) => r.isPlanned || r.statusType === "scheduled");

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
            <Text style={{ fontSize: 7, color: "#1e3a8a", marginTop: 4, fontFamily: "Helvetica-Bold" }}>
              INTEGRITÄT    WÜRDE    KOMPETENZ    VERTRAUEN
            </Text>
          </View>
          <View style={styles.companyDetails}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{companyConfig?.name || "RheinAhr Dienstleistungen GmbH"}</Text>
            <Text>{companyConfig?.street || "Theaterplatz 1"}</Text>
            <Text>{companyConfig?.city || "53177 Bonn"}</Text>
            <Text>Telefon: {companyConfig?.phone || "+49 (0) 228 / 28683821"}</Text>
            <Text>Telefax: {companyConfig?.fax || "+49 (0) 228 / 36039105"}</Text>
            <Text>E-Mail: {companyConfig?.email || "info@rheinahr-gmbh.de"}</Text>
            <Text>Internet: {companyConfig?.website || "www.rheinahr-gmbh.de"}</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>Stundennachweis</Text>

        {/* Metadata */}
        <View style={styles.metaContainer}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Name des Mitarbeiters / Auftragnehmers :</Text>
            <Text style={styles.metaValue}>{companyConfig?.name || "RheinAhr Dienstleistungen GmbH"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Qualifikation :</Text>
            <Text style={styles.metaValue}>{qualificationLabel || "Pflegehilfskraft"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Auftraggeber :</Text>
            <Text style={styles.metaValue}>{client?.contactPerson || client?.facilityName || "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Firma :</Text>
            <Text style={styles.metaValue}>{client?.facilityName || "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Adresse :</Text>
            <Text style={styles.metaValue}>{client?.address || "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Datum :</Text>
            <Text style={styles.metaValue}>
              von {formatD(startDate)} bis {formatD(endDate)}
            </Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, styles.colDate]}>Datum</Text>
            <Text style={[styles.col, styles.colWorker]}>Mitarbeiter</Text>
            <Text style={[styles.col, styles.colArea]}>Wohnbereich</Text>
            <Text style={[styles.col, styles.colTime]}>von</Text>
            <Text style={[styles.col, styles.colTime]}>bis</Text>
            <Text style={[styles.col, styles.colHours]}>Stunden</Text>
            <Text style={[styles.col, styles.colNetHours]}>Stunden Ohne Pause</Text>
            <Text style={[styles.col, styles.colStatus]}>Status</Text>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} wrap={false} style={r.isSunday ? styles.tableRowSunday : styles.tableRow}>
              <Text style={[styles.col, styles.colDate]}>{r.shiftDate}</Text>
              <Text style={[styles.col, styles.colWorker]}>{r.workerName}</Text>
              <Text style={[styles.col, styles.colArea]}>{r.livingArea || "-----"}</Text>
              <Text style={[styles.col, styles.colTime]}>{r.startTime}</Text>
              <Text style={[styles.col, styles.colTime]}>{r.endTime}</Text>
              <Text style={[styles.col, styles.colHours]}>
                {r.hours.toFixed(2).replace(".", ",")}
              </Text>
              <Text style={[styles.col, styles.colNetHours]}>
                {r.hoursWithoutPause.toFixed(2).replace(".", ",")}
              </Text>
              <Text style={[styles.col, styles.colStatus]}>
                {r.statusLabel || (r.isPlanned ? "Geplant" : "Bestätigt")}
              </Text>
            </View>
          ))}
        </View>

        {/* Total Sum & Disclaimer */}
        <View wrap={false} style={mode === "actual" && hasPlannedShifts ? styles.totalRowWithNotice : styles.totalRow}>
          {mode === "planned" ? (
            <>
              <Text style={{ fontSize: 8, color: "#6b7280" }}>
                Planungsübersicht (Soll-Stunden).
              </Text>
              <Text style={styles.totalText}>
                Gesamtsumme (Geplant): {totalPlannedHours.toFixed(2).replace(".", ",")} Stunden
              </Text>
            </>
          ) : hasPlannedShifts ? (
            <>
              <Text style={styles.disclaimer}>
                * Hinweis: Enthält ungeprüfte / geplante Schichten. Diese stellen keine freigegebenen Ist-Stunden dar.
              </Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.totalText}>
                  Ist-Stunden (bestätigt/freigegeben): {totalActualHours.toFixed(2).replace(".", ",")} Stunden
                </Text>
                <Text style={{ fontSize: 9, fontFamily: "Helvetica", color: "#6b7280", marginTop: 2 }}>
                  Ungeprüft / Geplant: {totalPlannedHours.toFixed(2).replace(".", ",")} Stunden
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 8, color: "#6b7280" }}>
                Alle enthaltenen Schichten sind bestätigt bzw. freigegeben.
              </Text>
              <Text style={styles.totalText}>
                Gesamtsumme: {totalActualHours.toFixed(2).replace(".", ",")} Stunden
              </Text>
            </>
          )}
        </View>
      </Page>
    </Document>
  );
};
