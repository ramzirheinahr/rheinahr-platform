import "server-only";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { format } from "date-fns";

export type ArbeitsvertragData = {
  fullName: string;
  address: string;
  contractType: "unbefristet" | "befristet" | "minijob" | string;
  startDate: Date | null;
  endDate: Date | null;
  qualification: string;
  requiredHours: number;
  hourlyRate: number;
  createdAt: Date;
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 24, textAlign: "center" },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 8 },
  paragraph: { marginBottom: 12, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  list: { marginLeft: 16, marginBottom: 12 },
  listItem: { marginBottom: 4 },
  signatureContainer: { flexDirection: "row", justifyContent: "space-between", marginTop: 60 },
  signatureBox: { borderTopWidth: 1, borderTopColor: "#9ca3af", paddingTop: 8, width: 200, fontSize: 10 },
  checkbox: { width: 10, height: 10, borderWidth: 1, borderColor: "#000", marginRight: 4 },
  checkboxChecked: { backgroundColor: "#000" }
});

const formatRate = (num: number) => num.toFixed(2).replace(".", ",");
const getQualificationText = (q: string) => {
  const map: Record<string, string> = {
    pflegefachkraft: "Pflegefachkraft",
    pflegehelfer: "Pflegehelfer/in",
    betreuungskraft: "Betreuungskraft / Pflegehilfskraft",
    pflegedienstleitung: "Pflegedienstleitung",
  };
  return map[q] || q;
};

