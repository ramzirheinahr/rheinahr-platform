import "server-only";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { format } from "date-fns";

export type RahmenvertragData = {
  facilityName: string;
  facilityAddress: string;
  createdAt: Date;
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 24, textAlign: "center" },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 8 },
  paragraph: { marginBottom: 12, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  signatureBox: { marginTop: 40, borderTopWidth: 1, borderTopColor: "#9ca3af", paddingTop: 8, width: 200 },
});

export const RahmenvertragTemplate = ({ data }: { data: RahmenvertragData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Arbeitnehmerüberlassungsvertrag (Rahmenvertrag)</Text>
      
      <View style={{ marginBottom: 24 }}>
        <Text style={styles.paragraph}>Zwischen</Text>
        <Text style={[styles.paragraph, styles.bold]}>{data.facilityName}</Text>
        <Text style={styles.paragraph}>{data.facilityAddress}</Text>
        <Text style={styles.paragraph}>(nachfolgend „Auftraggeber“ genannt)</Text>
        
        <Text style={styles.paragraph}>und</Text>
        
        <Text style={[styles.paragraph, styles.bold]}>RheinAhr Dienstleistungen GmbH</Text>
        <Text style={styles.paragraph}>Theaterplatz 1, 53177 Bonn</Text>
        <Text style={styles.paragraph}>Vertreten durch Geschäftsführer Basem Aldanaf</Text>
        <Text style={styles.paragraph}>(nachfolgend „Personaldienstleister“ genannt)</Text>
        
        <Text style={styles.paragraph}>wird folgender Arbeitnehmerüberlassungsvertrag geschlossen:</Text>
      </View>

      <Text style={styles.h2}>§ 1 Erlaubnis zur Arbeitnehmerüberlassung</Text>
      <Text style={styles.paragraph}>
        (1) Der Personaldienstleister erklärt, im Besitz einer befristeten Erlaubnis zur Arbeitnehmerüberlassung zu sein, 
        zuletzt erteilt von der Bundesagentur für Arbeit, Agentur für Arbeit Düsseldorf. Diese Erlaubnis ist zwischenzeitlich 
        weder widerrufen noch zurückgenommen worden.
      </Text>
      <Text style={styles.paragraph}>
        (2) Der Personaldienstleister wird den Auftraggeber unverzüglich über den Widerruf oder das sonstige Erlöschen 
        der Erlaubnis gemäß § 5 Arbeitnehmerüberlassungsgesetz (AÜG) informieren.
      </Text>

      <Text style={styles.h2}>§ 2 Inkrafttreten / Gegenstand / Kettenverleih</Text>
      <Text style={styles.paragraph}>
        (1) Der Arbeitnehmerüberlassungsvertrag tritt am {format(data.createdAt, "dd.MM.yyyy")} in Kraft.
      </Text>
      <Text style={styles.paragraph}>
        (2) Der Personaldienstleister verpflichtet sich, dem Betrieb des Auftraggebers auf Anforderung Arbeitnehmer zur 
        Arbeitsleistung zu überlassen. Der Personaldienstleister sichert dem Auftraggeber zu, dass nur Arbeitnehmer überlassen 
        werden, die in einem Arbeitsverhältnis zum Personaldienstleister stehen (kein Kettenverleih).
      </Text>

      <Text style={styles.h2}>§ 3 Einbeziehung von Zeitarbeitstarifverträgen</Text>
      <Text style={styles.paragraph}>
        (1) Der Personaldienstleister ist Mitglied des Gesamtverbandes der Personaldienstleister e.V. (GVP). Der 
        Personaldienstleister erklärt, dass in die Arbeitsverträge das iGZ-DGB-Tarifwerk vollständig in seiner 
        jeweils gültigen Fassung einbezogen wird.
      </Text>

      <Text style={styles.h2}>§ 4 Branchenzugehörigkeit / Equal Pay</Text>
      <Text style={styles.paragraph}>
        (1) Der Auftraggeber informiert den Personaldienstleister über Änderungen der branchenmäßigen Zuordnung 
        des Betriebs, da dies zur Anwendbarkeit eines Branchenzuschlagstarifvertrages führen kann.
      </Text>
      <Text style={styles.paragraph}>
        (2) Soweit auf die Überlassung kein einschlägiger Branchenzuschlagstarifvertrag Anwendung findet und ein Einsatz 
        eines Mitarbeiters von mehr als neun Monaten geplant ist, ist der Auftraggeber verpflichtet, dem Personaldienstleister 
        das Arbeitsentgelt eines vergleichbaren Stammarbeitnehmers (Equal Pay) mitzuteilen.
      </Text>
    </Page>

    <Page size="A4" style={styles.page}>
      <Text style={styles.h2}>§ 5 Überlassungshöchstdauer / Konkretisierung</Text>
      <Text style={styles.paragraph}>
        (1) Der Einsatz eines bestimmten namentlich bezeichneten Zeitarbeitnehmers erfolgt vorübergehend. Auftraggeber 
        und Personaldienstleister stellen sicher, dass der Einsatz eines bestimmten Zeitarbeitnehmers nicht über das 
        Ende des Arbeitnehmerüberlassungsvertrags hinaus erfolgt (grundsätzlich 18 Monate).
      </Text>
      <Text style={styles.paragraph}>
        (2) Die konkrete Überlassung (Konkretisierung) mit Angabe von Name, Qualifikation und Einsatzzeiten erfolgt 
        jeweils gesondert in Form eines "Einzelabrufs".
      </Text>

      <Text style={styles.h2}>§ 6 Fälligkeit und Verzug</Text>
      <Text style={styles.paragraph}>
        (1) Die Arbeitnehmerüberlassungsvergütung wird mit Zugang der Rechnung fällig. Der Auftraggeber gerät in Verzug, 
        wenn der Rechnungsbetrag nicht innerhalb von 10 Kalendertagen ab Zugang der Rechnung auf dem Geschäftskonto 
        des Personaldienstleisters eingeht.
      </Text>

      <Text style={styles.h2}>§ 7 Abrechnung</Text>
      <Text style={styles.paragraph}>
        (1) Die Abrechnung erfolgt auf Basis der effektiv geleisteten Arbeitsstunden. Es sind die Arbeitsstunden für 
        jeden überlassenen Arbeitnehmer durch Tätigkeitsnachweise (elektronisch oder auf Papier) zu belegen.
      </Text>

      <Text style={styles.h2}>§ 8 Personalauswahl / Personaleinsatz</Text>
      <Text style={styles.paragraph}>
        (1) Die Personalauswahl erfolgt durch den Personaldienstleister auf Grundlage der in der Bedarfsmeldung vereinbarten 
        Anforderungsprofile.
      </Text>
      <Text style={styles.paragraph}>
        (2) Der Auftraggeber hat einen Anspruch auf Austausch des Zeitarbeitnehmers, wenn dieser für die vorgesehene 
        Tätigkeit nicht geeignet ist. Die fehlende Eignung muss entsprechend nachgewiesen werden.
      </Text>

      <Text style={styles.h2}>§ 9 Arbeitsschutz / Eignungsvoraussetzungen</Text>
      <Text style={styles.paragraph}>
        (1) Der Auftraggeber hat vor Arbeitsaufnahme der eingesetzten Arbeitnehmer eine arbeitsplatzspezifische Arbeitsschutz- 
        und Sicherheitsbelehrung durchzuführen.
      </Text>
    </Page>

    <Page size="A4" style={styles.page}>
      <Text style={styles.h2}>§ 10 Haftung / Aufrechnung</Text>
      <Text style={styles.paragraph}>
        (1) Im Hinblick darauf, dass der Zeitarbeitnehmer unter Leitung und Aufsicht des Auftraggebers seine Tätigkeit 
        ausübt, haftet der Personaldienstleister nicht für Schäden, die der Zeitarbeitnehmer in Ausübung seiner Tätigkeit verursacht.
      </Text>

      <Text style={styles.h2}>§ 11 Übernahme von Mitarbeitern / Vermittlung</Text>
      <Text style={styles.paragraph}>
        (1) Eine Vermittlung liegt vor, wenn der Auftraggeber während der Dauer der Überlassung oder innerhalb von 
        6 Monaten nach Beendigung der Überlassung ein Arbeitsverhältnis mit dem Zeitarbeitnehmer eingeht. In diesem Fall 
        hat der Auftraggeber eine Vermittlungsprovision zu zahlen.
      </Text>

      <Text style={styles.h2}>§ 12 Dauer des Vertrages / Kündigung</Text>
      <Text style={styles.paragraph}>
        (1) Der Vertrag wird auf unbestimmte Zeit geschlossen.
      </Text>
      <Text style={styles.paragraph}>
        (2) Der Arbeitnehmerüberlassungsvertrag kann ordentlich mit einer Frist von 1 Woche gekündigt werden. Kündigungen bedürfen 
        in jedem Falle der Textform.
      </Text>

      <Text style={styles.h2}>§ 13 Gerichtsstand</Text>
      <Text style={styles.paragraph}>
        Gerichtsstand für alle Rechtsstreitigkeiten, die im Zusammenhang mit diesem Vertrag entstehen, ist der Hauptsitz 
        des Personaldienstleisters in Bonn.
      </Text>

      <Text style={styles.h2}>§ 14 Schriftform / Vertretung / Salvatorische Klausel</Text>
      <Text style={styles.paragraph}>
        (1) Gemäß § 12 Absatz 1 Satz 1 AÜG bedarf dieser Rahmenvertrag der Schriftform (§ 126 BGB). Er ist von beiden 
        Vertragsparteien eigenhändig im Original oder mittels qualifizierter elektronischer Signatur (QES) zu unterzeichnen.
      </Text>
      <Text style={styles.paragraph}>
        (2) Sollte eine Bestimmung dieser Vereinbarung unwirksam sein oder werden, wird die Wirksamkeit der übrigen 
        Bestimmungen hiervon nicht berührt.
      </Text>

      <Text style={styles.h2}>§ 15 Elektronische Signatur der Einzelabrufe (Zusatzklausel)</Text>
      <Text style={[styles.paragraph, styles.bold]}>
        Die Parteien vereinbaren hiermit ausdrücklich, dass alle zukünftigen Einzelabrufe (Konkretisierungen gemäß § 1 Abs. 1 AÜG 
        sowie § 5 dieses Rahmenvertrags) über das webbasierte System des Personaldienstleisters generiert und in elektronischer Form 
        (inklusive Zeitstempel und IP-Protokollierung) signiert werden dürfen. 
      </Text>
      <Text style={[styles.paragraph, styles.bold]}>
        Beide Parteien erkennen diese elektronische Form als verbindliche und rechtskräftige Erfüllung der Textform an.
      </Text>

      <View style={{ marginTop: 80, flexDirection: "row", justifyContent: "space-between" }}>
        <View style={styles.signatureBox}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 20 }}>Personaldienstleister</Text>
          <Text>RheinAhr Dienstleistungen GmbH</Text>
          <Text style={{ fontSize: 8, color: "#6b7280", marginTop: 40 }}>Ort, Datum, Unterschrift</Text>
        </View>
        
        <View style={styles.signatureBox}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 20 }}>Auftraggeber</Text>
          <Text>{data.facilityName}</Text>
          <Text style={{ fontSize: 8, color: "#6b7280", marginTop: 40 }}>Ort, Datum, Unterschrift</Text>
        </View>
      </View>
    </Page>
  </Document>
);

export async function renderRahmenvertragPdf(data: RahmenvertragData) {
  return renderToBuffer(<RahmenvertragTemplate data={data} />);
}
