import prisma from "~/db.server";
import type { AuthorType } from "@prisma/client";

export async function addComment(shop: string, data: {
  returnRequestId: string;
  author: string;
  authorType: AuthorType;
  content: string;
  isInternal?: boolean;
}) {
  // Validate shop ownership before creating comment
  const returnRequest = await prisma.returnRequest.findFirst({
    where: { id: data.returnRequestId, shop },
  });
  if (!returnRequest) {
    throw new Error("Return request not found");
  }

  // Bug #391 Fix: Validate comment length to prevent extremely long strings
  if (data.content && data.content.length > 10000) {
    throw new Error("Comment content must not exceed 10000 characters");
  }

  return prisma.returnComment.create({
    data: {
      returnRequestId: data.returnRequestId,
      author: data.author,
      authorType: data.authorType,
      content: data.content,
      isInternal: data.isInternal ?? false,
    },
  });
}
