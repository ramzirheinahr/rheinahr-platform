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

export type InvoicePdfData = {
  invoiceNumber: string;
  date: string;
  clientId: string; // or shortCode
  clientName: string;
  clientAddress: string;
  periodStart: string;
  periodEnd: string;
  items: Array<{
    pos: number;
    description: string;
    hours: string;
    rate: string;
    amount: string;
  }>;
  subtotal: string;
  taxAmount: string;
  total: string;
};

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 80, fontSize: 10, color: "#000000", fontFamily: "Helvetica", lineHeight: 1.3 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 30 },
  logoContainer: { flexDirection: "row", alignItems: "flex-end" },
  brandTextContainer: { marginLeft: 10 },
  brandTextMain: { color: "#1d4ed8", fontSize: 24, fontFamily: "Helvetica" },
  brandTextSub: { color: "#d91e18", fontSize: 14, fontFamily: "Helvetica" },
  sloganRow: { flexDirection: "row", marginTop: 8, gap: 10 },
  sloganRed: { color: "#d91e18", fontSize: 10, fontFamily: "Helvetica-Bold" },
  sloganBlue: { color: "#1d4ed8", fontSize: 10, fontFamily: "Helvetica-Bold" },
  
  senderBlock: { width: "40%", marginTop: 20 },
  companyContactBlock: { width: "40%", textAlign: "right" },
  companyNameBold: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  
  returnAddress: { fontSize: 8, textDecoration: "underline", marginBottom: 10 },
  
  clientAddress: { marginTop: 10 },
  
  titleBlock: { marginTop: -20, textAlign: "right", width: "100%" },
  titleText: { fontSize: 28, fontFamily: "Helvetica-Bold", marginBottom: 15 },
  
  metaTable: { alignSelf: "flex-end", width: "40%" },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  metaLabel: { fontFamily: "Helvetica" },
  metaValue: { fontFamily: "Helvetica" },

  greeting: { fontFamily: "Helvetica-Bold", marginTop: 20, marginBottom: 5 },
  
  table: { width: "100%", borderWidth: 1, borderColor: "#000", marginTop: 5 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000", minHeight: 20, alignItems: "center" },
  tableHeader: { fontFamily: "Helvetica-Bold", backgroundColor: "#f3f4f6" },
  colPos: { width: "8%", textAlign: "center", borderRightWidth: 1, borderColor: "#000", padding: 2 },
  colDesc: { width: "57%", padding: 2, paddingLeft: 4, borderRightWidth: 1, borderColor: "#000", textAlign: "center" },
  colHours: { width: "12%", textAlign: "center", borderRightWidth: 1, borderColor: "#000", padding: 2 },
  colRate: { width: "11%", textAlign: "center", borderRightWidth: 1, borderColor: "#000", padding: 2 },
  colAmount: { width: "12%", textAlign: "center", padding: 2 },
  
  subtotalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, marginBottom: 20 },
  subtotalLabel: { fontFamily: "Helvetica-Bold", textDecoration: "underline", marginRight: 20 },
  subtotalValue: { fontFamily: "Helvetica", textDecoration: "underline", width: "12%", textAlign: "center" },

  taxTable: { width: "100%", borderWidth: 1, borderColor: "#c0c0c0", marginTop: 10 },
  taxRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#c0c0c0", minHeight: 20, alignItems: "center" },
  taxHeader: { fontFamily: "Helvetica-Bold", backgroundColor: "#f9fafb" },
  tCol1: { width: "25%", textAlign: "center", borderRightWidth: 1, borderColor: "#c0c0c0", padding: 4 },
  tCol2: { width: "25%", textAlign: "center", borderRightWidth: 1, borderColor: "#c0c0c0", padding: 4 },
  tCol3: { width: "25%", textAlign: "center", borderRightWidth: 1, borderColor: "#c0c0c0", padding: 4 },
  tCol4: { width: "25%", textAlign: "center", padding: 4 },
  tBold: { fontFamily: "Helvetica-Bold" },

  paymentText: { marginTop: 15, fontSize: 10, fontFamily: "Helvetica" },
  
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: "#6b7280" },
  footerCol: { width: "30%" },
  footerBoldPrimary: { color: "#1d4ed8", fontFamily: "Helvetica-Bold", marginBottom: 2 },
  footerBoldGray: { color: "#4b5563", fontFamily: "Helvetica-Bold", marginBottom: 2 },
  footerText: { marginBottom: 2 },
});

