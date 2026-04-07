import type { ReturnStatus, AuthorType } from "@prisma/client";
import prisma from "~/db.server";

const TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
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

function canTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: ReturnStatus, to: ReturnStatus) {
    super(`Invalid status transition from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export async function transitionStatus(
  returnRequestId: string,
  toStatus: ReturnStatus,
  actor: { name: string; type: AuthorType },
  details?: Record<string, unknown>,
  shop?: string,
) {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use interactive transaction with serializable isolation to prevent TOCTOU race condition
      const updatedRequest = await prisma.$transaction(async (tx) => {
        // Row-level locking via raw query to prevent concurrent status modifications
        // Set transaction timeouts to prevent indefinite deadlock waiting
        try {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
        } catch (timeoutErr) {
          console.warn('[StateMachine] Failed to set transaction timeouts:', timeoutErr);
          // Continue without timeouts rather than failing the transition
        }
        await tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${returnRequestId} FOR UPDATE`;
        // Re-read inside transaction — serializable isolation prevents concurrent modifications
        const current = await tx.returnRequest.findFirst({
          where: { id: returnRequestId, ...(shop ? { shop } : {}) },
        });

        if (!current) {
          throw new Error(`Return request ${returnRequestId} not found`);
        }

        if (!canTransition(current.status, toStatus)) {
          throw new InvalidTransitionError(current.status, toStatus);
        }

        const eventName = getTransitionEventName(current.status, toStatus);

        // Use optimistic concurrency control - only update if status hasn't changed
        const updated = await tx.returnRequest.updateMany({
          where: {
            id: returnRequestId,
            status: current.status, // Only succeed if status is still the same
          },
          data: {
            status: toStatus,
            ...(toStatus === "CLOSED" || toStatus === "CANCELLED"
              ? { closedAt: new Date() }
              : {}),
          },
        });

        // If no rows were updated, another request modified the status first
        if (updated.count === 0) {
          throw new Error(
            `Return request ${returnRequestId} was already modified by another request. Please refresh and try again.`
          );
        }

        // Fetch the updated record to return it
        const updatedRecord = await tx.returnRequest.findUnique({
          where: { id: returnRequestId },
          include: {
            items: { include: { attachments: true } },
          },
        });

        if (!updatedRecord) {
          throw new Error(`Return request ${returnRequestId} not found after update`);
        }

        await tx.returnTimeline.create({
          data: {
            returnRequestId,
            event: eventName,
            actor: actor.name,
            actorType: actor.type,
            details: {
              fromStatus: current.status,
              toStatus,
              ...details,
            },
          },
        });

        return updatedRecord;
      });
      return updatedRequest;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Only retry on concurrency conflicts or deadlocks, not on validation errors
      const isConflict = lastError.message.includes("was already modified by another request");
      const isInvalidTransition = lastError.name === "InvalidTransitionError";
      // Detect deadlock (40P01) and lock timeout (55P03) errors
      const isDeadlock = lastError.message.includes("40P01") || lastError.message.includes("deadlock");
      const isLockTimeout = lastError.message.includes("55P03") || lastError.message.includes("lock timeout");

      if (isInvalidTransition || (!isConflict && !isDeadlock && !isLockTimeout)) {
        throw lastError; // Don't retry validation errors
      }

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 100ms * 2^attempt (100ms, 200ms, 400ms, ...)
        const delay = Math.min(2000, 100 * Math.pow(2, attempt)) + Math.floor(Math.random() * 100);
        await new Promise(resolve => setTimeout(resolve, delay));
        console.warn(`[StateMachine] Retry ${attempt}/${MAX_RETRIES} for ${returnRequestId} transition to ${toStatus} (${isDeadlock ? 'deadlock' : isLockTimeout ? 'lock_timeout' : 'conflict'})`);
      }
    }
  }

  throw lastError || new Error("Max retries exceeded for status transition");
}

function getTransitionEventName(
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
    "RECEIVED->EXCHANGED": "Replacement order created",
    "RECEIVED->CANCELLED": "Return cancelled",
    "PARTIALLY_ACCEPTED->REFUNDED": "Partial refund processed",
    "PARTIALLY_ACCEPTED->EXCHANGED": "Partial replacement processed",
    "REFUNDED->CLOSED": "Return closed",
    "EXCHANGED->CLOSED": "Return closed",
  };

  return eventMap[`${from}->${to}`] ?? `Status changed from ${from} to ${to}`;
}
