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
import { getCompanyConfig } from "@/lib/config/company";

export type ContractPdfData = {
  facilityName: string;
  facilityAddress: string;
  period: string;
  periodStart?: string;
  periodEnd?: string;
  contactPerson?: string;
  contractDate?: string;
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
    hours?: number;
  }>;
  rates?: Record<string, number>;
  surcharges?: {
    night?: number;
    sat?: number;
    sun?: number;
    holiday?: number;
    overtime?: number;
  };
  stampDataUrl?: string;
  signatureData?: string | null;
  signedAt?: string;
  ipAddress?: string | null;
  splitByShift?: boolean;
};

// ==========================================
// 1. ORIGINAL RHEINAHR CONTRACT STYLES & VIEW (PRESERVED 100%)
// ==========================================
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

const ContractPage = ({ data, companyConfig }: { data: ContractPdfData, companyConfig: any }) => (
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
      <Text style={styles.paragraph}>{companyConfig.street}, {companyConfig.city}</Text>
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

const OriginalAuegContractTemplate = ({ data, companyConfig }: { data: ContractPdfData, companyConfig: any }) => (
  <Document>
    {data.splitByShift ? (
      data.assignments.map((a, i) => (
        <ContractPage key={i} data={{ ...data, assignments: [a], period: a.shiftDate }} companyConfig={companyConfig} />
      ))
    ) : (
      <ContractPage data={data} companyConfig={companyConfig} />
    )}
  </Document>
);

// ==========================================
// 2. RHEINLAND 9-PAGE CONTRACT STYLES & VIEW
// ==========================================
const rlStyles = StyleSheet.create({
  page: {
    padding: 42,
    paddingTop: 45,
    paddingBottom: 45,
    fontSize: 9.5,
    color: "#000000",
    fontFamily: "Helvetica",
    lineHeight: 1.35,
  },
  pageNumber: {
    position: "absolute",
    bottom: 25,
    right: 42,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#000000",
  },
  topParties: {
    marginBottom: 20,
    lineHeight: 1.4,
  },
  partyTitle: {
    fontFamily: "Helvetica",
    marginBottom: 2,
  },
  partyBold: {
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
  },
  p: {
    fontSize: 9.5,
    marginBottom: 6,
    textAlign: "justify",
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 3,
    paddingLeft: 12,
  },
  bulletDot: {
    width: 14,
    fontFamily: "Helvetica-Bold",
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  checkboxSquare: {
    width: 11,
    height: 11,
    borderWidth: 1,
    borderColor: "#000",
    marginRight: 8,
    marginTop: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxMark: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 9.5,
    textAlign: "justify",
  },
  workerItemBox: {
    padding: 6,
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginBottom: 6,
    backgroundColor: "#fafafa",
  },
  workerRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  workerLabel: {
    width: 170,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  workerVal: {
    flex: 1,
    fontSize: 9,
  },
  signatureSection: {
    marginTop: 25,
  },
  signatureBlock: {
    marginTop: 18,
    width: "70%",
  },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: "#000000",
    paddingTop: 4,
    marginTop: 4,
  },
  sigText: {
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  sigImage: {
    height: 40,
    objectFit: "contain",
    alignSelf: "flex-start",
    marginBottom: 2,
  },
  stampImage: {
    height: 45,
    objectFit: "contain",
    alignSelf: "flex-start",
    marginBottom: 2,
  },
});

const RheinlandContractDocument = ({ data, companyConfig }: { data: ContractPdfData; companyConfig: any }) => {
  const contractEffectiveDate = data.periodStart || (data.assignments[0]?.shiftDate) || data.contractDate || "dem vereinbarten Einsatzbeginn";
  const contractEndDate = data.periodEnd || (data.assignments[data.assignments.length - 1]?.shiftDate) || data.period || "[Datum]";

  const surcharges = {
    overtime: data.surcharges?.overtime ?? 25,
    night: data.surcharges?.night ?? 50,
    sat: data.surcharges?.sat ?? 25,
    sun: data.surcharges?.sun ?? 100,
    holiday: data.surcharges?.holiday ?? 125,
  };

  const contactPersonAuftraggeber = data.contactPerson || data.facilityName;
  const contactPersonVerleiher = companyConfig.ceo || "Katharina Schebesta";
  const phoneVerleiher = companyConfig.phone || "0228- 40980920";

  return (
    <Document>
      {/* ================= PAGE 1 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <View style={rlStyles.topParties}>
          <Text style={rlStyles.partyTitle}>Zwischen</Text>
          <Text style={[rlStyles.partyTitle, rlStyles.partyBold]}>{data.facilityName}</Text>
          {(data.facilityAddress || "").split("\n").map((line: string, i: number) => (
            <Text key={`addr-${i}`} style={rlStyles.partyTitle}>{line}</Text>
          ))}
          <Text style={[rlStyles.partyTitle, { marginBottom: 10 }]}>(Auftraggeber)</Text>

          <Text style={rlStyles.partyTitle}>und</Text>
          <Text style={[rlStyles.partyTitle, rlStyles.partyBold]}>{companyConfig.name}</Text>
          <Text style={rlStyles.partyTitle}>{contactPersonVerleiher}</Text>
          <Text style={rlStyles.partyTitle}>{companyConfig.street}</Text>
          <Text style={rlStyles.partyTitle}>{companyConfig.city}</Text>
          <Text style={[rlStyles.partyTitle, { marginBottom: 12 }]}>(Personaldienstleister)</Text>

          <Text style={rlStyles.partyTitle}>wird folgender Arbeitnehmerüberlassungsvertrag geschlossen:</Text>
        </View>

        <Text style={rlStyles.sectionTitle}>§ 1 Erlaubnis zur Arbeitnehmerüberlassung</Text>
        <Text style={rlStyles.p}>
          (1) Der Personaldienstleister erklärt, im Besitz einer befristeten Erlaubnis zur Arbeitnehmerüberlassung zu sein,
          zuletzt erteilt von der Bundesagentur für Arbeit, Agentur für Arbeit Düsseldorf, am 06.11.2025 in Düsseldorf.
          Diese Erlaubnis ist zwischenzeitlich weder widerrufen noch zurückgenommen worden. Der Personaldienstleister
          verpflichtet sich, die Erlaubnisurkunde auf Verlangen des Auftraggebers vorzulegen.
        </Text>
        <Text style={rlStyles.p}>
          (2) Der Personaldienstleister wird den Auftraggeber unverzüglich über den Widerruf oder das sonstige Erlöschen
          der Erlaubnis gemäß § 5 Arbeitnehmerüberlassungsgesetz (AÜG) informieren. In den Fällen der Nichtverlängerung,
          der Rücknahme oder des Widerrufs wird er ihn ferner auf das voraussichtliche Ende der Abwicklung und die
          gesetzliche Abwicklungsfrist hinweisen.
        </Text>

        <Text style={rlStyles.sectionTitle}>
          § 2 Inkrafttreten / Gegenstand / Mindestlöhne nach AEntG / Bauhauptgewerbeverbot / Kettenverleih
        </Text>
        <Text style={rlStyles.p}>
          (1) Der Arbeitnehmerüberlassungsvertrag tritt am {contractEffectiveDate} in Kraft.
        </Text>
        <Text style={rlStyles.p}>
          (2) Der Personaldienstleister verpflichtet sich, dem Betrieb des Auftraggebers in {data.facilityAddress?.replace(/\n/g, ", ") || data.facilityName} auf Anforderung
          Arbeitnehmer zur Arbeitsleistung zu überlassen. Der Personaldienstleister sichert dem Auftraggeber zu, dass nur
          Arbeitnehmer überlassen werden, die in einem Arbeitsverhältnis zum Personaldienstleister stehen (kein Kettenverleih).
        </Text>
        <Text style={rlStyles.p}>
          (3) Der Einsatz in einem anderen als dem in Absatz 2 genannten Betrieb des Unternehmens, der Austausch von
          Arbeitnehmern innerhalb des Betriebes sowie die Zuweisung anderer als der in diesem Vertrag vereinbarten
          Tätigkeiten bedürfen der Zustimmung des Personaldienstleisters. Der Auftraggeber ist verpflichtet, den
          Personaldienstleister rechtzeitig vorab darüber zu informieren, wenn der Zeitarbeitnehmer im Ausland eingesetzt werden soll.
        </Text>
        <Text style={rlStyles.p}>
          (4) Vor dem Hintergrund von Mindestlohnverpflichtungen aufgrund des Arbeitnehmer-Entsendegesetzes teilt der
          Auftraggeber dem Personaldienstleister eine Änderung der Tätigkeit der überlassenen Arbeitnehmer umgehend mit.
          Die Parteien sind sich einig, dass der vereinbarte Stundensatz anzupassen ist, wenn die ausgeübte Tätigkeit
          mindestlohnpflichtig wird oder wenn der Mindestlohn steigt.
        </Text>

        <Text style={rlStyles.pageNumber}>1</Text>
      </Page>

      {/* ================= PAGE 2 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <Text style={rlStyles.p}>
          (5) Sofern der Personaldienstleister dem Auftraggeber Arbeiter im Sinne des § 1b Satz 1 AÜG (Verbot der
          Überlassung in das Bauhauptgewerbe) überlässt, bestätigt der Auftraggeber, dass in dem in § 2 Absatz 2
          genannten Betrieb nicht überwiegend Gewerke im Sinne des § 1 der Baubetriebe-Verordnung erbracht werden.
          Der Auftraggeber ist verpflichtet, den Personaldienstleister über eine Änderung unverzüglich zu informieren.
        </Text>
        <Text style={rlStyles.p}>
          (6) Der Auftraggeber sichert zu, dass er Zeitarbeitnehmer weder offen (offengelegte Arbeitnehmerüberlassung)
          noch verdeckt (verdeckte Arbeitnehmerüberlassung, z.B. Scheinwerkverträge) weiter überlässt (kein Kettenverleih).
        </Text>
        <Text style={rlStyles.p}>
          (7) Der Auftraggeber verpflichtet sich, Arbeitnehmer in dem in § 5 Absatz 2 genannten Umfange abzunehmen und
          die dafür vorgesehene Überlassungsvergütung zu zahlen. Der Auftraggeber hat den Personaldienstleister unverzüglich
          in Kenntnis zu setzen, wenn er den Arbeitnehmer nicht in dem in § 5 Absatz 2 genannten Umfange einsetzen kann.
        </Text>

        <Text style={rlStyles.sectionTitle}>
          § 3 Einbeziehung von Zeitarbeitstarifverträgen / Rückentleih / vorangegangene Einsätze
        </Text>
        <Text style={rlStyles.p}>
          (1) Der Personaldienstleister ist Mitglied des Gesamtverbandes der Personaldienstleister e.V (GVP). Der
          Personaldienstleister erklärt, dass in die Arbeitsverträge, die er mit den beim Auftraggeber eingesetzten
          Arbeitnehmern abgeschlossen hat, das iGZ-DGB-Tarifwerk (einschließlich der Branchenzuschlagstarifverträge) und
          ergänzende, ändernde oder ersetzende Tarifverträge, die der GVP als Rechtsnachfolger des Interessenverbandes
          Deutscher Zeitarbeitsunternehmen e.V. (iGZ) abgeschlossen hat, vollständig in seiner jeweils gültigen Fassung
          einbezogen werden.
        </Text>
        <Text style={rlStyles.p}>
          (2) Der Auftraggeber sichert zu, dass kein im Rahmen dieses Arbeitnehmerüberlassungsvertrages eingesetzter
          Arbeitnehmer in den letzten sechs Monaten vor der Überlassung aus einem Arbeitsverhältnis mit dem Auftraggeber
          selbst oder einem mit dem Auftraggeber konzernmäßig im Sinne des § 18 Aktiengesetz verbundenen Unternehmen
          ausgeschieden ist. Andernfalls informiert der Auftraggeber den Personaldienstleister.
        </Text>
        <Text style={rlStyles.p}>
          (3) Der Auftraggeber sichert zu, dass kein im Rahmen dieses Arbeitnehmerüberlassungsvertrages eingesetzter
          Arbeitnehmer in den letzten drei Monaten und einem Tag über einen anderen Personaldienstleister beim
          Auftraggeber tätig war. Andernfalls informiert der Auftraggeber den Personaldienstleister über die kürzere
          Unterbrechung. Vorangegangene Einsätze werden in diesem Falle bei der Vereinbarung der Einsatzdauer gemäß
          § 5 berücksichtigt.
        </Text>

        <Text style={rlStyles.sectionTitle}>
          § 4 Branchenzugehörigkeit / Branchenzuschläge / Equal Pay / Gemeinschaftseinrichtung
        </Text>
        <Text style={rlStyles.p}>
          (1) Laut Auskunft des Auftraggebers gehört der in § 2 Absatz 2 genannte Betrieb der stationären Altenhilfe an.
          Der Auftraggeber erklärt, nachdem die Branchenzugehörigkeit mithilfe eines vom Personaldienstleister vorgelegten
          Fragebogens bestimmt wurde, dass der in § 2 Absatz 2 genannte Betrieb gegenwärtig keinem Branchenzuschlagstarifvertrag
          unterliegt. Der Auftraggeber informiert den Personaldienstleister über Änderungen der branchenmäßigen Zuordnung
          des in § 2 Absatz 2 genannten Betriebs, da dies zur Anwendbarkeit eines Branchenzuschlagstarifvertrages führen kann.
        </Text>
        <Text style={rlStyles.p}>
          (2) Ist ein ununterbrochener Einsatz eines in § 5 Absatz 2 genannten Mitarbeiters von mehr als neun Monaten
          geplant oder absehbar, ist der Auftraggeber verpflichtet, dem Personaldienstleister das Arbeitsentgelts eines
          vergleichbaren Stammarbeitnehmers des Auftraggebers (Equal Pay) spätestens einen Monat vor Beginn des 10.
          Überlassungsmonats mitzuteilen. Zur Ermittlung des Equal Pay wird ein entsprechender Fragebogen verwendet. Der
          genannte Fragebogen wird Inhalt dieses Vertrages. Der Auftraggeber informiert den Personaldienstleister unverzüglich
          über alle – auch bereits feststehende künftige – Änderungen des Equal Pay. Die Änderungen werden ebenfalls Gegenstand
          des Vertrages.
        </Text>

        <Text style={rlStyles.pageNumber}>2</Text>
      </Page>

      {/* ================= PAGE 3 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <Text style={rlStyles.p}>
          (3) Der Auftraggeber teilt dem Personaldienstleister mit, wenn und soweit er den Zeitarbeitnehmern Zugang zu
          seinen Gemeinschaftseinrichtungen gewährt. Über diesbezügliche Änderungen unterrichtet der Auftraggeber den
          Personaldienstleister unverzüglich.
        </Text>

        <Text style={rlStyles.sectionTitle}>
          § 5 Überlassungshöchstdauer / Überlassungsbedingungen / Konkretisierung / Preisanpassung
        </Text>
        <Text style={[rlStyles.p, { fontFamily: "Helvetica-Bold", marginBottom: 8 }]}>
          (1) Bitte Zutreffendes ankreuzen:
        </Text>

        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare} />
          <Text style={rlStyles.checkboxLabel}>
            Der Auftraggeber hat dem Personaldienstleister mitgeteilt, dass in dem in § 2 Absatz 2 genannten Betrieb keine
            abweichende Überlassungshöchstdauer gilt.
          </Text>
        </View>

        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare} />
          <Text style={rlStyles.checkboxLabel}>
            Der Auftraggeber hat dem Personaldienstleister mitgeteilt, dass in dem in § 2 Absatz 2 genannten Betrieb eine
            Überlassungshöchstdauer von [Zeitraum] gilt. Den im Betrieb geltenden Tarifvertrag und/ oder die
            Betriebsvereinbarung hat der Auftraggeber dem Personaldienstleister in Kopie übermittelt.
          </Text>
        </View>

        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare}>
            <Text style={rlStyles.checkboxMark}>X</Text>
          </View>
          <Text style={rlStyles.checkboxLabel}>
            Der Auftraggeber hat dem Personaldienstleister mitgeteilt, dass in dem in § 2 Absatz 2 genannten Betrieb eine
            Überlassungshöchstdauer von 18 Monaten gilt. Den im Betrieb geltenden Tarifvertrag und/ oder die
            Betriebsvereinbarung wird der Auftraggeber dem Personaldienstleister unverzüglich in Kopie übermitteln.
          </Text>
        </View>

        <Text style={rlStyles.p}>
          Der Einsatz eines bestimmten namentlich bezeichneten Zeitarbeitnehmers erfolgt vorübergehend. Auftraggeber und
          Personaldienstleister stellen sicher, dass der Einsatz eines bestimmten Zeitarbeitnehmers nicht über das Ende
          des Arbeitnehmerüberlassungsvertrags hinaus erfolgt.
        </Text>
        <Text style={rlStyles.p}>
          Der Auftraggeber verpflichtet sich, dem Personaldienstleister unaufgefordert unverzüglich etwaige für ihn in
          Zukunft geltenden Tarifverträge, die eine Abweichung von der zukünftigen Überlassungshöchstdauer von 18 Monaten
          vorsehen, und/oder etwaige in dem in § 2 Absatz 2 benannten Betrieb zukünftig geltenden Betriebsvereinbarungen,
          die aufgrund eines Tarifvertrages eine Abweichung von der zukünftigen Überlassungshöchstdauer von 18 Monaten vorsehen,
          in Kopie zu übermitteln. Dies gilt insbesondere, wenn aufgrund eines Tarifvertrages und/oder einer
          Betriebsvereinbarung eine kürzere Überlassungshöchstdauer als 18 Monate geregelt ist.
        </Text>

        <Text style={[rlStyles.p, { fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 8 }]}>
          (2) Bitte Zutreffendes ankreuzen:
        </Text>

        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare}>
            <Text style={rlStyles.checkboxMark}>X</Text>
          </View>
          <Text style={rlStyles.checkboxLabel}>
            Der Personaldienstleister verpflichtet sich, folgende Arbeitnehmer zu überlassen:
          </Text>
        </View>

        {data.assignments.slice(0, 3).map((a, idx) => (
          <View key={`page3-worker-${idx}`} style={rlStyles.workerItemBox}>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Erforderliche Qualifikation:</Text>
              <Text style={rlStyles.workerVal}>{a.qualification}</Text>
            </View>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Vorgesehene Tätigkeit:</Text>
              <Text style={rlStyles.workerVal}>{a.qualification}</Text>
            </View>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Betriebliche Arbeitszeit:</Text>
              <Text style={rlStyles.workerVal}>{a.hours ? `${a.hours} Stunden` : "gemäß Dienstplan / 35,0 Stunden"}</Text>
            </View>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Name(n) des Mitarbeiters:</Text>
              <Text style={rlStyles.workerVal}>{a.workerName}</Text>
            </View>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Geburtsdatum des Mitarbeiters:</Text>
              <Text style={rlStyles.workerVal}>{a.birthDate || "—"}</Text>
            </View>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Überlassungsvergütung in Euro:</Text>
              <Text style={rlStyles.workerVal}>
                {a.hourlyRate ? `${a.hourlyRate.toFixed(2).replace(".", ",")} € / Std. (zzgl. USt.)` : "gemäß Vereinbarung"}
              </Text>
            </View>
            <View style={rlStyles.workerRow}>
              <Text style={rlStyles.workerLabel}>Einsatzbeginn / Einsatzende:</Text>
              <Text style={rlStyles.workerVal}>{a.shiftDate} ({a.startTime} - {a.endTime} Uhr)</Text>
            </View>
          </View>
        ))}

        <Text style={rlStyles.pageNumber}>3</Text>
      </Page>

      {/* ================= PAGE 4 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare}>
            <Text style={rlStyles.checkboxMark}>X</Text>
          </View>
          <Text style={rlStyles.checkboxLabel}>
            Wegen der weiteren Überlassungsbedingungen (Anzahl und Namen der Arbeitnehmer, Qualifikation, Tätigkeit,
            betriebliche Arbeitszeit, Überlassungsvergütung etc.) wird auf den Anhang / die Einsatzübersicht dieses Vertrages
            verwiesen. Die Vereinbarungen in diesem Anhang bedürfen der Textform.
          </Text>
        </View>

        <Text style={rlStyles.p}>
          (3) Sollte die Person des Zeitarbeitnehmers im Zeitpunkt des Abschlusses des Arbeitnehmerüberlassungsvertrages
          noch unbekannt sein, so ist der Zeitarbeitnehmer von Auftraggeber und Personaldienstleister rechtzeitig vor
          Einsatzbeginn namentlich unter Angabe des Geburtsdatums zu benennen (Konkretisierung). Dies gilt auch für den
          Austausch von Zeitarbeitnehmern nach § 8 Absatz 4 und 5.
        </Text>
        <Text style={[rlStyles.p, { fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 4 }]}>
          Als Ansprechpartner für diesbezügliche Mitteilungen werden folgende Personen benannt:
        </Text>
        <Text style={rlStyles.p}>
          Ansprechpartner des Auftraggebers: {contactPersonAuftraggeber}
        </Text>
        <Text style={rlStyles.p}>
          Ansprechpartner des Personaldienstleisters: {contactPersonVerleiher}, Tel.: {phoneVerleiher}
        </Text>
        <Text style={rlStyles.p}>
          Sofern hinsichtlich des Ansprechpartners eine personelle Änderung während der Laufzeit dieses Vertrags eintritt,
          informiert die betroffene Partei die jeweils andere hierüber unverzüglich.
        </Text>

        <Text style={rlStyles.p}>
          (4) Die Überlassungsvergütung richtet sich nach der tatsächlichen Arbeitszeit der eingesetzten Arbeitnehmer,
          mindestens aber nach der in Absatz 2 genannten betrieblichen Arbeitszeit.
        </Text>

        <Text style={[rlStyles.p, { fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 4 }]}>
          (5) Es werden folgende Zuschläge vereinbart:
        </Text>
        <View style={rlStyles.bulletRow}>
          <Text style={rlStyles.bulletDot}>•</Text>
          <Text style={rlStyles.bulletText}>Mehrarbeitszuschlag: [{surcharges.overtime}%] ab der 41. Wochenstunde</Text>
        </View>
        <View style={rlStyles.bulletRow}>
          <Text style={rlStyles.bulletDot}>•</Text>
          <Text style={rlStyles.bulletText}>Nachtarbeitszuschlag: [{surcharges.night}%] in der Zeit von 20.00 bis 6.00 Uhr</Text>
        </View>
        <View style={rlStyles.bulletRow}>
          <Text style={rlStyles.bulletDot}>•</Text>
          <Text style={rlStyles.bulletText}>Samstagszuschlag: [{surcharges.sat}%] (von 0.00 Uhr bis 24.00 Uhr)</Text>
        </View>
        <View style={rlStyles.bulletRow}>
          <Text style={rlStyles.bulletDot}>•</Text>
          <Text style={rlStyles.bulletText}>Sonntagszuschlag: [{surcharges.sun}%] (von 0.00 Uhr bis 24.00 Uhr)</Text>
        </View>
        <View style={rlStyles.bulletRow}>
          <Text style={rlStyles.bulletDot}>•</Text>
          <Text style={rlStyles.bulletText}>Feiertagszuschlag: [{surcharges.holiday}%] (von 0.00 Uhr bis 24.00 Uhr)</Text>
        </View>

        <Text style={[rlStyles.p, { marginTop: 6 }]}>
          Soweit die Arbeit an Sonn- und Feiertagen zur Regelarbeitszeit zählt, richten sich die Zuschläge nach der im
          Betrieb des Auftraggebers gültigen Zuschlagsregelung. Soweit für den Zeitarbeitnehmer aufgrund des iGZ-DGB-Tarifwerks
          oder aufgrund der ergänzenden, ändernden oder ersetzenden Tarifverträge, die der GVP als Rechtsnachfolger des
          iGZ abgeschlossen hat (siehe § 3 Absatz 1), abweichende, branchenbezogene Zuschlagsreglungen gelten, legen die
          Vertragsparteien diese ebenfalls zugrunde. Im Falle vollkontinuierlicher Schichtarbeit richten sich die
          Zuschläge nach dem Zuschlagsmodell des Auftraggebers, wenn jedenfalls ein voller Zyklus durchlaufen wird.
          Basis für die Zuschlagsberechnung ist die jeweils vereinbarte Überlassungsvergütung.
        </Text>
        <Text style={rlStyles.p}>
          (6) Der Personaldienstleister stellt sicher, dass die eingesetzten Arbeitnehmer über die erforderliche
          Qualifikation verfügen. Auf Nachfrage des Auftraggebers weist er die Qualifikation nach. Der Personaldienstleister
          gewährleistet einzelvertraglich mit dem Zeitarbeitnehmer, dass datenschutzrechtliche Vorschriften der Weitergabe
          solcher Informationen nicht entgegenstehen.
        </Text>
        <Text style={rlStyles.p}>
          (7) Der Personaldienstleister ist berechtigt, die Überlassungsvergütung nach billigem Ermessen anzupassen,
          wenn sich Veränderungen in der Kostensituation ergeben. Das billige Ermessen setzt voraus, dass bei der
          Anpassung lediglich die neue Kostensituation berücksichtigt wird, wie sie z.B. durch eine Erhöhung der Entgelte
          im iGZ-DGB-Tarifwerk oder in den ergänzenden, ändernden oder ersetzenden Tarifverträgen, die der GVP als
          Rechtsnachfolger des iGZ abgeschlossen hat (siehe § 3 Absatz 1), durch die Geltung eines neu in Kraft getretenen
          oder bisher nicht einschlägigen Branchenzuschlagstarifvertrags oder durch Änderungen beim Equal Pay eintritt.
          Vorstehendes gilt auch, wenn die ausgeübte Tätigkeit mindestlohnpflichtig wird oder wenn der Mindestlohn steigt
          (vgl. hierzu § 2 Absatz 4).
        </Text>

        <Text style={rlStyles.pageNumber}>4</Text>
      </Page>

      {/* ================= PAGE 5 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <Text style={rlStyles.sectionTitle}>§ 6 Fälligkeit und Verzug</Text>
        <Text style={rlStyles.p}>
          (1) Die Arbeitnehmerüberlassungsvergütung wird mit Zugang der Rechnung fällig. Der Auftraggeber gerät in Verzug,
          wenn der Rechnungsbetrag nicht innerhalb von 10 Kalendertagen ab Zugang der Rechnung auf dem Geschäftskonto des
          Personaldienstleisters eingeht. Einer vorherigen Mahnung bedarf es nicht (§ 286 Absatz 2 BGB). § 288 BGB
          (Verzugszinsen) findet Anwendung.
        </Text>
        <Text style={rlStyles.p}>
          (2) Befindet sich der Auftraggeber (teilweise) mit der Vergütungszahlung in Verzug, so wird die Vergütung für
          sämtliche noch nicht fakturierten Stunden, deren Ableistung der Auftraggeber auf einem Tätigkeitsnachweis bereits
          durch seine Unterschrift bestätigt hat, sofort fällig. Dem Personaldienstleister steht bei Nichtleistung durch
          den Auftraggeber ein Leistungsverweigerungsrecht zu.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 7 Abrechnung</Text>
        <Text style={rlStyles.p}>
          (1) Die Abrechnung erfolgt auf Basis der effektiv geleisteten Arbeitsstunden, wobei mindestens die vereinbarte
          betriebliche Arbeitszeit abzurechnen ist (§ 5 Absatz 2). Es sind die Arbeitsstunden für jeden überlassenen
          Arbeitnehmer durch Tätigkeitsnachweise zu belegen, die je überlassenem Arbeitnehmer wöchentlich auszufüllen und
          von einem Beauftragten des Auftraggebers nach sachlicher Prüfung zu unterschreiben sind. Die überlassenen
          Arbeitnehmer haben hierzu die beim Auftraggeber vorgegebenen Instrumente (Arbeitszeitnachweis/elektronische
          Arbeitszeiterfassung) zu nutzen, soweit diese vorhanden sind.
        </Text>
        <Text style={rlStyles.p}>
          (2) Der Auftraggeber ist verpflichtet, eine zeitnahe Ausstellung der Tätigkeitsweise zu ermöglichen.
        </Text>
        <Text style={rlStyles.p}>
          (3) Aus den Tätigkeitsnachweisen müssen der Beginn und das Ende der täglichen Arbeitszeit mit Pausen ersichtlich sein.
          Überstunden sind gesondert auszuweisen.
        </Text>
        <Text style={rlStyles.p}>
          (4) Der Zeitarbeitnehmer ist nicht zur Entgegennahme von Zahlungen durch den Auftraggeber berechtigt. Zahlungen an
          den Zeitarbeitnehmer haben keine Erfüllungswirkung.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 8 Personalauswahl / Personaleinsatz / Streik</Text>
        <Text style={rlStyles.p}>
          (1) Die Personalauswahl erfolgt durch den Personaldienstleister auf Grundlage der in der Bedarfsmeldung vereinbarten
          Anforderungsprofile.
        </Text>
        <Text style={rlStyles.p}>
          (2) Der Personaldienstleister verpflichtet sich, für die vorgesehenen Arbeiten geeignetes Personal auszuwählen.
          Bei angeforderten Qualifikationen, für die ein anerkannter Ausbildungsberuf existiert, verpflichtet sich der
          Personaldienstleister, nur solches Personal auszuwählen und dem Auftraggeber zu überlassen, das diese Berufsausbildung
          erfolgreich abgeschlossen hat. Abweichendes muss in Textform vereinbart werden.
        </Text>
        <Text style={rlStyles.p}>
          (3) Der Personaldienstleister stellt sicher, dass die eingesetzten Arbeitnehmer, sofern sie nicht Staatsangehörige
          eines EWR-Staates oder der Schweiz sind, zur Aufnahme der Tätigkeit aufgrund ausländerrechtlicher Regelungen berechtigt sind.
        </Text>
        <Text style={rlStyles.p}>
          (4) Der Personaldienstleister ist berechtigt, bei dem Auftraggeber eingesetzte Arbeitnehmer jederzeit gegen andere
          Arbeitnehmer auszutauschen, sofern diese den vereinbarten Anforderungsprofilen entsprechen. Der Auftraggeber ist
          hierüber 4 Stunden vorher zu informieren. § 5 Absatz 3 findet Anwendung.
        </Text>
        <Text style={rlStyles.p}>
          (5) Der Auftraggeber hat einen Anspruch auf Austausch des Zeitarbeitnehmers, wenn dieser für die vorgesehene Tätigkeit
          nicht geeignet ist. Die fehlende Eignung muss entsprechend nachgewiesen werden. Dieser Anspruch steht dem Auftraggeber
          auch dann zu, wenn Gründe vorliegen, die ihn im Falle eigener Arbeitgeberposition zur außerordentlichen Kündigung
          berechtigen würde (§ 626 BGB). Ist der Auftraggeber der Auffassung, es liege ein Anspruch auf Austausch im Sinne dieses
          Absatzes vor und will er deswegen den Einsatz des betreffenden Arbeitnehmers beenden, so hat er den Personaldienstleister
        </Text>

        <Text style={rlStyles.pageNumber}>5</Text>
      </Page>

      {/* ================= PAGE 6 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <Text style={rlStyles.p}>
          hierüber unverzüglich in Kenntnis zu setzen und den Austausch zu begründen. § 5 Absatz 3 findet Anwendung.
        </Text>
        <Text style={rlStyles.p}>
          (6) Wird der Betrieb des Auftraggebers bestreikt, darf dieser entgegen der Regelung in § 11 Absatz 5 AÜG keine
          Zeitarbeitnehmer in dem Betrieb tätig werden lassen. Darüber hinaus gilt das Einsatzverbot für Streiks, die von
          Mitgliedsgewerkschaften der DGB-Tarifgemeinschaft initiiert wurden, auch für bereits vor Beginn der
          Arbeitskampfmaßnahme eingesetzte Arbeitnehmer. Demnach wird der Zeitarbeitnehmer im Umfang des Streikaufrufs
          nicht in Betrieben oder Betriebsteilen eingesetzt, die ordnungsgemäß bestreikt werden. Der Auftraggeber stellt sicher,
          dass keine Zeitarbeitnehmer eingesetzt werden, soweit das Einsatzverbot reicht. Der Personaldienstleister ist
          insoweit nicht verpflichtet, Arbeitnehmer zu überlassen. Von den vorstehenden Regelungen können die Parteien des
          Arbeitskampfes im Einzelfall abweichen und den Einsatz von Zeitarbeitnehmern vereinbaren (z.B. in Notdienstvereinbarungen).
          Es gilt insoweit § 11 Absatz 5 Satz 2 AÜG. Der Auftraggeber informiert den Personaldienstleister unverzüglich über
          einen laufenden oder geplanten Streik.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 9 Eignungsvoraussetzungen / Arbeitsschutz</Text>
        <Text style={rlStyles.p}>
          (1) Die für den Einsatz notwendigen arbeitsmedizinischen Vorsorgeuntersuchungen sind vor dem Überlassungsbeginn
          durchzuführen und dem Auftraggeber nachzuweisen. Sofern Nachuntersuchungen erforderlich werden, teilt der Auftraggeber
          dies dem Personaldienstleister schriftlich mit. Nachuntersuchungen werden von dem für den Auftraggeber zuständigen
          Werksarzt oder falls ein solcher nicht vorhanden ist, von einem vom Personaldienstleister beauftragten Betriebsarzt
          auf Kosten des Personaldienstleisters durchgeführt. Eine abweichende Kostenaufteilung kann vereinbart werden.
        </Text>
        <Text style={rlStyles.p}>
          (2) Zur Wahrnehmung seiner Arbeitgeberpflichten wird dem Personaldienstleister während der Arbeitszeiten in
          Absprache mit dem Auftraggeber ein Zutrittsrecht zu den Arbeitsplätzen der Mitarbeiter eingeräumt.
        </Text>
        <Text style={rlStyles.p}>
          (3) Der Auftraggeber verpflichtet sich, dem Personaldienstleister einen Arbeitsunfall sofort zu melden und ihm
          alle nach § 193 Absatz 1 SGB VII erforderlichen Informationen zur Verfügung zu stellen. Der Personaldienstleister
          meldet den Arbeitsunfall bei dem zuständigen Unfallversicherungsträger.
        </Text>
        <Text style={rlStyles.p}>
          (4) Der Personaldienstleister hat seine Arbeitnehmer über geltende Unfallverhütungsvorschriften, Sicherheitsregeln
          und -hinweise zu informieren und zu belehren. Der Auftraggeber hat vor Arbeitsaufnahme der eingesetzten Arbeitnehmer
          eine arbeitsplatzspezifische Arbeitsschutz- und Sicherheitsbelehrung durchzuführen. Die Belehrung ist vom Auftraggeber
          zu dokumentieren und dem Personaldienstleister in Kopie auszuhändigen.
        </Text>
        <Text style={rlStyles.p}>
          (5) Der Auftraggeber sichert zu, dass die Regelungen des Arbeitszeitgesetzes für den jeweiligen Einsatz im
          Kundenbetrieb umgesetzt werden. Die Beschäftigung des Zeitarbeitnehmers über 10 Stunden pro Werktag hinaus, bedarf
          der Absprache mit dem Personaldienstleister. Über werktägliche 10 Stunden hinaus darf nur gearbeitet werden, wenn
          ein Tarifvertrag oder eine Betriebsvereinbarung aufgrund eines Tarifvertrags des Kunden gemäß § 7 Arbeitszeitgesetz
          oder eine behördliche Genehmigung dies zulässigerweise vorsieht oder ein außergewöhnlicher Fall im Sinne des § 14
          Arbeitszeitgesetz gegeben ist.
        </Text>
        <Text style={rlStyles.p}>
          (6) Im Falle von Sonn- oder Feiertagsarbeit stellt der Auftraggeber dem Personaldienstleister einen Nachweis
          darüber zur Verfügung, aus dem sich ergibt, dass eine Berechtigung zur Anordnung von Sonn- bzw. Feiertagsarbeit besteht.
        </Text>

        <Text style={rlStyles.pageNumber}>6</Text>
      </Page>

      {/* ================= PAGE 7 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <Text style={rlStyles.sectionTitle}>§ 10 Haftung / Aufrechnung / Weitergabe von Daten an Dritte</Text>
        <Text style={rlStyles.p}>
          (1) Im Hinblick darauf, dass der Zeitarbeitnehmer unter Leitung und Aufsicht des Auftraggebers seine Tätigkeit ausübt,
          haftet der Personaldienstleister nicht für Schäden, die der Zeitarbeitnehmer in Ausübung oder anlässlich seiner
          Tätigkeit verursacht. Der Auftraggeber stellt den Personaldienstleister von allen etwaigen Ansprüchen frei, die
          Dritte im Zusammenhang mit der Ausführung und Verrichtung der dem Zeitarbeitnehmer übertragenen Tätigkeit erheben sollten.
        </Text>
        <Text style={rlStyles.p}>
          (2) Im Übrigen ist die Haftung des Personaldienstleisters sowie seiner gesetzlichen Vertreter und Erfüllungsgehilfen
          auf Vorsatz und grobe Fahrlässigkeit beschränkt. Diese Haftungsbeschränkung gilt nicht für Schäden, die auf einer
          Verletzung des Lebens, des Körpers oder der Gesundheit beruhen. Das betrifft sowohl gesetzliche als auch vertragliche
          Haftungstatbestände, insbesondere Fälle im Falle des Verzuges, der Unmöglichkeit, des Unvermögens, der Pflichtverletzung
          oder der unerlaubten Handlung. Namentlich haftet der Personaldienstleister nicht für Arbeitsergebnisse der Zeitarbeitnehmer
          oder Schäden, die diese in Ausübung oder anlässlich ihrer Tätigkeit verursachen oder die dem Auftraggeber durch
          Unpünktlichkeit oder Abwesenheit der Zeitarbeitnehmer entstehen. Bei Vorsatz oder grober Fahrlässigkeit einfacher
          Erfüllungsgehilfen haftet der Personaldienstleister darüber hinaus nur für vorhersehbare Schäden.
        </Text>
        <Text style={rlStyles.p}>
          (3) Der Auftraggeber stellt den Personaldienstleister von allen Forderungen frei, die dem Personaldienstleister aus
          einer Verletzung des Auftraggebers der sich aus diesem Vertrag ergebenden Zusicherungen und Verpflichtungen (z.B.
          Prüf- und Mitteilungspflichten) erwachsen.
        </Text>
        <Text style={rlStyles.p}>
          (4) Der Auftraggeber ist nicht berechtigt, gegenüber Forderungen des Personaldienstleisters aufzurechnen oder ein
          Zurückbehaltungsrecht geltend zu machen, es sei denn, die vom Auftraggeber geltend gemachte Gegenforderung ist
          unbestritten oder rechtskräftig festgestellt.
        </Text>
        <Text style={rlStyles.p}>
          (5) Der Auftraggeber verpflichtet sich, seitens des Personaldienstleisters übermittelte Daten nur in dem vereinbarten
          Umfange zu nutzen, insbesondere diese nicht ohne Einverständnis des Personaldienstleisters an Dritte weiterzuleiten.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 11 Übernahme von Mitarbeitern / Vermittlung / Provision</Text>
        <Text style={rlStyles.p}>
          (1) Eine Vermittlung liegt vor, wenn der Auftraggeber oder ein mit ihm rechtlich oder wirtschaftlich verbundenes
          Unternehmen während der Dauer des Arbeitnehmerüberlassungsvertrages mit dem Arbeitnehmer des Personaldienstleisters
          ein Arbeitsverhältnis eingeht. Eine Vermittlung liegt auch dann vor, wenn der Auftraggeber oder ein mit ihm rechtlich
          oder wirtschaftlich verbundenes Unternehmen innerhalb von 6 Monaten nach Beendigung der Überlassung, höchstens aber
          12 Monate nach Beginn der Überlassung, mit dem Zeitarbeitnehmer ein Arbeitsverhältnis eingeht. Dem Auftraggeber bleibt
          in diesem Fall der Nachweis vorbehalten, dass der Abschluss des Arbeitsverhältnisses nicht aufgrund der vorangegangenen
          Überlassung erfolgt ist.
        </Text>
        <Text style={rlStyles.p}>
          (2) Eine Vermittlung liegt ebenfalls vor, wenn der Auftraggeber oder ein mit ihm rechtlich oder wirtschaftlich
          verbundenes Unternehmen direkt nach der Herstellung des Kontaktes zu dem Bewerber durch den Personaldienstleister
          ohne eine vorherige Überlassung ein Arbeitsverhältnis eingeht.
        </Text>
        <Text style={rlStyles.p}>
          (3) Maßgebend für den Zeitpunkt der Begründung des Arbeitsverhältnisses zwischen dem Auftraggeber und dem
          Zeitarbeitnehmer ist nicht der Zeitpunkt der Arbeitsaufnahme, sondern der Zeitpunkt des Abschlusses des Arbeitsvertrages.
        </Text>
        <Text style={rlStyles.p}>
          (4) Der Auftraggeber ist verpflichtet, dem Personaldienstleiter mitzuteilen, ob und wann ein Arbeitsvertrag abgeschlossen
          wurde. Wenn im Streitfall der Personaldienstleister Indizien für den Bestand eines Arbeitsverhältnisses zwischen dem
          Auftraggeber und dem Zeitarbeitnehmer darlegt, trägt der Auftraggeber die Beweislast dafür, dass ein Arbeitsverhältnis
          nicht eingegangen wurde.
        </Text>

        <Text style={rlStyles.pageNumber}>7</Text>
      </Page>

      {/* ================= PAGE 8 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <Text style={rlStyles.p}>
          (5) In den in den Absätzen 1 und 2 genannten Fällen hat der Auftraggeber eine Vermittlungsprovision an den
          Personaldienstleister zu zahlen. Befristete Arbeitsverhältnisse sind im gleichen Umfang provisionspflichtig wie
          unbefristete Arbeitsverhältnisse. Die Höhe der Vermittlungsprovision beträgt bei direkter Übernahme des
          Zeitarbeitnehmers ohne vorherige Überlassung 2,5 Bruttomonatsgehälter. Im Übrigen beträgt die Vermittlungsprovision
          im Falle einer Übernahme innerhalb der ersten 3 Monate nach Beginn der Überlassung 2 Bruttomonatsgehälter, bei
          einer Übernahme innerhalb des 4. bis 6. Monats nach Beginn der Überlassung 1,5 Bruttomonatsgehälter, bei einer
          Übernahme innerhalb des 7. bis 9. Monats 1 Bruttomonatsgehalt und bei einer Übernahme innerhalb des 10. bis 12.
          Monats nach Beginn der Überlassung 0,5 Bruttomonatsgehälter.
        </Text>
        <Text style={rlStyles.p}>
          (6) Berechnungsgrundlage der Vermittlungsprovision ist das zwischen dem Auftraggeber und dem Zeitarbeitnehmer
          vereinbarte Bruttomonatsgehalt, mindestens aber das zwischen dem Personaldienstleister und dem Zeitarbeitnehmer
          vereinbarte Bruttomonatsgehalt. Der Auftraggeber legt dem Personaldienstleister eine Kopie des unterschriebenen
          Arbeitsvertrages vor. Bei Unterbrechungen in der Überlassung ist der Beginn der letzten Überlassung vor Begründung
          des Arbeitsverhältnisses maßgeblich. Die Vermittlungsprovision ist zzgl. der gesetzlichen Mehrwertsteuer zu zahlen.
          Die Provision ist zahlbar 14 Tage nach Eingang der Rechnung.
        </Text>
        <Text style={rlStyles.p}>
          (7) Wird der Mitarbeiter aufgrund eines freien Mitarbeitervertrages bzw. eines Vertrages mit einem Selbständigen
          für den Auftraggeber tätig, gelten die vorstehenden Bestimmungen entsprechend mit der Maßgabe, dass anstatt des
          Bruttomonatsgehaltes das zwischen dem Auftraggeber und dem Mitarbeiter vereinbarte monatliche Honorar die Basis der
          Berechnungsgrundlage bildet.
        </Text>
        <Text style={rlStyles.p}>
          (8) Die vorstehenden Bestimmungen gelten auch im Falle der Vermittlung des Arbeitnehmers in ein Ausbildungsverhältnis
          mit dem Auftraggeber. Berechnungsgrundlage der Vermittlungsprovision ist in diesem Falle die zwischen dem Auftraggeber
          und dem Zeitarbeitnehmer vereinbarte Bruttoausbildungsvergütung, mindestens aber das zwischen dem Personaldienstleister
          und dem Zeitarbeitnehmer zuletzt vereinbarte Bruttomonatsgehalt.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 12 Dauer des Vertrages / Kündigung</Text>
        <Text style={rlStyles.p}>
          (1) Der Arbeitnehmerüberlassungsvertrag wird zunächst befristet bis zum {contractEndDate}.
        </Text>
        <Text style={rlStyles.p}>
          (2) Der Arbeitnehmerüberlassungsvertrag kann ordentlich mit einer Frist von einer Woche gekündigt werden.
        </Text>
        <Text style={rlStyles.p}>
          (3) Der Vertrag kann außerordentlich mit einer Frist von einer Woche gekündigt werden. Ein Grund für eine
          außerordentliche Kündigung im Sinne von Satz 1 liegt vor, wenn eine Preisanpassung nach Maßgabe von § 5 Absatz 7
          vom Auftraggeber nicht akzeptiert wird. Als weitere Gründe kommen insbesondere Verstöße gegen Zusicherungen und
          Verpflichtungen im Sinne von § 10 Absatz 3 in Betracht.
        </Text>
        <Text style={rlStyles.p}>
          (4) Kündigungen bedürfen in jedem Falle der Textform.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 13 Gerichtsstand</Text>
        <Text style={rlStyles.p}>
          Gerichtsstand für alle Rechtsstreitigkeiten, die im Zusammenhang mit diesem Vertrag entstehen, ist der
          Hauptsitz des Personaldienstleisters in Bonn.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 14 Allgemeine Geschäftsbedingungen</Text>
        <Text style={[rlStyles.p, { fontFamily: "Helvetica-Bold", marginBottom: 6 }]}>
          (1) Bitte Zutreffendes ankreuzen:
        </Text>

        <Text style={rlStyles.pageNumber}>8</Text>
      </Page>

      {/* ================= PAGE 9 ================= */}
      <Page size="A4" style={rlStyles.page}>
        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare}>
            <Text style={rlStyles.checkboxMark}>X</Text>
          </View>
          <Text style={rlStyles.checkboxLabel}>
            Es finden keine weitergehenden Allgemeinen Geschäftsbedingungen auf diesen Vertrag Anwendung.
          </Text>
        </View>

        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare} />
          <Text style={rlStyles.checkboxLabel}>
            Es gelten die umseitig abgedruckten Allgemeinen Geschäftsbedingungen des Personaldienstleisters.
          </Text>
        </View>

        <View style={rlStyles.checkboxRow}>
          <View style={rlStyles.checkboxSquare} />
          <Text style={rlStyles.checkboxLabel}>
            Es gelten die Allgemeinen Geschäftsbedingungen des Personaldienstleisters mit Stand vom [Datum], abrufbar unter [Link].
          </Text>
        </View>

        <Text style={[rlStyles.p, { marginTop: 6 }]}>
          (2) Die Allgemeinen Geschäftsbedingungen des Auftraggebers werden ausgeschlossen, soweit sie mit den Regelungen
          dieses Vertrages und/oder den Allgemeinen Geschäftsbedingungen des Personaldienstleisters nicht übereinstimmen
          bzw. vom Personaldienstleister nicht ausdrücklich in Textform bestätigt werden.
        </Text>

        <Text style={rlStyles.sectionTitle}>§ 15 Textform / Vertretung / Salvatorische Klausel</Text>
        <Text style={rlStyles.p}>
          (1) Gemäß § 12 Absatz 1 Satz 1 AÜG bedarf dieser Vertrag der Textform (§ 126b BGB). Auch Änderungen und / oder
          Ergänzungen bedürfen der Textform. Mündliche Nebenabreden bestehen nicht.
        </Text>
        <Text style={rlStyles.p}>
          (2) Die mit dem Zusatz „Personaldisponent“ zeichnenden Angestellten des Personaldienstleisters sind zum Abschluss
          von Arbeitnehmerüberlassungsverträgen befugt.
        </Text>
        <Text style={rlStyles.p}>
          (3) Sollte eine Bestimmung dieser Vereinbarung unwirksam sein oder werden, wird die Wirksamkeit der übrigen
          Bestimmungen hiervon nicht berührt. Die Parteien verpflichten sich, die unwirksame Bestimmung durch eine dieser
          in Interessenlage und Bedeutung möglichst nahe kommenden wirksamen Vereinbarung zu ersetzen.
        </Text>

        {/* SIGNATURE AREA */}
        <View style={rlStyles.signatureSection}>
          <View style={rlStyles.signatureBlock}>
            {data.signatureData ? (
              <Image src={data.signatureData} style={rlStyles.sigImage} />
            ) : (
              <View style={{ height: 35 }} />
            )}
            <View style={rlStyles.sigLine}>
              <Text style={rlStyles.sigText}>
                {data.signedAt ? `${data.signedAt}` : "[Datum und Ort]"}, {data.facilityName} (Auftraggeber)
              </Text>
              {data.ipAddress && (
                <Text style={{ fontSize: 7, color: "#6b7280", marginTop: 2 }}>
                  Elektronisch gezeichnet (IP: {data.ipAddress}, Zeit: {data.signedAt})
                </Text>
              )}
            </View>
          </View>

          <View style={[rlStyles.signatureBlock, { marginTop: 20 }]}>
            {data.stampDataUrl ? (
              <Image src={data.stampDataUrl} style={rlStyles.stampImage} />
            ) : (
              <View style={{ height: 35 }} />
            )}
            <View style={rlStyles.sigLine}>
              <Text style={rlStyles.sigText}>
                {data.signedAt ? `${data.signedAt}` : "[Datum und Ort]"}, {companyConfig.name}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 25, borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 8 }}>
          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold" }}>
            Anhang 1: Fragebogen zur Ermittlung von Equal Pay
          </Text>
        </View>

        <Text style={rlStyles.pageNumber}>9</Text>
      </Page>
    </Document>
  );
};

export async function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  const companyConfig = await getCompanyConfig();
  const isRheinland = (companyConfig.shortName || "").toLowerCase().includes("rheinland") ||
                      (companyConfig.name || "").toLowerCase().includes("rheinland");

  if (isRheinland) {
    return Buffer.from(await renderToBuffer(<RheinlandContractDocument companyConfig={companyConfig} data={data} />));
  }

  return Buffer.from(await renderToBuffer(<OriginalAuegContractTemplate companyConfig={companyConfig} data={data} />));
}
