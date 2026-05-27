import type { ReturnStatus } from "@prisma/client";

// Pure, dependency-free state-machine definitions.
// Kept separate from `stateMachine.server.ts` (which pulls Prisma) so that
// these tables and helpers can be imported from unit tests.

export const TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  SUBMITTED: ["PENDING_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["AWAITING_SHIPMENT", "CANCELLED"],
  REJECTED: ["CLOSED"],
  AWAITING_SHIPMENT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["PARTIALLY_ACCEPTED", "REFUNDED", "EXCHANGED", "CANCELLED"],
  PARTIALLY_ACCEPTED: ["REFUNDED", "EXCHANGED"],
  REFUNDED: ["CLOSED"],
  EXCHANGED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function getAvailableTransitions(status: ReturnStatus): ReturnStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: ReturnStatus, to: ReturnStatus) {
    super(`Invalid status transition from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function getTransitionEventName(
  from: ReturnStatus,
  to: ReturnStatus,
): string {
  const eventMap: Record<string, string> = {
    "SUBMITTED->PENDING_REVIEW": "Return moved to review",
    "SUBMITTED->APPROVED": "Return auto-approved",
    "SUBMITTED->REJECTED": "Return auto-rejected",
    "SUBMITTED->CANCELLED": "Return cancelled",
    "PENDING_REVIEW->APPROVED": "Return approved",
    "PENDING_REVIEW->REJECTED": "Return rejected",
    "PENDING_REVIEW->CANCELLED": "Return cancelled",
    "APPROVED->AWAITING_SHIPMENT": "Awaiting return shipment",
    "APPROVED->CANCELLED": "Return cancelled",
    "REJECTED->CLOSED": "Return closed",
    "AWAITING_SHIPMENT->IN_TRANSIT": "Return shipment in transit",
    "AWAITING_SHIPMENT->CANCELLED": "Return cancelled",
    "IN_TRANSIT->RECEIVED": "Return received at warehouse",
    "RECEIVED->PARTIALLY_ACCEPTED": "Items partially accepted",
    "RECEIVED->REFUNDED": "Refund processed",
    "APPROVED->REFUNDED": "Refund processed (intermediate states skipped via API)",
    "AWAITING_SHIPMENT->REFUNDED": "Refund processed (intermediate states skipped via API)",
    "IN_TRANSIT->REFUNDED": "Refund processed (intermediate states skipped via API)",
    "RECEIVED->EXCHANGED": "Replacement order created",
    "APPROVED->EXCHANGED": "Replacement order created (intermediate states skipped via API)",
    "AWAITING_SHIPMENT->EXCHANGED": "Replacement order created (intermediate states skipped via API)",
    "IN_TRANSIT->EXCHANGED": "Replacement order created (intermediate states skipped via API)",
    "RECEIVED->CANCELLED": "Return cancelled",
    "PARTIALLY_ACCEPTED->REFUNDED": "Partial refund processed",
    "PARTIALLY_ACCEPTED->EXCHANGED": "Partial replacement processed",
    "REFUNDED->CLOSED": "Return closed",
    "EXCHANGED->CLOSED": "Return closed",
  };

  return eventMap[`${from}->${to}`] ?? `Status changed from ${from} to ${to}`;
}
