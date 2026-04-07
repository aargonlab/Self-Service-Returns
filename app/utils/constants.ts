import type { ReturnStatus } from "@prisma/client";

export const RETURN_REASONS: Record<
  string,
  { label: string; requiresNote: boolean }
> = {
  DOESNT_FIT: { label: "Item doesn't fit", requiresNote: false },
  NOT_AS_DESCRIBED: { label: "Item not as described", requiresNote: true },
  ARRIVED_DAMAGED: { label: "Item arrived damaged", requiresNote: false },
  WRONG_ITEM: { label: "Wrong item received", requiresNote: false },
  CHANGED_MIND: { label: "Changed my mind", requiresNote: false },
  QUALITY_NOT_EXPECTED: { label: "Quality not as expected", requiresNote: true },
  OTHER: { label: "Other", requiresNote: true },
};

export const STATUS_LABELS: Record<ReturnStatus, string> = {
  SUBMITTED: "Submitted",
  PENDING_REVIEW: "Pending Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  AWAITING_SHIPMENT: "Awaiting Shipment",
  IN_TRANSIT: "In Transit",
  RECEIVED: "Received",
  PARTIALLY_ACCEPTED: "Partially Accepted",
  REFUNDED: "Refunded",
  EXCHANGED: "Replaced",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLORS: Record<
  ReturnStatus,
  "info" | "success" | "warning" | "critical" | "new" | undefined
> = {
  SUBMITTED: "new",
  PENDING_REVIEW: "warning",
  APPROVED: "info",
  REJECTED: "critical",
  AWAITING_SHIPMENT: "warning",
  IN_TRANSIT: "info",
  RECEIVED: "info",
  PARTIALLY_ACCEPTED: "warning",
  REFUNDED: "success",
  EXCHANGED: "success",
  CLOSED: undefined,
  CANCELLED: undefined,
};

export const CUSTOMER_FACING_STATUSES: Record<ReturnStatus, string> = {
  SUBMITTED: "Request Received",
  PENDING_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Not Approved",
  AWAITING_SHIPMENT: "Ship Your Items",
  IN_TRANSIT: "On Its Way Back",
  RECEIVED: "Received — Processing",
  PARTIALLY_ACCEPTED: "Partially Accepted",
  REFUNDED: "Refund Complete",
  EXCHANGED: "Replacement Processed",
  CLOSED: "Completed",
  CANCELLED: "Cancelled",
};

// Status progress for the customer portal tracker (0-100)
export const STATUS_PROGRESS: Record<ReturnStatus, number> = {
  SUBMITTED: 10,
  PENDING_REVIEW: 20,
  APPROVED: 30,
  REJECTED: 100,
  AWAITING_SHIPMENT: 40,
  IN_TRANSIT: 60,
  RECEIVED: 75,
  PARTIALLY_ACCEPTED: 85,
  REFUNDED: 90,
  EXCHANGED: 90,
  CLOSED: 100,
  CANCELLED: 100,
};

// Statuses that require action from the CS agent
export const ACTION_REQUIRED_STATUSES: ReturnStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "RECEIVED",
];

// Statuses that are considered "open" (not resolved)
export const OPEN_STATUSES: ReturnStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "APPROVED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "RECEIVED",
  "PARTIALLY_ACCEPTED",
];
