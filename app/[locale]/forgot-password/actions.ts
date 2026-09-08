"use server";

import { createPasswordResetToken } from "@/lib/password-reset";
import { headers } from "next/headers";

export async function requestPasswordResetAction(
  locale: string,
  formData: FormData
) {
  const email = formData.get("email")?.toString() || "";
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") || headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") || "https";
  const originUrl = host ? `${proto}://${host}` : undefined;

  return await createPasswordResetToken(email, locale, originUrl);
}
