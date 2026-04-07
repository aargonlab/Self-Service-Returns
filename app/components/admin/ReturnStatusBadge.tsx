import { Badge } from "@shopify/polaris";
import { STATUS_LABELS, STATUS_COLORS } from "~/utils/constants";
import type { ReturnStatus } from "@prisma/client";

interface ReturnStatusBadgeProps {
  status: ReturnStatus;
}

export function ReturnStatusBadge({ status }: ReturnStatusBadgeProps) {
  const tone = STATUS_COLORS[status] ?? undefined;
  const label = STATUS_LABELS[status] ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Badge tone={tone}>
      {label}
    </Badge>
  );
}