export const ArbeitsvertragTemplate = ({ data }: { data: ArbeitsvertragData }) => {
  const monthlySalary = (data.hourlyRate * data.requiredHours).toFixed(2).replace(".", ",");
  const hourlyStr = data.hourlyRate.toFixed(2).replace(".", ",");
  
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>Arbeitsvertrag</Text>
        
        <View style={{ marginBottom: 24 }}>
          <Text style={styles.paragraph}>Zwischen</Text>
          <Text style={[styles.paragraph, styles.bold]}>RheinAhr Dienstleistungen GmbH</Text>
          <Text style={styles.paragraph}>Theaterplatz 1, 53177 Bonn</Text>
          <Text style={styles.paragraph}>- nachstehend Arbeitgeber genannt -</Text>
          
          <Text style={styles.paragraph}>und</Text>
          
          <Text style={[styles.paragraph, styles.bold]}>{data.fullName}</Text>
          <Text style={styles.paragraph}>{data.address || "Adresse unbekannt"}</Text>
          <Text style={styles.paragraph}>- nachstehend Mitarbeiter genannt -</Text>
          
          <Text style={styles.paragraph}>wird folgender Arbeitsvertrag geschlossen.</Text>
        </View>

        <Text style={styles.h2}>§ 1 Inhalt / Einbeziehung der Tarifverträge</Text>
        <Text style={styles.paragraph}>
          (1) Der Arbeitgeber überlässt als Personaldienstleistungsunternehmen seinen Kunden Beschäftigte im Rahmen der Arbeitnehmerüberlassung. Der Arbeitgeber besitzt eine befristete Erlaubnis zur Arbeitnehmerüberlassung, zuletzt erteilt von der Bundesagentur für Arbeit, Agentur für Arbeit Düsseldorf, am 02.03.2018 in Düsseldorf.
        </Text>
        <Text style={styles.paragraph}>
          Der Mitarbeiter wird an wechselnden Einsatzstellen bei Kunden und bei wechselnden Kunden eingesetzt. Der Einsatz bei einem Kunden erfolgt vorübergehend. Der Arbeitgeber informiert den Mitarbeiter vor jeder Überlassung darüber, dass er als Zeitarbeitnehmer tätig wird. Der Mitarbeiter kann auch im Rahmen von Werk- oder Dienstverträgen eingesetzt werden.
        </Text>
        <Text style={styles.paragraph}>
          (2) Die Rechte und Pflichten der Arbeitsvertragsparteien bestimmen sich nach den Tarifverträgen in der jeweils gültigen Fassung, die der Arbeitgeberverband iGZ mit einer oder mehreren der Gewerkschaften abgeschlossen hat.
        </Text>

        <Text style={styles.h2}>§ 2 Beginn / Probezeit / Dauer</Text>
        <Text style={styles.paragraph}>
          (1) Das Arbeitsverhältnis beginnt am {data.startDate ? format(data.startDate, "dd.MM.yyyy") : "___.___.____"}. Es ist eine Probezeit von 6 Monaten gemäß § 2.2. Manteltarifvertrag iGZ vereinbart.
        </Text>
        <Text style={styles.paragraph}>
          (2) Die Parteien vereinbaren, dass
        </Text>
        <View style={styles.list}>
          <Text style={styles.listItem}>
            [{data.contractType === "unbefristet" ? "X" : "  "}] das Arbeitsverhältnis unbefristet abgeschlossen wird.
          </Text>
          <Text style={styles.listItem}>
            [{data.contractType === "befristet" ? "X" : "  "}] das Arbeitsverhältnis befristet wird. Es endet am {data.endDate ? format(data.endDate, "dd.MM.yyyy") : "___.___.____"}.
          </Text>
        </View>

        <Text style={styles.h2}>§ 3 Tätigkeit / Pflichten des Mitarbeiters</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter wird entsprechend der Tätigkeit im Kundenbetrieb eingestellt als <Text style={styles.bold}>{getQualificationText(data.qualification)}</Text>.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter wird an verschiedenen Einsatzorten im Gebiet Bonn und im Umkreis bis zu 100 km bei Kundenbetrieben beschäftigt. Er ist bei Bedarf auch zur Arbeitsleistung an Einsatzorten außerhalb des Kundenbetriebes verpflichtet.
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>§ 4 Arbeitszeit / Mehrarbeit / Arbeitszeitkonto</Text>
        <Text style={styles.paragraph}>
          (1) Es wird auf die Regelungen zur Arbeitszeit in § 3.1. Manteltarifvertrag iGZ verwiesen. Die Vertragsparteien vereinbaren eine individuelle regelmäßige monatliche Arbeitszeit, die <Text style={styles.bold}>{formatRate(data.requiredHours)}</Text> Stunden beträgt.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter verpflichtet sich im Rahmen des gesetzlich Zulässigen Überstunden und Mehrarbeit zu leisten.
        </Text>
        <Text style={styles.paragraph}>
          (3) Der Arbeitgeber richtet für den Mitarbeiter gemäß § 3.2. Manteltarifvertrag iGZ ein Arbeitszeitkonto ein.
        </Text>

        <Text style={styles.h2}>§ 5 Vergütung und Fälligkeit / Aufwendungsersatz</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter wird gemäß Entgeltrahmentarifvertrag iGZ eingruppiert.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter erhält ein tarifliches Entgelt, dessen Höhe sich nach dem Entgelttarifvertrag iGZ bemisst. Es beträgt derzeit:
        </Text>
        <Text style={[styles.paragraph, styles.bold, { marginLeft: 16 }]}>
          {monthlySalary} € Brutto/Monat (entspricht {hourlyStr} € Brutto/Stunde)
        </Text>
        <Text style={styles.paragraph}>
          (3) Die Vergütung ist auf ein vom Mitarbeiter anzugebendes Konto zu überweisen.
        </Text>
        <Text style={styles.paragraph}>
          (4) Der Anspruch auf Aufwendungsersatz bestimmt sich nach § 670 BGB. Es können für jeden Einsatz gesonderte Vereinbarungen getroffen werden (z.B. bezüglich Fahrtkosten oder Verpflegungsmehraufwand).
        </Text>

        <Text style={styles.h2}>§ 6 Urlaub / Krankheit / Geheimhaltung</Text>
        <Text style={styles.paragraph}>
          (1) Es wird auf die Urlaubsregelung in § 6 Manteltarifvertrag iGZ verwiesen.
        </Text>
        <Text style={styles.paragraph}>
          (2) Im Falle der Arbeitsverhinderung durch Krankheit gelten die gesetzlichen Bestimmungen zur Entgeltfortzahlung.
        </Text>
        <Text style={styles.paragraph}>
          (3) Der Mitarbeiter verpflichtet sich, über alle Betriebs- und Geschäftsgeheimnisse Stillschweigen zu bewahren.
        </Text>
        <Text style={styles.paragraph}>
          (4) Es gelten im Übrigen die allgemeinen Bestimmungen des iGZ-Tarifwerks in seiner jeweils gültigen Fassung.
        </Text>

        <View style={styles.signatureContainer}>
          <View style={styles.signatureBox}>
            <Text>Ort, Datum</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>Ort, Datum</Text>
          </View>
        </View>
        
        <View style={[styles.signatureContainer, { marginTop: 40 }]}>
          <View style={styles.signatureBox}>
            <Text>RheinAhr Dienstleistungen GmbH</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>{data.fullName}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export async function generateArbeitsvertragPdf(data: ArbeitsvertragData): Promise<Buffer> {
  return await renderToBuffer(<ArbeitsvertragTemplate data={data} />);
}
