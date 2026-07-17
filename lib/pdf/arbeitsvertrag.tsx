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
  weeklyHours: number | null;
  monthlySalary: number | null;
  entgeltgruppe: string | null;
  hourlyRate: number;
  createdAt: Date;
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#000", fontFamily: "Helvetica", lineHeight: 1.3 },
  headerRight: { fontSize: 8, textAlign: "right", marginBottom: 20 },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  paragraph: { marginBottom: 6, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  highlight: { backgroundColor: "#d1d5db" },
  list: { marginLeft: 16, marginBottom: 6 },
  listItem: { marginBottom: 2, flexDirection: "row" },
  bullet: { width: 12 },
  signatureContainer: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  signatureBox: { borderTopWidth: 1, borderTopColor: "#000", paddingTop: 8, width: 200, fontSize: 10 },
  checkbox: { width: 10, height: 10, borderWidth: 1, borderColor: "#000", marginRight: 6 },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 4 }
});

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
  const startDateStr = data.startDate ? format(data.startDate, "dd.MM.yyyy") : "___.___.____";
  const endDateStr = data.endDate ? format(data.endDate, "dd.MM.yyyy") : "___.___.____";
  const isUnbefristet = data.contractType === "unbefristet";
  const isBefristet = data.contractType === "befristet";
  const qualText = getQualificationText(data.qualification);
  const monthlySalaryStr = data.monthlySalary ? data.monthlySalary.toFixed(2).replace(".", ",") : "________";
  const weeklyHoursStr = data.weeklyHours ? data.weeklyHours.toFixed(2).replace(".", ",") : "________";
  const monthlyHoursStr = data.requiredHours ? data.requiredHours.toFixed(2).replace(".", ",") : "________";
  const entgeltgruppeStr = data.entgeltgruppe || "________";
  
  // Basic address splitting
  const addressParts = data.address ? data.address.split(",") : ["Adresse unbekannt"];
  const street = addressParts[0]?.trim();
  const plzOrt = addressParts[1]?.trim() || "";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.headerRight}>Stand: 17.02.2020 1</Text>
        
        <View style={{ marginBottom: 16 }}>
          <Text style={styles.paragraph}>Zwischen</Text>
          <Text style={[styles.paragraph, styles.highlight]}>RheinAhr Dienstleistungen GmbH</Text>
          <Text style={[styles.paragraph, styles.highlight]}>Theaterplatz 1</Text>
          <Text style={[styles.paragraph, styles.highlight]}>53177 Bonn</Text>
          <Text style={styles.paragraph}>- nachstehend Arbeitgeber genannt -</Text>
          
          <Text style={styles.paragraph}>und</Text>
          
          <Text style={[styles.paragraph, styles.highlight]}>{data.fullName}</Text>
          <Text style={[styles.paragraph, styles.highlight]}>{street}</Text>
          <Text style={[styles.paragraph, styles.highlight]}>{plzOrt}</Text>
          <Text style={styles.paragraph}>- nachstehend Mitarbeiter genannt -</Text>
          
          <Text style={styles.paragraph}>wird folgender Arbeitsvertrag geschlossen.</Text>
          <Text style={styles.paragraph}>
            Die in diesem Vertragstext verwendete Bezeichnung „Mitarbeiter“ umfasst weibliche und männliche Beschäftigte. Sie wird ausschließlich aus Gründen der besseren Lesbarkeit verwendet.
          </Text>
        </View>

        <Text style={styles.h2}>§ 1 Inhalt / Einbeziehung der Tarifverträge</Text>
        <Text style={styles.paragraph}>
          (1) Der Arbeitgeber überlässt als Personaldienstleistungsunternehmen seinen Kunden Beschäftigte im Rahmen der Arbeitnehmerüberlassung. Der Arbeitgeber besitzt eine befristete Erlaubnis zur Arbeitnehmerüberlassung, zuletzt erteilt von der Bundesagentur für Arbeit, Agentur für Arbeit Düsseldorf, am 02.03.2018 in Düsseldorf.
        </Text>
        <Text style={styles.paragraph}>
          Der Mitarbeiter wird an wechselnden Einsatzstellen bei Kunden und bei wechselnden Kunden eingesetzt. Der Einsatz bei einem Kunden erfolgt vorübergehend. Der Arbeitgeber informiert den Mitarbeiter vor jeder Überlassung darüber, dass er als Zeitarbeitnehmer tätig wird. Der Mitarbeiter kann auch im Rahmen von Werk- oder Dienstverträgen eingesetzt werden.
        </Text>
        <Text style={styles.paragraph}>
          (2) Die Rechte und Pflichten der Arbeitsvertragsparteien bestimmen sich nach den Tarifverträgen in der jeweils gültigen Fassung, die der Arbeitgeberverband iGZ mit einer oder mehreren der Gewerkschaften IG BCE, NGG, IG Metall, GEW, ver.di, IG Bau, GdP, EVG abgeschlossen hat oder zukünftig abschließen wird. Die Tarifverträge liegen zur Einsichtnahme in den Geschäftsräumen aus. Es finden dabei nicht sämtliche vom iGZ abgeschlossenen Tarifverträge gleichzeitig auf das Arbeitsverhältnis Anwendung, sondern nur die einschlägigen Tarifverträge nach der in den Absätzen 3 bis 5 genannten Maßgabe.
        </Text>
        <Text style={styles.paragraph}>
          (3) Es finden jeweils diejenigen der in Absatz 2 genannten Tarifverträge Anwendung, an denen die Gewerkschaft, aus deren Satzung sich die Zuständigkeit für den zugewiesenen Kundenbetrieb ergibt, als Vertragspartei beteiligt ist. Soweit nach dem Vorstehenden die satzungsgemäße Zuständigkeit mehrerer Gewerkschaften begründet ist, finden die Tarifverträge mit derjenigen in Absatz 2 genannten zuständigen Gewerkschaft Anwendung, die im Verhältnis zu der oder den anderen zuständigen Gewerkschaft/Gewerkschaften in Absatz 2 zuerst genannt wird.
        </Text>
        <Text style={styles.paragraph}>
          (4) Bis zum Beginn des ersten Einsatzes finden diejenigen mit dem iGZ abgeschlossenen Tarifverträge Anwendung, an denen ver.di als Vertragspartei beteiligt ist. Ab Beginn des ersten Einsatzes gelten diejenigen nach Maßgabe des Absatzes 3 ermittelten Tarifverträge solange, bis ein anderer Einsatz beginnt.
        </Text>
        <Text style={styles.paragraph}>
          (5) Soweit der Arbeitnehmer an einen Kundenbetrieb überlassen wird, für den sich keine satzungsgemäße Zuständigkeit für den jeweiligen Kundenbetrieb ergibt, finden diejenigen mit dem iGZ abgeschlossenen Tarifverträge Anwendung, an denen ver.di als Vertragspartei beteiligt ist.
        </Text>

        <Text style={styles.h2}>§ 2 Beginn / Probezeit / Dauer</Text>
        <Text style={styles.paragraph}>
          (1) Das Arbeitsverhältnis beginnt am {startDateStr}
        </Text>
        <Text style={styles.paragraph}>
          Es ist eine Probezeit von 6 Monaten gemäß § 2.2. Manteltarifvertrag iGZ mit den dort genannten Kündigungsfristen vereinbart. Probezeiten und Kündigungsfristen gelten gleichermaßen bei einer Befristung dieses Arbeitsverhältnisses.
        </Text>
        <Text style={styles.paragraph}>
          Erscheint der Mitarbeiter am ersten Arbeitstag nicht und benachrichtigt den Arbeitgeber nicht unverzüglich über die Verhinderung am ersten Arbeitstag, so gilt das Arbeitsverhältnis als nicht zustande gekommen (§ 2.1. Manteltarifvertrag iGZ).
        </Text>
        <Text style={styles.paragraph}>
          (2) Die Parteien vereinbaren, dass
        </Text>
        
        <View style={styles.list}>
          <View style={styles.checkboxRow}>
            <View style={[styles.checkbox, isUnbefristet ? styles.checkboxChecked : {}]} />
            <Text style={{ flex: 1 }}>das Arbeitsverhältnis unbefristet abgeschlossen wird.</Text>
          </View>
          <View style={styles.checkboxRow}>
            <View style={[styles.checkbox, isBefristet ? styles.checkboxChecked : {}]} />
            <Text style={{ flex: 1 }}>das Arbeitsverhältnis gemäß § 14 Absatz 2 Teilzeit- und Befristungsgesetz befristet (reguläre Befristung) wird. Es endet am {endDateStr}. Der Mitarbeiter bestätigt, dass in den letzten drei Jahren vor Beginn dieses Arbeitsverhältnisses noch kein Arbeitsverhältnis zwischen den Vertragsparteien bestanden hat.</Text>
          </View>
          <View style={styles.checkboxRow}>
            <View style={styles.checkbox} />
            <Text style={{ flex: 1 }}>das Arbeitsverhältnis gemäß § 14 Absatz 2a Teilzeit- und Befristungsgesetz befristet (bis zu 4 Jahre nach Neugründung eines Unternehmens) wird. Es endet am _________.</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.headerRight}>Stand: 17.02.2020 2</Text>

        <Text style={styles.paragraph}>
          (Befristung mit Sachgrund) wird. Das Arbeitsverhältnis endet mit Erreichung des Zwecks, frühestens aber 14 Tage nach Mitteilung der Zweckerreichung durch den Arbeitgeber, ohne dass es einer Kündigung bedarf.
        </Text>
        <View style={styles.checkboxRow}>
          <View style={styles.checkbox} />
          <Text style={{ flex: 1 }}>das Arbeitsverhältnis auf Wunsch des Mitarbeiters [z.B. Studium] nach § 14 Absatz 1 Satz 2 Nr. 6 Teilzeit- und Befristungsgesetz befristet abgeschlossen wird. Es endet am _________. Die Gründe für die gewünschte Befristung sind der beigefügten Erklärung des Mitarbeiters zu entnehmen.</Text>
        </View>

        <Text style={styles.h2}>§ 3 Tätigkeit / Pflichten des Mitarbeiters</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter wird entsprechend der Tätigkeit im Kundenbetrieb eingestellt als <Text style={styles.highlight}>{qualText}</Text>. Dem Mitarbeiter obliegen z.B. folgenden Tätigkeiten: <Text style={styles.highlight}>{qualText}</Text>.
        </Text>
        <Text style={styles.paragraph}>
          Aus der Einsatzanweisung vor Beginn des Einsatzes in einem Kundenbetrieb können sich abweichende oder ergänzende Tätigkeiten ergeben.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter wird an verschiedenen Einsatzorten im Gebiet <Text style={styles.highlight}>Bonn und im Umkreis bis zu 100 km</Text> bei Kundenbetrieben beschäftigt. Er ist bei Bedarf auch zur Arbeitsleistung an Einsatzorten außerhalb des Kundenbetriebes verpflichtet. Der Arbeitgeber ist berechtigt, den Mitarbeiter jederzeit vom Kundeneinsatz abzuberufen und anderweitig einzusetzen.
        </Text>
        <Text style={styles.paragraph}>
          (3) Dem Mitarbeiter können auch interne Tätigkeiten im Betrieb des Arbeitgebers zugewiesen werden (kein Drittpersonaleinsatz). Eine Verringerung des Vergütungsanspruchs tritt dadurch nicht ein. Die Zuweisung von internen Tätigkeiten darf einen ununterbrochenen Zeitraum von vier Wochen nicht überschreiten.
        </Text>
        <Text style={styles.paragraph}>
          (4) Der Mitarbeiter hat sich die geleisteten Arbeitsstunden pro Kunde und Kalenderwoche vom Kunden bestätigen zu lassen. Der Nachweis kann über eine elektronische Arbeitszeiterfassung beim Kunden oder über die vom Arbeitgeber ausgehändigten Tätigkeitsnachweise erfolgen. Die unterschriebenen Tätigkeitsnachweise oder der Auszug der elektronisch erfassten Arbeitsstunden sind umgehend, jeweils wöchentlich beim Arbeitgeber einzureichen.
        </Text>

        <Text style={styles.h2}>§ 4 Arbeitszeit / Mehrarbeit / Arbeitszeitkonto</Text>
        <Text style={styles.paragraph}>
          (1) Es wird auf die Regelungen zur Arbeitszeit in § 3.1. Manteltarifvertrag iGZ verwiesen.
        </Text>
        
        <View style={styles.list}>
          <View style={styles.checkboxRow}>
            <View style={[styles.checkbox, styles.checkboxChecked]} />
            <Text style={{ flex: 1 }}>Der Mitarbeiter arbeitet in Vollzeit. Die Vertragsparteien vereinbaren eine individuelle regelmäßige monatliche Arbeitszeit gemäß § 3.1.1. Manteltarifvertrag iGZ, die <Text style={styles.highlight}>_{monthlyHoursStr}_</Text> Stunden beträgt. Dies entspricht einer durchschnittlichen wöchentlichen Arbeitszeit von <Text style={styles.highlight}>_{weeklyHoursStr}_</Text> Stunden.</Text>
          </View>
          <View style={styles.checkboxRow}>
            <View style={styles.checkbox} />
            <Text style={{ flex: 1 }}>Der Mitarbeiter arbeitet in Vollzeit. Die Vertragsparteien vereinbaren eine individuelle regelmäßige Arbeitszeit pro Monat gemäß § 3.1.2. Manteltarifvertrag iGZ, die sich nach der Anzahl der Arbeitstage richtet.</Text>
          </View>
          <View style={styles.checkboxRow}>
            <View style={styles.checkbox} />
            <Text style={{ flex: 1 }}>Der Mitarbeiter arbeitet in Teilzeit. Die Vertragsparteien vereinbaren eine individuelle regelmäßige monatliche Arbeitszeit gemäß § 3.1.1. Manteltarifvertrag iGZ von ______ Stunden.</Text>
          </View>
        </View>

        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter verpflichtet sich im Rahmen des gesetzlich Zulässigen Überstunden und Mehrarbeit zu leisten.
        </Text>
        <Text style={styles.paragraph}>
          (3) Der Arbeitgeber richtet für den Mitarbeiter gemäß § 3.2. Manteltarifvertrag iGZ ein Arbeitszeitkonto ein.
        </Text>

        <Text style={styles.h2}>§ 5 Vergütung und Fälligkeit / Aufwendungsersatz</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter wird gemäß §§ 2 Absatz 1, 3 Entgeltrahmentarifvertrag iGZ eingruppiert in die Entgeltgruppe <Text style={styles.highlight}>{entgeltgruppeStr}</Text>.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter erhält ein <Text style={styles.bold}>tarifliches Entgelt</Text>, dessen Höhe sich nach § 2 Entgelttarifvertrag iGZ in Verbindung mit §§ 4,5 Entgeltrahmentarifvertrag iGZ bemisst. Es beträgt derzeit:
        </Text>
        <Text style={[styles.paragraph, styles.highlight, { marginLeft: 16 }]}>
          _{monthlySalaryStr}__ € Brutto/ Monat
        </Text>
        <Text style={styles.paragraph}>
          (3) Wird der Mitarbeiter in Betriebe in den neuen Bundesländern Mecklenburg-Vorpommern, Brandenburg, Berlin, Sachsen-Anhalt, Thüringen und Sachsen überlassen, richten sich die Entgelte nach den Entgelttabellen Ost (§ 3 Entgelttarifvertrag iGZ). Für das Mindeststundenentgelt nach § 3 Nr. 1 des Tarifvertrags zur Regelung von Mindeststundenentgelten in der Zeitarbeit gilt das Mindeststundenentgelt des Arbeitsorts. Wird der Mitarbeiter auswärtig beschäftigt, behält er jedoch den Anspruch auf das Mindeststundenentgelt seines Einstellungsortes, soweit dieses höher ist.
        </Text>
        <Text style={styles.paragraph}>
          (4) Ein Anspruch auf Branchenzuschläge ergibt sich nach den jeweils geltenden Tarifverträgen über Branchenzuschläge für Arbeitnehmerüberlassungen.
        </Text>
        <Text style={styles.paragraph}>
          (5) Das tarifliche Entgelt erhält der Mitarbeiter auch für Zeiten, in denen er nicht verliehen ist (Nachweis gemäß § 11 Absatz 1 Satz 2 Nr. 2 AÜG). In diesen Zeiten besteht kein Anspruch auf Branchenzuschlag. Der Mitarbeiter muss montags bis freitags, morgens von <Text style={styles.highlight}>6:00</Text> Uhr bis <Text style={styles.highlight}>07:00</Text> Uhr und nachmittags von <Text style={styles.highlight}>13:00</Text> Uhr bis <Text style={styles.highlight}>13:30</Text> Uhr telefonisch erreichbar sein (höchstens 2 x 1,5 Stunden pro Tag), um sich Einsätze zuweisen zu lassen.
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.headerRight}>Stand: 17.02.2020 3</Text>

        <Text style={styles.paragraph}>
          (6) Ein Anspruch auf Zuschläge, die in Abhängigkeit von der Dauer oder der Lage der Arbeitszeit geleistet werden, richtet sich insbesondere nach § 4 Manteltarifvertrag iGZ. Ein Anspruch auf eine einsatzbezogene Zulage richtet sich nach § 5 Entgeltrahmentarifvertrag iGZ, ein Anspruch auf Jahressonderzahlungen nach § 8 Manteltarifvertrag iGZ.
        </Text>
        <Text style={styles.paragraph}>
          (7) Die Vergütung ist auf ein vom Mitarbeiter anzugebendes Konto zu überweisen. Die Fälligkeit richtet sich nach § 11 Manteltarifvertrag iGZ.
        </Text>
        <Text style={styles.paragraph}>
          (8) Der Anspruch auf Aufwendungsersatz bestimmt sich nach § 670 BGB. Es können für jeden Einsatz gesonderte Vereinbarungen getroffen werden.
        </Text>

        <Text style={styles.h2}>§ 6 Anrechnungsvorbehalt</Text>
        <Text style={styles.paragraph}>
          Über- und außertarifliche Zulagen mindern sich, ohne dass es einer entsprechenden Erklärung des Arbeitgebers bedarf, um den Betrag einer etwaigen zukünftigen oder rückwirkenden Erhöhung des tariflichen Entgelts (Anspruch auf einsatzbezogene Zulage, Erhöhung als Ergebnis von Tarifverhandlungen, auch im Falle von Einmalzahlungen, Wechsel des Einsatzgebiets, Anspruch auf Branchenzuschlag, Höhergruppierung). Im Falle einer rückwirkenden Erhöhung des tariflichen Entgelts mindert sich die übertarifliche Zulage rückwirkend auf den Zeitpunkt der Erhöhung.
        </Text>

        <Text style={styles.h2}>§ 7 Widerrufsvorbehalt</Text>
        <Text style={styles.paragraph}>
          (1) Die Vertragsparteien vereinbaren, dass über- und außertarifliche Zulagen als widerrufliche Leistungen des Arbeitgebers erbracht werden. Das Widerrufsrecht besteht auch für über- und außertarifliche Zulagen, die befristet auf einen bestimmten Einsatz bei einem Kundenunternehmen gezahlt werden. Ein Widerruf entfaltet sofortige Wirkung. Der widerrufliche Teil ist begrenzt auf 24,9% der Gesamtvergütung.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Arbeitgeber ist zum Widerruf einer über- und außertariflichen Zulage aus betriebsbedingten Gründen berechtigt. Als Gründe kommen insbesondere starke wirtschaftliche Verluste, unrentabel hohe Betriebskosten, der Wegfall des Interesses, bestimmte Mitarbeitergruppen mit einer über- und außertariflichen Zulage an das Unternehmen zu binden, die Gefährdung der wirtschaftlichen Bestandsfähigkeit des Unternehmens, oder eine Massenentlassung im Sinne von § 17 KSchG in Betracht.
        </Text>
        <Text style={styles.paragraph}>
          (3) Über- und außertarifliche Zulagen dürfen auch aus verhaltensbedingten Gründen widerrufen werden, wenn der Mitarbeiter mindestens zwei berechtigte Abmahnungen innerhalb von sechs Monaten vor Ausspruch der Widerrufserklärung erhalten hat. Als Widerrufsgründe kommen auch mangelnde Eignung oder eine erhebliche Leistungsminderung in Betracht.
        </Text>

        <Text style={styles.h2}>§ 8 Urlaub / Urlaubsentgelt</Text>
        <Text style={styles.paragraph}>
          Es wird auf die Urlaubsregelung in § 6 Manteltarifvertrag iGZ verwiesen. Das Urlaubsentgelt richtet sich nach § 6a Manteltarifvertrag iGZ.
        </Text>

        <Text style={styles.h2}>§ 9 Lohnverpfändung und Lohnabtretung</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter darf seine Vergütungsansprüche weder verpfänden noch abtreten.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Arbeitgeber behält sich vor, nachträglich vertragswidrig vorgenommene Abtretungen oder Verpfändungen zu genehmigen.
        </Text>
        <Text style={styles.paragraph}>
          (3) Die Kosten, die dem Arbeitgeber durch die Bearbeitung von Pfändungen, Verpfändungen und Abtretungen der Vergütungsansprüche des Mitarbeiters entstehen, trägt der Mitarbeiter. Diese Kosten werden pauschaliert mit 8,- € pro Pfändung, Abtretung und Verpfändung sowie gegebenenfalls zusätzlich 4,- € für jedes Schreiben sowie 1,- € pro Überweisung. Dem Mitarbeiter bleibt der Nachweis vorbehalten, dass ein Schaden nicht vorliegt oder wesentlich geringer ist. Bei Nachweis höherer tatsächlicher Kosten ist der Arbeitgeber berechtigt, diese in Ansatz zu bringen. Mit diesen Kosten kann der Arbeitgeber unter Berücksichtigung der Pfändungsfreigrenzen mit Lohnforderungen aufrechnen.
        </Text>

        <Text style={styles.h2}>§ 10 Arbeitsverhinderung / Entgeltfortzahlung im Krankheitsfall</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter ist verpflichtet, dem Arbeitgeber jede Dienstverhinderung unverzüglich (ohne schuldhaftes Zögern), möglichst jedoch vor Arbeitsbeginn während der betrieblichen Geschäftszeiten, sowie die voraussichtliche Dauer anzuzeigen. Auf Verlangen sind die Gründe der Dienstverhinderung mitzuteilen; dies gilt nicht für den Grund einer Arbeitsunfähigkeit.
        </Text>
        <Text style={styles.paragraph}>
          (2) Der Mitarbeiter ist verpflichtet, für den ersten Tag einer Arbeitsunfähigkeit am gleichen Tag, bei Unzumutbarkeit spätestens am darauf folgenden Kalendertag (außer arbeitsfreie Sonn- und Feiertage), eine ärztliche Bescheinigung über das Bestehen der Arbeitsunfähigkeit sowie deren voraussichtliche Dauer vorzulegen. Dauert die Arbeitsunfähigkeit länger als in der Bescheinigung angegeben, so hat der Mitarbeiter umgehend eine neue Bescheinigung vorzulegen.
        </Text>
        <Text style={styles.paragraph}>
          (3) Die Entgeltfortzahlung im Krankheitsfall richtet sich nach § 6a Manteltarifvertrag iGZ.
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.headerRight}>Stand: 17.02.2020 4</Text>

        <Text style={styles.h2}>§ 11 Verschwiegenheitsverpflichtung</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter verpflichtet sich, über alle Betriebs- und Geschäftsgeheimnisse, sowohl während der Dauer des Arbeitsverhältnisses als auch nach seiner Beendigung Stillschweigen zu bewahren. Die Geheimhaltungspflicht erstreckt sich nicht auf solche Kenntnisse, die jedermann zugänglich sind oder deren Weitergabe für den Arbeitgeber ersichtlich ohne Nachteil ist. Im Zweifelsfalle sind jedoch technische, kaufmännische und persönliche Vorgänge und Verhältnisse, die dem Mitarbeiter im Zusammenhang mit seiner Tätigkeit bekannt werden, als Unternehmensgeheimnisse zu behandeln. In solchen Fällen ist der Mitarbeiter vor der Offenbarung gegenüber Dritten verpflichtet, eine Weisung der Geschäftsleitung einzuholen, ob eine bestimmte Tatsache vertraulich zu behandeln ist oder nicht. Die Schweigepflicht erstreckt sich auch auf Angelegenheiten anderer Firmen, in denen der Mitarbeiter eingesetzt wird.
        </Text>
        <Text style={styles.paragraph}>
          (2) Über seine Vergütung hat der Mitarbeiter dritten Personen gegenüber Stillschweigen zu bewahren. Dies gilt nicht für die Fälle, in denen er gesetzlich berechtigt oder verpflichtet ist, Angaben über sein Einkommen zu machen, wie beispielsweise dem Finanzamt, dem Arbeitsamt oder einer sonstigen staatlichen Stelle.
        </Text>

        <Text style={styles.h2}>§ 12 Nebentätigkeit</Text>
        <Text style={styles.paragraph}>
          Jede Nebentätigkeit, gleichgültig, ob sie entgeltlich oder unentgeltlich ausgeübt wird, bedarf der vorherigen Zustimmung des Arbeitgebers. Die Zustimmung ist zu erteilen, wenn die Nebentätigkeit die Wahrnehmung der dienstlichen Aufgaben zeitlich nicht oder allenfalls unwesentlich behindert und sonstige berechtigte Interessen des Arbeitgebers nicht beeinträchtigt werden.
        </Text>

        <Text style={styles.h2}>§ 13 Beendigung des Arbeitsverhältnisses</Text>
        <Text style={styles.paragraph}>
          (1) Die Kündigungsfristen richten sich nach § 2.2. Manteltarifvertrag iGZ.
        </Text>
        <Text style={styles.paragraph}>
          (2) Jede fristlos ausgesprochene außerordentliche Kündigung gilt immer als zugleich hilfsweise ordentlich ausgesprochene Kündigung. Jede nicht die Frist wahrende ordentliche Kündigung gilt immer zugleich als zum nächstzulässigen Termin, der sich nach § 2.2. Manteltarifvertrag iGZ i.V.m. § 622 BGB berechnet, ausgesprochene Kündigung.
        </Text>
        <Text style={styles.paragraph}>
          (3) Stellt der Arbeitgeber den Mitarbeiter unter den Voraussetzungen des § 3.2.5. Manteltarifvertrag iGZ frei, werden Guthaben aus dem Arbeitszeitkonto vor Urlaubsansprüchen verwendet.
        </Text>

        <Text style={styles.h2}>§ 14 Unfallverhütung / Arbeitsschutz</Text>
        <Text style={styles.paragraph}>
          Der Mitarbeiter wird über die jeweils im Kundenbetrieb geltenden Unfallverhütungsvorschriften aufgeklärt. Er verpflichtet sich zur Einhaltung, insbesondere (soweit erforderlich) zum Tragen der persönlichen Schutzausrüstung. Etwaige Arbeitsunfälle sind dem Arbeitgeber unverzüglich anzuzeigen.
        </Text>

        <Text style={styles.h2}>§ 15 Vertragsstrafe</Text>
        <Text style={styles.paragraph}>
          Regelungen zu Vertragsstrafen können sich aus einem gesonderten Dokument zu diesem Arbeitsvertrag ergeben.
        </Text>

        <Text style={styles.h2}>§ 16 Schriftformklausel</Text>
        <Text style={styles.paragraph}>
          Nebenabreden wurden nicht getroffen. Änderungen des Vertrages und Nebenabreden, sowie die Änderung dieses Schriftformgebotes bedürfen zu ihrer Wirksamkeit der Schriftform. Der Vorrang der Individualabrede gemäß § 305b BGB bleibt davon unberührt.
        </Text>

        <Text style={styles.h2}>§ 17 Vertretungsberechtigung</Text>
        <Text style={styles.paragraph}>
          (1) Auf Arbeitgeberseite sind zur Abgabe aller rechtserheblichen Erklärungen, die sich auf die Begründung, Durchführung und Beendigung einschließlich der Kündigung des Arbeitsverhältnis-ses beziehen, der Inhaber / die Geschäftsführer, die Niederlassungsleiter und die Personaldisponenten berechtigt und zwar jeweils alleinhandelnd.
        </Text>
        <Text style={styles.paragraph}>
          (2) Den Namen der in Absatz 1 genannten Personen kann der Mitarbeiter auf folgendem Weg in Erfahrung bringen:
        </Text>
        <View style={styles.list}>
          <View style={styles.checkboxRow}>
            <View style={[styles.checkbox, styles.checkboxChecked]} />
            <Text style={{ flex: 1 }}>Innerhalb der Geschäftszeiten der betreuenden Niederlassung von <Text style={styles.highlight}>06:00</Text> Uhr bis <Text style={styles.highlight}>22:00</Text> Uhr telefonisch unter <Text style={styles.highlight}>022828683821</Text> oder per Mail über <Text style={styles.highlight}>info@rheinahr-gmbh.de</Text>.</Text>
          </View>
          <View style={styles.checkboxRow}>
            <View style={styles.checkbox} />
            <Text style={{ flex: 1 }}>Über den Aushang am „Schwarzen Brett“ in der betreuenden Niederlassung des Arbeitgebers, die unter § 5 Absatz 8 als erste Tätigkeitsstätte festgelegt worden ist.</Text>
          </View>
        </View>

        <Text style={styles.h2}>§ 18 Hinweispflicht des Mitarbeiters</Text>
        <Text style={styles.paragraph}>
          Der Mitarbeiter ist verpflichtet, dem Arbeitgeber
        </Text>
        <View style={styles.list}>
          <Text style={styles.paragraph}>- alle früheren Arbeitgeber anzugeben, bei denen er in den letzten sechs Monaten vor Beginn dieses Arbeitsverhältnisses beschäftigt war,</Text>
          <Text style={styles.paragraph}>- alle Kundenunternehmen anzugeben, bei denen er in den letzten vier Monaten vor Beginn dieses Arbeitsverhältnisses als Zeitarbeitnehmer eingesetzt war,</Text>
          <Text style={styles.paragraph}>- die Gewährung des Zugangs zu Gemeinschaftseinrichtungen, von Sachzuwendungen oder sonstigen Leistungen von Seiten des Kundenbetriebes anzuzeigen,</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.headerRight}>Stand: 17.02.2020 5</Text>
        
        <View style={styles.list}>
          <Text style={styles.paragraph}>- jede Änderung seiner Wohnadresse sowie der steuerlichen und sozialversicherungsrechtlichen Verhältnisse - insbesondere, wenn neben diesem Beschäftigungsverhältnis ein weiteres (geringfügiges) Arbeitsverhältnis aufgenommen wird - unverzüglich mitzuteilen, und</Text>
          <Text style={styles.paragraph}>- jeden angekündigten oder bereits stattfindenden Streik im Kundenbetrieb unverzüglich mitzuteilen.</Text>
        </View>

        <Text style={styles.h2}>§ 19 Datengeheimnis / Datenschutz</Text>
        <Text style={styles.paragraph}>
          (1) Der Mitarbeiter wird auf das Datengeheimnis verpflichtet und auf die Strafbarkeit von Verstößen hingewiesen. Es ist untersagt, personenbezogene Daten unbefugt zu verarbeiten. Verstöße gegen das Datengeheimnis können nach Artikel 83 Datenschutz-Grundverordnung i.V.m. §§ 41-43 Bundesdatenschutzgesetz mit Bußgeld, Geld- oder Freiheitsstrafe geahndet werden. Die Verschwiegenheitsverpflichtung unter Punkt 11 Absatz 1 wird durch diese Verpflichtung auf das Datengeheimnis nicht berührt. Die Verpflichtung auf das Datengeheimnis besteht auch nach Beendigung des Arbeitsverhältnisses fort.
        </Text>
        <Text style={styles.paragraph}>
          (2) In einem gesonderten Dokument informiert der Arbeitgeber den Mitarbeiter über die Verarbeitung seiner personenbezogenen Daten und klärt ihn über seine Rechte und Pflichten auf.
        </Text>

        <Text style={styles.h2}>§ 20 Einzelvertragliche Ausschlussfristen</Text>
        <Text style={styles.paragraph}>
          Es finden keine tariflichen Ausschlussfristen auf dieses Arbeitsverhältnis Anwendung. Stattdessen vereinbaren die Vertragsparteien die nachfolgenden einzelvertraglichen Ausschlussfristen.
        </Text>
        <Text style={styles.paragraph}>
          (1) Ausschluss von Ansprüchen des Mitarbeiters
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>A.</Text> Ansprüche des Mitarbeiters aus dem Arbeitsverhältnis verfallen, wenn sie nicht innerhalb einer Ausschlussfrist von vier Monaten nach Fälligkeit gegenüber dem Arbeitgeber in Textform zumindest dem Grunde nach geltend gemacht werden. Lehnt der Arbeitgeber die Ansprüche schriftlich ab, verfallen die Ansprüche des Mitarbeiters, wenn sie nicht innerhalb von einer weiteren Ausschlussfrist von vier Monaten ab Zugang der schriftlichen Ablehnung zumindest dem Grunde nach gerichtlich geltend gemacht werden.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>B.</Text> Diese Ausschlussfristen gelten nicht für Ansprüche des Mitarbeiters, die kraft Gesetzes diesen Ausschlussfristen entzogen sind, beispielsweise
        </Text>
        <View style={styles.list}>
          <Text style={styles.paragraph}>- Ansprüche aus einem nach dem Arbeitnehmer-Entsendegesetz für allgemeinverbindlich erklärten Tarifvertrag und Ansprüche aus einer Rechtsverordnung nach dem Arbeitnehmer-Entsendegesetz (wobei sich aus der jeweiligen Mindestlohnregelung Ausschlussfristen ergeben können und diese dann einzuhalten sind),</Text>
          <Text style={styles.paragraph}>- Ansprüche aus dem Mindestlohngesetz,</Text>
          <Text style={styles.paragraph}>- Ansprüche aus einer Betriebsvereinbarung oder</Text>
          <Text style={styles.paragraph}>- Ansprüche aus einem nach dem Tarifvertragsgesetz anwendbaren Tarifvertrag (beiderseitige Tarifbindung oder Allgemeinverbindlichkeit).</Text>
        </View>
        <Text style={styles.paragraph}>
          Diese Ausschlussfristen gelten außerdem nicht für
        </Text>
        <View style={styles.list}>
          <Text style={styles.paragraph}>- Ansprüche aus § 8 Absatz 5 Arbeitnehmerüber-lassungsgesetz i.V.m. einer Verordnung über eine Lohnuntergrenze in der Arbeitnehmer-überlassung,</Text>
          <Text style={styles.paragraph}>- Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die auf einer vorsätzlichen oder fahrlässigen Pflichtverletzung des Arbeitgebers oder einer vorsätzlichen oder fahrlässigen Pflichtverletzung eines gesetzlichen Vertreters oder Erfüllungsgehilfen des Arbeitgebers beruhen,</Text>
          <Text style={styles.paragraph}>- sonstige Schäden, die auf einer vorsätzlichen oder grob fahrlässigen Pflichtverletzung des Arbeitgebers oder auf einer vorsätzlichen oder grob fahrlässigen Pflichtverletzung eines gesetzlichen Vertreters oder Erfüllungsgehilfen des Arbeitgebers beruhen oder</Text>
          <Text style={styles.paragraph}>- Ansprüche des Mitarbeiters, die auf einer unerlaubten Handlung des Arbeitgebers oder auf einer unerlaubten Handlung eines gesetzlichen Vertreters oder Erfüllungsgehilfen des Arbeitgebers beruhen.</Text>
        </View>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>C.</Text> Ansprüche des Mitarbeiters, die nicht innerhalb dieser Ausschlussfristen geltend gemacht werden, sind ausgeschlossen.
        </Text>

        <Text style={styles.paragraph}>
          (2) Ausschluss von Ansprüchen des Arbeitgebers
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>A.</Text> Ansprüche des Arbeitgebers aus dem Arbeitsverhältnis verfallen, wenn sie nicht innerhalb einer Ausschlussfrist von zwei Monaten nach Fälligkeit schriftlich gegenüber dem Mitarbeiter geltend gemacht werden. Lehnt der Mitarbeiter die Ansprüche in Textform ab, verfallen die Ansprüche des Arbeitgebers, wenn sie nicht innerhalb von einer weiteren Ausschlussfrist von zwei Monaten ab Zugang der in Textform erklärten Ablehnung gerichtlich geltend gemacht werden.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>B.</Text> Ansprüche des Arbeitgebers, die nicht innerhalb dieser Ausschlussfristen geltend gemacht werden, sind ausgeschlossen.
        </Text>

        <View style={styles.signatureContainer}>
          <View style={styles.signatureBox}>
            <Text>(Ort / Datum / Unterschrift des Arbeitgebers)</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>(Ort / Datum / Unterschrift des Mitarbeiters)</Text>
          </View>
        </View>
      </Page>
      
      <Page size="A4" style={styles.page}>
        <Text style={styles.headerRight}>Stand: 17.02.2020 6</Text>
        
        <Text style={styles.paragraph}>
          Der Mitarbeiter bestätigt durch seine Unterschrift das Merkblatt für Leiharbeitnehmerinnen und Leiharbeitnehmer der Bundesagentur für Arbeit, ein Exemplar dieses Arbeitsvertrages sowie folgende Unterlagen erhalten und unterschrieben zu haben:
        </Text>
        
        <View style={{ marginTop: 60 }}></View>
      </Page>
    </Document>
  );
};

export async function generateArbeitsvertragPdf(data: ArbeitsvertragData): Promise<Buffer> {
  return await renderToBuffer(<ArbeitsvertragTemplate data={data} />);
}
