import { forwardAll } from "@/server/core/http";

// An upload, streamed on to the Python backend until this endpoint is moved (docs/MIGRATION.md).
export const { GET, POST, PUT, PATCH, DELETE } = forwardAll;
