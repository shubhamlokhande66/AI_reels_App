"use client";

import { AdminDashboard } from "@/components/organisms/admin/AdminDashboard";
import { AdminGate } from "@/components/organisms/admin/AdminGate";

/** The admin dashboard for an administrator (an ADMIN_EMAILS account, or this browser unlocked with the ADMIN_KEY);
 * anyone else sees that it is for the administrator, with the key sign-in. */
export default function AdminPage() {
  return (
    <AdminGate>
      <AdminDashboard />
    </AdminGate>
  );
}
