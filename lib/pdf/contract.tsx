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
import { companyConfig } from "@/lib/config/company";

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
    birthDate?: string;
    nationality?: string;
    hourlyRate?: number;
    totalAmount?: number;
  }>;
  stampDataUrl?: string;
  signatureData?: string | null;
  signedAt?: string;
  ipAddress?: string | null;
  splitByShift?: boolean;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.3 },
  header: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 12, textAlign: "center" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  paragraph: { marginBottom: 4, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 110, fontFamily: "Helvetica-Bold" },
  value: { flex: 1 },
  shiftBox: { padding: 6, borderWidth: 1, borderColor: "#e5e7eb", marginBottom: 4, borderRadius: 4 },
  signatureCol: { width: 220 },
  signatureLine: { borderTopWidth: 1, borderTopColor: "#9ca3af", paddingTop: 4 },
  signatureImg: { height: 50, objectFit: "contain", marginBottom: 4 },
  audit: { fontSize: 7, color: "#9ca3af", marginTop: 2 },
});

const ContractPage = ({ data }: { data: ContractPdfData }) => (
  <Page size="A4" style={styles.page}>
    <Text style={styles.header}>Arbeitnehmerüberlassungsvertrag</Text>
    
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.paragraph}>Zwischen</Text>
      <Text style={[styles.paragraph, styles.bold]}>{data.facilityName}</Text>
      {(data.facilityAddress || "").split("\n").map((line, i) => (
        <Text key={i} style={styles.paragraph}>{line}</Text>
      ))}
      <Text style={styles.paragraph}>(Auftraggeber)</Text>
      <Text style={styles.paragraph}>und</Text>
      <Text style={[styles.paragraph, styles.bold]}>{companyConfig.name}</Text>
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
          <Text style={styles.label}>Nationalität:</Text>
          <Text style={styles.value}>{a.nationality || "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Geburtsdatum:</Text>
          <Text style={styles.value}>{a.birthDate || "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Einsatzdatum:</Text>
          <Text style={styles.value}>{a.shiftDate} ({a.startTime} - {a.endTime})</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Vergütung pro Stunde:</Text>
          <Text style={styles.value}>{a.hourlyRate?.toFixed(2).replace(".", ",")} € (Basis, zzgl. USt. & Zuschläge)</Text>
        </View>

      </View>
    ))}

    <Text style={styles.h2}>§ 14 Schriftform / Vertretung</Text>
    <Text style={styles.paragraph}>
      Gemäß § 12 Absatz 1 Satz 1 AÜG bedarf dieser Vertrag der Schriftform. Anstelle der Schriftform darf auch die elektronische Form verwandt werden.
    </Text>

    <View style={{ marginTop: 16, gap: 16 }}>
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
              Signiert von {companyConfig.name} (Verleiher),
            </Text>
            <Text style={{ fontFamily: "Helvetica", fontSize: 12 }}>
              am {data.signedAt}
            </Text>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={styles.signatureCol}>
            {data.stampDataUrl ? (
              <Image src={data.stampDataUrl} style={{ width: 120, height: 40, objectFit: "contain", marginBottom: 4 }} />
            ) : (
              <View style={{ height: 44 }} />
            )}
            <View style={styles.signatureLine}>
              <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>Personaldienstleister</Text>
              <Text>{companyConfig.name}</Text>
            </View>
          </View>
          
          <View style={styles.signatureCol}>
            <View style={{ height: 44 }} />
            <View style={styles.signatureLine}>
              <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>Auftraggeber</Text>
              <Text>{data.facilityName}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  </Page>
);

const AuegContractTemplate = ({ data }: { data: ContractPdfData }) => (
  <Document>
    {data.splitByShift ? (
      data.assignments.map((a, i) => (
        <ContractPage key={i} data={{ ...data, assignments: [a], period: a.shiftDate }} />
      ))
    ) : (
      <ContractPage data={data} />
    )}
  </Document>
);

export async function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  return Buffer.from(await renderToBuffer(<AuegContractTemplate data={data} />));
}
