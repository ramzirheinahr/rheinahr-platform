"use server";

import { prisma } from "@/lib/prisma";
import { sendEmailToUsers } from "@/lib/email";
import { z } from "zod";
import { getTranslations } from "next-intl/server";

const contactSchema = z.object({
  name: z.string().min(2, "Name ist erforderlich"),
  email: z.string().email("Ungültige E-Mail-Adresse"),
  phone: z.string().min(5, "Telefonnummer ist erforderlich"),
  company: z.string().min(2, "Firmenname ist erforderlich"),
  message: z.string().min(10, "Nachricht ist zu kurz"),
});

export async function submitContactRequest(formData: FormData) {
  const data = {
    name: formData.get("name") as string,
    email: formData.get("email") as string,
    phone: formData.get("phone") as string,
    company: formData.get("company") as string,
    message: formData.get("message") as string,
  };

  const parsed = contactSchema.safeParse(data);

  if (!parsed.success) {
    return {
      success: false,
      error: "Bitte füllen Sie alle Felder korrekt aus.",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const { name, email, phone, company, message } = parsed.data;

  try {
    // 1. Get Admins
    const admins = await prisma.user.findMany({
      where: { role: { in: ["super_admin", "admin"] }, active: true },
      select: { id: true, email: true },
    });

    const adminIds = admins.map((a) => a.id);

    // 2. Send Email to Admins
    if (adminIds.length > 0) {
      const emailBody = `
        Neue Kontaktanfrage über die Website:

        Name: ${name}
        E-Mail: ${email}
        Telefon: ${phone}
        Firma: ${company}

        Nachricht:
        ${message}
      `;

      const emailHtml = `
        <h2>Neue Kontaktanfrage</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>E-Mail:</strong> ${email}</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <p><strong>Firma:</strong> ${company}</p>
        <br/>
        <p><strong>Nachricht:</strong></p>
        <p>${message.replace(/\n/g, "<br/>")}</p>
      `;

      await sendEmailToUsers(adminIds, {
        subject: `Neue Kontaktanfrage: ${company || name}`,
        body: emailBody,
        html: emailHtml,
      });
    }

    // 3. Inject into Inbox
    let systemUser = await prisma.user.findFirst({
      where: { email: "system-contact-form@rheinahr-gmbh.de" },
    });

    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          email: "system-contact-form@rheinahr-gmbh.de",
          fullName: "Website Form",
          role: "client",
          active: false,
          passwordHash: "unusable-password-hash",
          client: {
            create: {
              facilityName: "Website Formular",
              facilityType: "ambulant",
            },
          },
        },
      });
    }

    const now = new Date();

    await prisma.conversation.create({
      data: {
        subject: `Kontaktanfrage: ${company}`,
        participants: {
          create: [
            { userId: systemUser.id, lastReadAt: now },
            ...adminIds.map((id) => ({ userId: id })),
          ],
        },
        messages: {
          create: {
            senderId: systemUser.id,
            body: `Neue Kontaktanfrage:\n\nName: ${name}\nE-Mail: ${email}\nTelefon: ${phone}\nFirma: ${company}\n\nNachricht:\n${message}`,
          },
        },
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to process contact request:", error);
    return { success: false, error: "Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut." };
  }
}
