import type { ReturnStatus, AuthorType } from "@prisma/client";
import prisma from "~/db.server";
import {
  canTransition,
  getAvailableTransitions,
  getTransitionEventName,
  InvalidTransitionError,
} from "~/services/stateMachine.transitions";

export { getAvailableTransitions, InvalidTransitionError };

export async function transitionStatus(
  returnRequestId: string,
  toStatus: ReturnStatus,
  actor: { name: string; type: AuthorType },
  details?: Record<string, unknown>,
  shop?: string,
  // Server-only escape hatch: when true, skip the state-machine edge check.
  // Reserved for API-driven flows that intentionally short-circuit the
  // physical-return path (e.g. ERP-driven refunds before goods are received).
  // Never expose this through user-facing inputs.
  options?: { force?: boolean },
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

        if (!options?.force && !canTransition(current.status, toStatus)) {
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
