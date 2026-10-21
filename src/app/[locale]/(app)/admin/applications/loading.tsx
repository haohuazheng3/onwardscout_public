import { TableSkeleton } from "@/components/admin/AdminUi";

export default function Loading() {
  return <TableSkeleton rows={8} filters={true} label="Loading" />;
}
