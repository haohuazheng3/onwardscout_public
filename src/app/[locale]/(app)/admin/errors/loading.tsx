import { TableSkeleton } from "@/components/admin/AdminUi";

export default function Loading() {
  return <TableSkeleton rows={5} filters={false} label="Loading" />;
}
