"use client";

import { CmsDashboard } from "@/components/organisms/CmsDashboard";
import { AdminGate } from "@/components/organisms/admin/AdminGate";

/** The CMS: its own full-screen dashboard (the admin's sidebar opens it in a new tab). Administrator only. */
export default function CmsPage() {
  return (
    <AdminGate>
      <CmsDashboard />
    </AdminGate>
  );
}
