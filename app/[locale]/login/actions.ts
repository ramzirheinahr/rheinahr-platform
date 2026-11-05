"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";

export async function loginUser(email: string, password: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, active: true, role: true },
    });

    if (!user || !user.active) {
      return { ok: false, error: "invalidCredentials" };
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return { ok: false, error: "invalidCredentials" };
    }

    // Generate a secure session token
    const token = randomBytes(32).toString("hex");

    const headerList = await headers();
    const userAgent = headerList.get("user-agent") || "Unknown Device";
    const ipAddress =
      headerList.get("x-forwarded-for") || headerList.get("x-real-ip") || "Unknown IP";

    // Create session in DB
    await prisma.userSession.create({
      data: {
        userId: user.id,
        token,
        device: userAgent.substring(0, 255), // Truncate just in case
        ipAddress: ipAddress.substring(0, 255),
      },
    });

    // Set cookie with 10 years expiration for "infinite" session
    const cookieStore = await cookies();
    cookieStore.set("app_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
      path: "/",
    });

    return { ok: true, role: user.role };
  } catch (error) {
    console.error("Login Error:", error);
    return { ok: false, error: "serverError" };
  }
}

export async function logoutUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("app_session")?.value;
  
  if (token) {
    await prisma.userSession.deleteMany({
      where: { token },
    });
  }

  cookieStore.delete("app_session");
}

import { portalPath } from "@/lib/auth";
import { roleUsesAccessLink } from "@/lib/access";
import { audit } from "@/lib/audit";

export async function loginWithToken(token: string) {
  try {
    if (!token) return { ok: false, error: "invalid" };

    const headerList = await headers();
    const ipAddress = headerList.get("x-forwarded-for") || headerList.get("x-real-ip") || "Unknown IP";
    const userAgent = headerList.get("user-agent") || "Unknown Device";
    const sessionToken = randomBytes(32).toString("hex");

    // Single-use link: consuming the token and creating the session happen in
    // one transaction. The conditional update only matches while the token is
    // still unused, so two simultaneous clicks (or a forwarded link) cannot both
    // sign in. The resulting session stays valid long-term; the link is spent.
    const user = await prisma.$transaction(async (tx) => {
      const candidate = await tx.user.findUnique({
        where: { loginToken: token },
        select: { id: true, active: true, role: true },
      });
      if (!candidate || !candidate.active || !roleUsesAccessLink(candidate.role)) return null;

      const consumed = await tx.user.updateMany({
        where: { id: candidate.id, loginToken: token },
        data: { loginToken: null },
      });
      if (consumed.count !== 1) return null;

      await tx.userSession.create({
        data: {
          userId: candidate.id,
          token: sessionToken,
          device: userAgent.substring(0, 255),
          ipAddress: ipAddress.substring(0, 255),
        },
      });
      return candidate;
    });

    if (!user) return { ok: false, error: "invalid" };

    await audit({
      userId: user.id,
      action: "access.link.success",
      entity: "User",
      entityId: user.id,
      ipAddress: ipAddress.substring(0, 255),
    });

    // Set cookie with 10 years expiration
    const cookieStore = await cookies();
    cookieStore.set("app_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
      path: "/",
    });

    return { ok: true, role: user.role, redirect: portalPath(user.role) };
  } catch (error) {
    console.error("Token Login Error:", error);
    return { ok: false, error: "serverError" };
  }
}
