import { describe, it, expect } from "vitest";
import {
  formatWorkerSalutation,
  formatWorkerDisplayName,
  formatWorkerEmailIntro,
  formatWorkerBirthDate,
} from "./worker-utils";
import { workerSchema } from "./validations";

describe("worker-utils", () => {
  it("formats salutation properly", () => {
    expect(formatWorkerSalutation("herr")).toBe("Herr");
    expect(formatWorkerSalutation("HERR")).toBe("Herr");
    expect(formatWorkerSalutation("frau")).toBe("Frau");
    expect(formatWorkerSalutation("Frau")).toBe("Frau");
    expect(formatWorkerSalutation(null)).toBe("");
    expect(formatWorkerSalutation(undefined)).toBe("");
  });

  it("formats display name with salutation", () => {
    expect(formatWorkerDisplayName({ fullName: "Max Mustermann", salutation: "herr" })).toBe("Herr Max Mustermann");
    expect(formatWorkerDisplayName({ fullName: "Erika Musterfrau", salutation: "frau" })).toBe("Frau Erika Musterfrau");
    expect(formatWorkerDisplayName({ fullName: "Alex Test", salutation: null })).toBe("Alex Test");
  });

  it("formats German email intro correctly", () => {
    expect(formatWorkerEmailIntro({ fullName: "Max Mustermann", salutation: "herr" }))
      .toBe("unserem Mitarbeiter <strong>Herrn Max Mustermann</strong>");
    expect(formatWorkerEmailIntro({ fullName: "Erika Musterfrau", salutation: "frau" }))
      .toBe("unserer Mitarbeiterin <strong>Frau Erika Musterfrau</strong>");
    expect(formatWorkerEmailIntro({ fullName: "Alex Test", salutation: null }))
      .toBe("unserem Mitarbeiter / unserer Mitarbeiterin <strong>Alex Test</strong>");
  });

  it("formats birth date correctly in German format", () => {
    expect(formatWorkerBirthDate(new Date(Date.UTC(1990, 4, 15)))).toBe("15.05.1990");
    expect(formatWorkerBirthDate("1985-12-01")).toBe("01.12.1985");
    expect(formatWorkerBirthDate(null)).toBe("");
  });
});

describe("workerSchema salutation validation", () => {
  it("validates valid salutations", () => {
    const resHerr = workerSchema.safeParse({
      fullName: "Max Mustermann",
      qualification: "pflegefachkraft",
      contractType: "unbefristet",
      employmentType: "vollzeit",
      salutation: "herr",
      birthDate: "1990-05-15",
    });
    expect(resHerr.success).toBe(true);
    if (resHerr.success) {
      expect(resHerr.data.salutation).toBe("herr");
      expect(resHerr.data.birthDate).toBeInstanceOf(Date);
    }

    const resFrau = workerSchema.safeParse({
      fullName: "Erika Musterfrau",
      qualification: "pflegefachkraft",
      contractType: "unbefristet",
      employmentType: "vollzeit",
      salutation: "Frau",
    });
    expect(resFrau.success).toBe(true);
    if (resFrau.success) {
      expect(resFrau.data.salutation).toBe("frau");
    }
  });

  it("allows omitting salutation or empty string", () => {
    const res = workerSchema.safeParse({
      fullName: "Max Mustermann",
      qualification: "pflegefachkraft",
      contractType: "unbefristet",
      employmentType: "vollzeit",
      salutation: "",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.salutation).toBeUndefined();
    }
  });
});
