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
  confirmedByEmail: string;
  confirmedAt: string; // formatted
  ipAddress?: string | null;
  orderId: string;
  assignmentId: string;
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
  sigCaption: { fontSize: 8, color: "#6b7280", marginTop: 6 },
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

        <Field label="Einrichtung" value={d.facilityName} />
        <Field label="Fachkraft" value={d.workerName} />
        <Field label="Qualifikation" value={d.qualificationLabel} />
        <Field label="Datum" value={d.shiftDate} />
        <Field label="Schicht" value={`${d.startTime} – ${d.endTime}`} />
        <Field label="Geleistete Stunden" value={`${d.hours} h`} />
        <Field label="Bestätigungsart" value={d.methodLabel} />
        <Field label="Bestätigt durch" value={d.confirmedByEmail} />
        <Field label="Bestätigt am" value={d.confirmedAt} />
        {d.ipAddress ? <Field label="IP-Adresse" value={d.ipAddress} /> : null}

        {d.isElectronic && d.signatureData ? (
          <View style={styles.sigBox}>
            {/* react-pdf Image is not an HTML <img>; alt-text rule does not apply. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.sigImage} src={d.signatureData} />
            <Text style={styles.sigCaption}>
              Elektronische Unterschrift — {d.facilityName}
            </Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          Dieser Leistungsnachweis wurde digital erstellt und ist ohne
          Unterschrift gültig. Zeitstempel und IP-Adresse wurden gemäß DSGVO
          protokolliert. Auftrag-ID: {d.orderId} · Einsatz-ID: {d.assignmentId}
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
