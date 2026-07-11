import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
  Image,
} from "@react-pdf/renderer";
import React from "react";
import path from "path";

export type PayrollPdfData = {
  documentTitle: string;
  date: string;
  workerId: string;
  workerName: string;
  workerAddress: string;
  period: string;
  items: Array<{
    pos: number;
    description: string;
    hours: string;
    rate: string;
    amount: string;
  }>;
  total: string;
};

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 80, fontSize: 10, color: "#000000", fontFamily: "Helvetica", lineHeight: 1.3 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 30 },
  logoContainer: { flexDirection: "row", alignItems: "flex-end" },
  brandTextContainer: { marginLeft: 10 },
  brandTextMain: { color: "#1d4ed8", fontSize: 24, fontFamily: "Helvetica" },
  brandTextSub: { color: "#d91e18", fontSize: 14, fontFamily: "Helvetica" },
  
  senderBlock: { width: "40%", marginTop: 20 },
  companyContactBlock: { width: "40%", textAlign: "right" },
  companyNameBold: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  
  returnAddress: { fontSize: 8, textDecoration: "underline", marginBottom: 10 },
  
  workerAddress: { marginTop: 10 },
  
  titleBlock: { marginTop: -20, textAlign: "right", width: "100%" },
  titleText: { fontSize: 28, fontFamily: "Helvetica-Bold", marginBottom: 15 },
  
  metaTable: { alignSelf: "flex-end", width: "40%" },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  metaLabel: { fontFamily: "Helvetica" },
  metaValue: { fontFamily: "Helvetica" },

  greeting: { marginTop: 40, marginBottom: 20 },
  
  tableHeader: { flexDirection: "row", backgroundColor: "#f3f4f6", borderBottom: "1pt solid #d1d5db", padding: "6 4", fontFamily: "Helvetica-Bold" },
  tableRow: { flexDirection: "row", borderBottom: "1pt solid #e5e7eb", padding: "6 4" },
  
  colPos: { width: "5%" },
  colDesc: { width: "50%" },
  colHours: { width: "15%", textAlign: "right" },
  colRate: { width: "15%", textAlign: "right" },
  colAmount: { width: "15%", textAlign: "right" },

  totalsSection: { marginTop: 20, width: "100%", alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", width: "40%", justifyContent: "space-between", marginBottom: 4 },
  totalsLabel: { fontFamily: "Helvetica" },
  totalsValue: { fontFamily: "Helvetica" },
  totalFinalRow: { flexDirection: "row", width: "40%", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1pt solid #000" },
  totalFinalLabel: { fontFamily: "Helvetica-Bold" },
  totalFinalValue: { fontFamily: "Helvetica-Bold" },

  footer: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#6b7280",
    borderTop: "1pt solid #e5e7eb",
    paddingTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerCol: { width: "30%" },
  footerTitle: { fontFamily: "Helvetica-Bold", marginBottom: 3 },
});

export async function generatePayrollPdf(data: PayrollPdfData): Promise<Buffer> {
  // same layout as invoice roughly
  const element = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.brandTextContainer}>
              <Text style={styles.brandTextMain}>RheinAhr</Text>
              <Text style={styles.brandTextSub}>Dienstleistungen</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={styles.senderBlock}>
            <Text style={styles.returnAddress}>
              RheinAhr Dienstleistungen GmbH • Musterstraße 1 • 53474 Bad Neuenahr-Ahrweiler
            </Text>
            <View style={styles.workerAddress}>
              <Text>{data.workerName}</Text>
              {(data.workerAddress || "").split("\n").map((line, i) => (
                <Text key={i}>{line}</Text>
              ))}
            </View>
          </View>
          <View style={styles.companyContactBlock}>
            <Text style={styles.companyNameBold}>RheinAhr Dienstleistungen GmbH</Text>
            <Text>Musterstraße 1</Text>
            <Text>53474 Bad Neuenahr-Ahrweiler</Text>
            <Text style={{ marginTop: 10 }}>Telefon: 02641 / 123456</Text>
            <Text>E-Mail: info@rheinahr.de</Text>
          </View>
        </View>

        <View style={{ marginTop: 40 }}>
          <Text style={styles.titleText}>{data.documentTitle}</Text>
          
          <View style={styles.metaTable}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Datum:</Text>
              <Text style={styles.metaValue}>{data.date}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Zeitraum:</Text>
              <Text style={styles.metaValue}>{data.period}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Mitarbeiter-Nr.:</Text>
              <Text style={styles.metaValue}>{data.workerId.slice(0, 8)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.greeting}>
          <Text>Hallo {data.workerName},</Text>
          <Text style={{ marginTop: 10 }}>
            hiermit erhalten Sie eine Übersicht Ihrer geleisteten Stunden und der zugehörigen Abrechnungsdaten für den Zeitraum {data.period}.
          </Text>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colPos}>Pos</Text>
          <Text style={styles.colDesc}>Beschreibung</Text>
          <Text style={styles.colHours}>Menge / Std.</Text>
          <Text style={styles.colRate}>Satz</Text>
          <Text style={styles.colAmount}>Betrag</Text>
        </View>

        {data.items.map((item, i) => (
          <View style={styles.tableRow} key={i} wrap={false}>
            <Text style={styles.colPos}>{item.pos}</Text>
            <Text style={styles.colDesc}>{item.description}</Text>
            <Text style={styles.colHours}>{item.hours}</Text>
            <Text style={styles.colRate}>{item.rate}</Text>
            <Text style={styles.colAmount}>{item.amount}</Text>
          </View>
        ))}

        <View style={styles.totalsSection} wrap={false}>
          <View style={styles.totalFinalRow}>
            <Text style={styles.totalFinalLabel}>Gesamt (Netto)</Text>
            <Text style={styles.totalFinalValue}>{data.total}</Text>
          </View>
          <Text style={{ marginTop: 10, fontSize: 8, color: "#6b7280" }}>
            * Diese Übersicht dient internen Zwecken und der Vorbereitung der Gehaltsabrechnung.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerCol}>
            <Text style={styles.footerTitle}>RheinAhr Dienstleistungen GmbH</Text>
            <Text>Musterstraße 1</Text>
            <Text>53474 Bad Neuenahr-Ahrweiler</Text>
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footerTitle}>Kontakt</Text>
            <Text>Telefon: 02641 / 123456</Text>
            <Text>E-Mail: info@rheinahr.de</Text>
            <Text>Web: www.rheinahr.de</Text>
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footerTitle}>Bankverbindung</Text>
            <Text>Bank: Musterbank eG</Text>
            <Text>IBAN: DE12 3456 7890 1234 5678 90</Text>
            <Text>BIC: MUSBDEF1XXX</Text>
          </View>
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(element);
}
