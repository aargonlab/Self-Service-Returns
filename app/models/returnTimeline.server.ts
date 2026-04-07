import prisma from "~/db.server";
import type { AuthorType } from "@prisma/client";
import { Prisma } from "@prisma/client";

export async function addTimelineEvent(data: {
  returnRequestId: string;
  event: string;
  actor: string;
  actorType: AuthorType;
  details?: Record<string, unknown>;
  shop: string;
}) {
  // Bug #354 Fix: Shop parameter is now required
  // Validate shop ownership (defense-in-depth)
  const returnRequest = await prisma.returnRequest.findFirst({
    where: { id: data.returnRequestId, shop: data.shop },
  });
  if (!returnRequest) {
    throw new Error("Return request not found");
  }

  return prisma.returnTimeline.create({
    data: {
      returnRequestId: data.returnRequestId,
      event: data.event,
      actor: data.actor,
      actorType: data.actorType,
      details: data.details ? (data.details as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}