const InvoiceTemplate = ({ data }: { data: InvoicePdfData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      
      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.logoContainer}>
            <Image src={path.join(process.cwd(), "public", "logo.png")} style={{ width: 140, objectFit: "contain" }} />
          </View>
          <View style={styles.sloganRow}>
            <Text style={styles.sloganRed}>INTEGRITÄT</Text>
            <Text style={styles.sloganBlue}>WÜRDE</Text>
            <Text style={styles.sloganRed}>KOMPETENZ</Text>
            <Text style={styles.sloganBlue}>VERTRAUEN</Text>
          </View>
        </View>

        <View style={styles.companyContactBlock}>
          <Text style={styles.companyNameBold}>RheinAhr Dienstleistungen GmbH</Text>
          <Text>Theaterplatz 1</Text>
          <Text>53177 Bonn</Text>
          <Text>Telefon: +49 (0) 228 / 28683821</Text>
          <Text>Telefax: +49 (0) 228 / 36039105</Text>
          <Text>Mobile: +49 (0) 152 / 33646562</Text>
          <Text>E-Mail: info@rheinahr-gmbh.de</Text>
          <Text>Internet: www.rheinahr-gmbh.de</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row" }}>
        <View style={styles.senderBlock}>
          <Text style={styles.returnAddress}>RheinAhr Dienstleistungen GmbH , Theaterplatz 1 , 53177 Bonn</Text>
          <View style={styles.clientAddress}>
            <Text>{data.clientName}</Text>
            {data.clientAddress.split('\n').map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.titleText}>Rechnung</Text>
          <View style={styles.metaTable}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>vom:</Text>
              <Text style={styles.metaValue}>{data.date}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Nummer:</Text>
              <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Kunde:</Text>
              <Text style={styles.metaValue}>{data.clientId}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Seite:</Text>
              <Text style={styles.metaValue}>1/1</Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.greeting}>Wir berechnen Ihnen</Text>

      {/* Main Table */}
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={styles.colPos}>Pos</Text>
          <Text style={styles.colDesc}>Bezeichnung</Text>
          <Text style={styles.colHours}>Stunden</Text>
          <Text style={styles.colRate}>Preis/Std</Text>
          <Text style={styles.colAmount}>Betrag €</Text>
        </View>
        {data.items.map((item, i) => (
          <View style={styles.tableRow} key={i}>
            <Text style={styles.colPos}>{item.pos}</Text>
            <Text style={styles.colDesc}>{item.description}</Text>
            <Text style={styles.colHours}>{item.hours}</Text>
            <Text style={styles.colRate}>{item.rate} €</Text>
            <Text style={styles.colAmount}>{item.amount} €</Text>
          </View>
        ))}
      </View>

      <View style={styles.subtotalRow}>
        <Text style={styles.subtotalLabel}>Zwischensumme :</Text>
        <Text style={styles.subtotalValue}>{data.subtotal} €</Text>
      </View>

      {/* Tax Table */}
      <View style={styles.taxTable}>
        <View style={[styles.taxRow, styles.taxHeader]}>
          <Text style={styles.tCol1}>Netto €</Text>
          <Text style={styles.tCol2}>MWS-1   %</Text>
          <Text style={styles.tCol3}>MwSt.</Text>
          <Text style={styles.tCol4}>Endbetrag €</Text>
        </View>
        <View style={styles.taxRow}>
          <Text style={[styles.tCol1, styles.tBold]}>{data.subtotal}</Text>
          <Text style={[styles.tCol2, styles.tBold]}>19 %</Text>
          <Text style={[styles.tCol3, styles.tBold]}>{data.taxAmount}</Text>
          <Text style={[styles.tCol4, styles.tBold]}>{data.total}</Text>
        </View>
      </View>

      <Text style={styles.paymentText}>
        Bitte überweisen Sie den Endbetrag innerhalb 14 Tagen und geben dabei unbedingt die Rechnungsnummer
        Als Verwendungszweck an.
      </Text>

      {/* Footer */}
      <View style={styles.footer} fixed>
        <View style={styles.footerCol}>
          <Text style={styles.footerBoldPrimary}>RheinAhr Dienstleistungen GmbH</Text>
          <Text style={styles.footerText}>Theaterplatz 1</Text>
          <Text style={styles.footerText}>53177 Bonn</Text>
          <Text style={styles.footerText}>Telefon: +49 (0) 228 / 28683821</Text>
          <Text style={styles.footerText}>Telefax: +49 (0) 228 / 36039105</Text>
          <Text style={styles.footerText}>Mobile: +49 (0) 152 / 33 64 65 62</Text>
        </View>
        <View style={styles.footerCol}>
          <Text style={styles.footerBoldGray}>Postbank</Text>
          <Text style={styles.footerText}>IBAN: DE62440100460387966464</Text>
          <Text style={styles.footerText}>BIC: PBNKDEFF</Text>
          <Text style={{ marginTop: 10, marginBottom: 2 }}>E-Mail: info@rheinahr-gmbh.de</Text>
          <Text style={styles.footerText}>Internet: www.rheinahr-gmbh.de</Text>
        </View>
        <View style={styles.footerCol}>
          <Text style={styles.footerBoldGray}>Amtsgericht Bonn</Text>
          <Text style={styles.footerText}>HRB 23459</Text>
          <Text style={styles.footerText}>Steuernummer : 206/5946/0589</Text>
          <Text style={styles.footerText}>Ust-IdNr : DE316507908</Text>
          <Text style={styles.footerText}>Geschäftsführer : Basem Aldanaf</Text>
        </View>
      </View>
    </Page>
  </Document>
);

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return await renderToBuffer(<InvoiceTemplate data={data} />);
}
