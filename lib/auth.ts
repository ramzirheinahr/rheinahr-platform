import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import type { Locale } from "@/i18n/routing";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  fullName: string | null;
  permissions?: string[];
  clientId?: string | null;
};

// Landing portal per role. super_admin shares the admin portal.
export function portalPath(role: Role): "/admin" | "/client" | "/worker" {
  if (role === "client") return "/client";
  if (role === "worker") return "/worker";
  return "/admin"; // admin + super_admin
}

// Role hierarchy: super_admin satisfies any admin-area requirement.
export function roleSatisfies(role: Role, allowed: Role[]): boolean {
  if (allowed.includes(role)) return true;
  if (role === "super_admin" && allowed.includes("admin")) return true;
  return false;
}

// Check if a user has a specific permission. Super admins have all permissions implicitly.
export function hasPermission(user: SessionUser, permission: string): boolean {
  if (user.role === "super_admin") return true;
  return user.permissions?.includes(permission) ?? false;
}

// Resolves the authenticated user from the Supabase session, then loads the
// app-level role from our own DB (source of truth for RBAC — never trust client).
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, role: true, fullName: true, active: true, permissions: true, clientId: true },
  });
  if (!dbUser || !dbUser.active) return null; // disabled accounts are denied
  return {
    id: dbUser.id,
    email: dbUser.email,
    role: dbUser.role,
    fullName: dbUser.fullName,
    permissions: dbUser.permissions,
    clientId: dbUser.clientId,
  };
}

// Guard for server components / route handlers in role-scoped route groups.
// Redirects to login if unauthenticated, or to the user's own portal if the
// role doesn't match — defense in depth alongside the middleware.
export async function requireRole(
  locale: Locale,
  ...allowed: Role[]
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect({ href: "/login", locale });
  if (allowed.length && !roleSatisfies(user!.role, allowed)) {
    redirect({ href: portalPath(user!.role), locale });
  }
  return user!;
}

// Convenience guard for account-management actions/pages.
export async function requireSuperAdmin(locale: Locale): Promise<SessionUser> {
  return requireRole(locale, "super_admin");
}

// Resolves the client facility ID whether the user is the primary contact or a sub-user.
export async function resolveClientId(user: SessionUser): Promise<string | null> {
  if (user.clientId) return user.clientId; // sub-user
  const client = await prisma.client.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  return client?.id || null; // primary user or null
}
