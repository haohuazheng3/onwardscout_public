import { useTranslations } from "next-intl";
import { TableSkeleton } from "@/components/admin/AdminUi";

export default function Loading() {
  const label = useTranslations("common")("status.loading");
  return <TableSkeleton rows={8} filters={false} label={label} />;
}
