import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTicketSecret, signTicket, verifyTicket } from "./confirmation-tickets";

describe("confirmation-tickets secret configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CONFIRMATION_TICKET_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.LOCAL_STORAGE_SECRET;
    delete process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when no secret is configured", () => {
    expect(() => getTicketSecret()).toThrow();
  });

  it("uses CONFIRMATION_TICKET_SECRET when present", () => {
    process.env.CONFIRMATION_TICKET_SECRET = "super-secret-key-at-least-16-chars";
    expect(getTicketSecret()).toBe("super-secret-key-at-least-16-chars");
  });

  it("falls back to LOCAL_STORAGE_SECRET when CONFIRMATION_TICKET_SECRET is not set", () => {
    process.env.LOCAL_STORAGE_SECRET = "local-storage-secret-at-least-16-chars";
    expect(getTicketSecret()).toBe("local-storage-secret-at-least-16-chars");
  });

  it("falls back to ENCRYPTION_KEY when neither is set", () => {
    process.env.ENCRYPTION_KEY = "encryption-key-at-least-16-chars";
    expect(getTicketSecret()).toBe("encryption-key-at-least-16-chars");
  });

  it("successfully signs and verifies a ticket with fallback secret", () => {
    process.env.LOCAL_STORAGE_SECRET = "local-storage-secret-at-least-16-chars";
    const payload = {
      ticketId: "test-ticket-id",
      userId: "test-user-id",
      requestGroupId: "group-1",
      assignmentIds: ["assign-1", "assign-2"],
      path: "signed-confirmations/test.pdf",
      fileName: "test.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    const ticket = signTicket(payload);
    const verified = verifyTicket(ticket);
    expect(verified).not.toBeNull();
    expect(verified?.ticketId).toBe("test-ticket-id");
    expect(verified?.assignmentIds).toEqual(["assign-1", "assign-2"]);
  });
});
