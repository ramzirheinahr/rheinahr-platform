"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";

export async function loginUser(email: string, password: string) {
  try {
    const headerList = await headers();
    const userAgent = headerList.get("user-agent") || "Unknown Device";
    const ipAddress = clientIp(headerList) || "Unknown IP";

    // Brute-force protection: per account and per IP. The same answer is given
    // whether or not the account exists, so it does not reveal valid emails.
    const emailKey = `login:email:${email.trim().toLowerCase()}`;
    const ipKey = `login:ip:${ipAddress}`;
    if (
      isRateLimited(emailKey, LIMITS.loginPerEmail.limit) ||
      isRateLimited(ipKey, LIMITS.loginPerIp.limit)
    ) {
      return { ok: false, error: "tooManyAttempts" };
    }
    const failed = () => {
      recordAttempt(emailKey, LIMITS.loginPerEmail.windowMs);
      recordAttempt(ipKey, LIMITS.loginPerIp.windowMs);
      return { ok: false, error: "invalidCredentials" };
    };

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, active: true, role: true },
    });

    if (!user || !user.active) return failed();

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) return failed();
    clearAttempts(emailKey);

    // Generate a secure session token
    const token = randomBytes(32).toString("hex");

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
import { clientIp } from "@/lib/client-ip";
import { LIMITS, clearAttempts, isRateLimited, recordAttempt } from "@/lib/rate-limit";

export async function loginWithToken(token: string) {
  try {
    const headerList = await headers();
    const ipAddress = clientIp(headerList) || "Unknown IP";
    const ipKey = `access:ip:${ipAddress}`;
    if (isRateLimited(ipKey, LIMITS.accessLinkPerIp.limit)) return { ok: false, error: "tooManyAttempts" };
    if (!token) return { ok: false, error: "invalid" };
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

    if (!user) {
      recordAttempt(ipKey, LIMITS.accessLinkPerIp.windowMs);
      return { ok: false, error: "invalid" };
    }

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
