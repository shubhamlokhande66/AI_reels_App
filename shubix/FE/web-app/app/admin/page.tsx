"use client";

import { AdminDashboard } from "@/components/organisms/admin/AdminDashboard";
import { AdminGate } from "@/components/organisms/admin/AdminGate";

/** The admin dashboard for an administrator (an ADMIN_EMAILS account or one added in Admin → Settings, with its daily emailed code);
 * anyone else sees that it is for the administrator, with the key sign-in. */
export default function AdminPage() {
  return (
    <AdminGate>
      <AdminDashboard />
    </AdminGate>
  );
}
