import { TableSkeleton } from "@/components/admin/AdminUi";

export default function Loading() {
  return <TableSkeleton rows={6} filters={false} label="Loading" />;
}
