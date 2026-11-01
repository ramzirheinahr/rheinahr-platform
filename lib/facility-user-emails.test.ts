import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFacilityClientUserIds } from "./notify";
import { prisma } from "./prisma";

describe("Facility Client Users Email Preferences", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("filters out inactive users and filters by receiveEmails when onlyWithEmailEnabled is true", async () => {
    vi.spyOn(prisma.client, "findFirst").mockResolvedValue({
      id: "client-1",
      userId: "user-owner",
      user: {
        id: "user-owner",
        active: true,
        receiveEmails: false, // Owner opted OUT of emails (like Frau Natalja in Image 2)
      },
      subUsers: [
        {
          id: "sub-1",
          active: true,
          receiveEmails: false, // Kempf opted OUT of emails
        },
        {
          id: "sub-2",
          active: true,
          receiveEmails: true, // Opted IN to emails
        },
        {
          id: "sub-3",
          active: false, // Inactive account
          receiveEmails: true,
        },
      ],
    } as any);

    // 1. By default, returns all active users for in-app / push notifications
    const allActive = await getFacilityClientUserIds("client-1");
    expect(allActive).toEqual(["user-owner", "sub-1", "sub-2"]);

    // 2. When onlyWithEmailEnabled is true, returns ONLY active users who have receiveEmails: true
    const emailRecipients = await getFacilityClientUserIds("client-1", { onlyWithEmailEnabled: true });
    expect(emailRecipients).toEqual(["sub-2"]);
    expect(emailRecipients).not.toContain("user-owner"); // Opted out
    expect(emailRecipients).not.toContain("sub-1"); // Opted out
    expect(emailRecipients).not.toContain("sub-3"); // Inactive
  });

  it("skips sending emails to users with receiveEmails: false and records skipped_preference", async () => {
    const { sendEmailToRecipientsWithReport } = await import("./email");

    vi.spyOn(prisma.user, "findMany").mockResolvedValue([
      {
        id: "user-opted-out",
        email: "kempf@example.com",
        fullName: "Herr Kempf",
        active: true,
        receiveEmails: false,
      },
      {
        id: "user-opted-in",
        email: "active@example.com",
        fullName: "Frau Active",
        active: true,
        receiveEmails: true,
      },
    ] as any);

    vi.spyOn(prisma.outgoingEmail, "create").mockResolvedValue({ id: "mail-1" } as any);

    const report = await sendEmailToRecipientsWithReport(
      ["user-opted-out", "user-opted-in"],
      {
        subject: "Einsätze bestätigt",
        body: "Test body",
        html: "<p>Test</p>",
      }
    );

    // Only user-opted-in is eligible
    expect(report.eligibleRecipients).toEqual(["active@example.com"]);
    expect(report.eligibleRecipients).not.toContain("kempf@example.com");

    // user-opted-out was skipped due to user preference
    expect(report.skippedRecipients).toEqual([
      {
        recipient: "kempf@example.com",
        reason: "Benutzer hat den E-Mail-Empfang deaktiviert (receiveEmails: false)",
      },
    ]);
  });
});
