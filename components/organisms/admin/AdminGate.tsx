"use client";

import { Spinner } from "@/components/atoms";
import { useAdmin } from "@/hooks/useApi";
import { AdminSignIn } from "./AdminSignIn";

/** A page only the administrator opens (the admin dashboard, the CMS): anyone else gets the admin sign-in. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAdmin();
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Checking…" /></div>;
  return admin ? <>{children}</> : <AdminSignIn />;
}
