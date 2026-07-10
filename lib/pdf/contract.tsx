import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";

export type ContractPdfData = {
  facilityName: string;
  facilityAddress: string;
  period: string;
  status: string;
  assignments: Array<{
    workerName: string;
    qualification: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    socialSecurity: string;
    hourlyRate?: number;
    totalAmount?: number;
  }>;
  signatureData?: string | null;
  signedAt?: string;
  ipAddress?: string | null;
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 24, textAlign: "center" },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 8 },
  paragraph: { marginBottom: 8, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 120, fontFamily: "Helvetica-Bold" },
  value: { flex: 1 },
  shiftBox: { padding: 8, borderWidth: 1, borderColor: "#e5e7eb", marginBottom: 8, borderRadius: 4 },
  signatureBox: { marginTop: 40, borderTopWidth: 1, borderTopColor: "#9ca3af", paddingTop: 8, width: 250 },
  signatureImg: { height: 60, objectFit: "contain", marginBottom: 8 },
  audit: { fontSize: 8, color: "#9ca3af", marginTop: 4 },
});

const AuegContractTemplate = ({ data }: { data: ContractPdfData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Arbeitnehmerüberlassungsvertrag</Text>
      
      <View style={{ marginBottom: 16 }}>
        <Text style={styles.paragraph}>Zwischen</Text>
        <Text style={[styles.paragraph, styles.bold]}>{data.facilityName}</Text>
        <Text style={styles.paragraph}>{data.facilityAddress}</Text>
        <Text style={styles.paragraph}>(Auftraggeber)</Text>
        <Text style={styles.paragraph}>und</Text>
        <Text style={[styles.paragraph, styles.bold]}>RheinAhr Dienstleistungen GmbH</Text>
        <Text style={styles.paragraph}>Theaterplatz 1, 53177 Bonn</Text>
        <Text style={styles.paragraph}>(Personaldienstleister)</Text>
        <Text style={styles.paragraph}>wird folgender Arbeitnehmerüberlassungsvertrag geschlossen:</Text>
      </View>

      <Text style={styles.h2}>§ 1 Erlaubnis zur Arbeitnehmerüberlassung</Text>
      <Text style={styles.paragraph}>
        Der Personaldienstleister erklärt, im Besitz einer befristeten Erlaubnis zur Arbeitnehmerüberlassung zu sein.
      </Text>

      <Text style={styles.h2}>§ 2 Inkrafttreten / Gegenstand</Text>
      <Text style={styles.paragraph}>
        Der Personaldienstleister verpflichtet sich, dem Betrieb des Auftraggebers Arbeitnehmer zur Arbeitsleistung zu überlassen.
      </Text>

      <Text style={styles.h2}>§ 5 Überlassungsbedingungen / Konkretisierung</Text>
      <Text style={styles.paragraph}>
        Der Personaldienstleister verpflichtet sich, folgende Arbeitnehmer für den Zeitraum {data.period || "angegeben"} zu überlassen:
      </Text>

      {data.assignments.map((a, i) => (
        <View key={i} style={styles.shiftBox}>
          <View style={styles.row}>
            <Text style={styles.label}>Tätigkeit/Qualifikation:</Text>
            <Text style={styles.value}>{a.qualification}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Mitarbeiter:</Text>
            <Text style={styles.value}>{a.workerName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>SV-Nummer:</Text>
            <Text style={styles.value}>{a.socialSecurity || "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Einsatzdatum:</Text>
            <Text style={styles.value}>{a.shiftDate} ({a.startTime} - {a.endTime})</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Vergütung pro Stunde:</Text>
            <Text style={styles.value}>{a.hourlyRate?.toFixed(2).replace(".", ",")} € (Basis, zzgl. USt. & Zuschläge)</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Voraussichtlicher Betrag:</Text>
            <Text style={styles.value}>{a.totalAmount?.toFixed(2).replace(".", ",")} € (Netto, inkl. Zuschläge)</Text>
          </View>
        </View>
      ))}

      <Text style={styles.h2}>§ 14 Schriftform / Vertretung</Text>
      <Text style={styles.paragraph}>
        Gemäß § 12 Absatz 1 Satz 1 AÜG bedarf dieser Vertrag der Schriftform. Anstelle der Schriftform darf auch die elektronische Form verwandt werden.
      </Text>

      <View style={{ marginTop: 60, gap: 32 }}>
        {data.signedAt ? (
          <>
            <View>
              <Text style={{ fontFamily: "Helvetica", fontSize: 12 }}>
                Signiert von {data.facilityName} (Entleiher),
              </Text>
              <Text style={{ fontFamily: "Helvetica", fontSize: 12 }}>
                am {data.signedAt}
              </Text>
            </View>
            <View>
              <Text style={{ fontFamily: "Helvetica", fontSize: 12 }}>
                Signiert von RheinAhr Dienstleistungen GmbH (Verleiher),
              </Text>
              <Text style={{ fontFamily: "Helvetica", fontSize: 12 }}>
                am {data.signedAt}
              </Text>
            </View>
          </>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={styles.signatureBox}>
              <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 20 }}>Personaldienstleister</Text>
              <Text>RheinAhr Dienstleistungen GmbH</Text>
            </View>
            
            <View style={styles.signatureBox}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Auftraggeber</Text>
              <View style={{ height: 60 }} />
              <Text>{data.facilityName}</Text>
            </View>
          </View>
        )}
      </View>
    </Page>
  </Document>
);

export async function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  return Buffer.from(await renderToBuffer(<AuegContractTemplate data={data} />));
}
