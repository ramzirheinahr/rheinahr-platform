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
import { audit } from "@/lib/audit";
import { PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from "@/lib/access";

export async function loginWithToken(token: string, pin: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { loginToken: token },
      select: { 
        id: true, 
        active: true, 
        role: true, 
        loginPinHash: true, 
        loginPinAttempts: true, 
        loginPinLockUntil: true 
      },
    });

    if (!user || !user.active || !user.loginPinHash) {
      return { ok: false, error: "invalid" };
    }

    if (user.loginPinLockUntil && user.loginPinLockUntil > new Date()) {
      return { ok: false, error: "locked" };
    }

    const match = await bcrypt.compare(pin, user.loginPinHash);
    
    const headerList = await headers();
    const ipAddress = headerList.get("x-forwarded-for") || headerList.get("x-real-ip") || "Unknown IP";

    if (!match) {
      const attempts = user.loginPinAttempts + 1;
      const locking = attempts >= PIN_MAX_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: locking
          ? {
              loginPinAttempts: 0,
              loginPinLockUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000),
            }
          : { loginPinAttempts: attempts },
      });
      await audit({
        userId: user.id,
        action: "access.pin.fail",
        entity: "User",
        entityId: user.id,
        ipAddress: ipAddress.substring(0, 255),
        metadata: { locked: locking },
      });
      return { ok: false, error: locking ? "locked" : "invalid" };
    }

    // Reset lock counters on success
    await prisma.user.update({
      where: { id: user.id },
      data: { loginPinAttempts: 0, loginPinLockUntil: null },
    });
    await audit({
      userId: user.id,
      action: "access.pin.success",
      entity: "User",
      entityId: user.id,
      ipAddress: ipAddress.substring(0, 255),
    });

    // Generate a secure session token
    const sessionToken = randomBytes(32).toString("hex");

    const userAgent = headerList.get("user-agent") || "Unknown Device";

    // Create session in DB
    await prisma.userSession.create({
      data: {
        userId: user.id,
        token: sessionToken,
        device: userAgent.substring(0, 255),
        ipAddress: ipAddress.substring(0, 255),
      },
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


