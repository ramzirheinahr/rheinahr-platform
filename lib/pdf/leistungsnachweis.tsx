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

export type LeistungsnachweisData = {
  facilityName: string;
  workerName: string;
  qualificationLabel: string;
  shiftDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  hours: number;
  methodLabel: string;
  isElectronic: boolean;
  signatureData?: string | null;
  // Typed full name of the confirmer for the electronic (Textform) confirmation.
  signerName?: string | null;
  confirmedByEmail: string;
  confirmedAt: string; // formatted
  ipAddress?: string | null;
  orderId: string;
  assignmentId: string;
  // Draft = unsigned preview shown to the client before they confirm. The
  // finalized document (draft: false) carries the embedded signature + audit.
  draft?: boolean;
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica" },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1e3a8a" },
  brandSub: { fontSize: 9, color: "#6b7280", marginTop: 2 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 10,
    marginBottom: 20,
  },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 16 },
  row: { flexDirection: "row", marginBottom: 8 },
  label: { width: 150, color: "#6b7280" },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  sigBox: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    padding: 12,
    width: 260,
  },
  sigImage: { height: 70, objectFit: "contain" },
  eSignName: {
    fontSize: 16,
    fontFamily: "Helvetica-Oblique",
    color: "#1e3a8a",
    paddingVertical: 22,
  },
  sigLine: {
    height: 70,
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
    borderBottomStyle: "dashed",
  },
  sigCaption: { fontSize: 8, color: "#6b7280", marginTop: 6 },
  draftBanner: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "#fffbeb",
    borderRadius: 4,
    padding: 8,
    fontSize: 9,
    color: "#92400e",
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#9ca3af",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
  },
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function LeistungsnachweisDocument({ d }: { d: LeistungsnachweisData }) {
  return (
    <Document
      title={`Leistungsnachweis ${d.shiftDate}`}
      author="RheinAhr Dienstleistungen GmbH"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>RheinAhr Dienstleistungen GmbH</Text>
            <Text style={styles.brandSub}>Fronhof 4, 53177 Bonn · info@rheinahr-gmbh.de</Text>
          </View>
          <Text style={styles.brandSub}>HRB 23459 · USt-IdNr. DE316507908</Text>
        </View>

        <Text style={styles.title}>Leistungsnachweis</Text>

        {d.draft ? (
          <Text style={styles.draftBanner}>
            ENTWURF / VORSCHAU — Dieses Dokument ist noch nicht bestätigt. Bitte
            prüfen Sie die Angaben und bestätigen Sie die Leistung anschließend
            elektronisch.
          </Text>
        ) : null}

        <Field label="Einrichtung" value={d.facilityName} />
        <Field label="Fachkraft" value={d.workerName} />
        <Field label="Qualifikation" value={d.qualificationLabel} />
        <Field label="Datum" value={d.shiftDate} />
        <Field label="Schicht" value={`${d.startTime} – ${d.endTime}`} />
        <Field label="Geleistete Stunden" value={`${d.hours} h`} />
        {d.draft ? null : (
          <>
            <Field label="Bestätigungsart" value={d.methodLabel} />
            <Field label="Bestätigt durch" value={d.confirmedByEmail} />
            <Field label="Bestätigt am" value={d.confirmedAt} />
            {d.ipAddress ? <Field label="IP-Adresse" value={d.ipAddress} /> : null}
          </>
        )}

        {d.isElectronic ? (
          <View style={styles.sigBox}>
            {d.signatureData && !d.draft ? (
              // Optional legacy drawn signature. react-pdf Image is not an HTML
              // <img>; alt-text rule does not apply.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image style={styles.sigImage} src={d.signatureData} />
            ) : d.draft ? (
              <View style={styles.sigLine} />
            ) : (
              <Text style={styles.eSignName}>{d.signerName ?? d.confirmedByEmail}</Text>
            )}
            <Text style={styles.sigCaption}>
              {d.draft
                ? `Elektronische Bestätigung (Textform) — ${d.facilityName}`
                : `Elektronisch bestätigt in Textform (§ 126b BGB) durch ${d.signerName ?? d.confirmedByEmail} — ${d.facilityName}, ${d.confirmedAt}${d.ipAddress ? `, IP ${d.ipAddress}` : ""}`}
            </Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          {d.draft
            ? `Entwurf des Leistungsnachweises — noch nicht rechtsverbindlich bestätigt. Auftrag-ID: ${d.orderId} · Einsatz-ID: ${d.assignmentId}`
            : `Dieser Leistungsnachweis wurde digital erstellt und ist ohne handschriftliche Unterschrift gültig. Zeitstempel und IP-Adresse wurden gemäß DSGVO protokolliert. Auftrag-ID: ${d.orderId} · Einsatz-ID: ${d.assignmentId}`}
        </Text>
      </Page>
    </Document>
  );
}

export function renderLeistungsnachweisPdf(
  d: LeistungsnachweisData,
): Promise<Buffer> {
  return renderToBuffer(<LeistungsnachweisDocument d={d} />);
}
