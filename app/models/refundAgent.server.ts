import prisma from "~/db.server";

export async function listAgents(shop: string) {
  return prisma.refundAgent.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export async function addAgent(shop: string, email: string, name: string | null, addedBy: string) {
  const normalizedEmail = email.toLowerCase().trim();
  return prisma.refundAgent.upsert({
    where: { shop_email: { shop, email: normalizedEmail } },
    update: { name, addedBy, active: true },
    create: { shop, email: normalizedEmail, name, addedBy, active: true },
  });
}

export async function removeAgent(shop: string, agentId: string) {
  return prisma.refundAgent.deleteMany({
    where: { id: agentId, shop },
  });
}

export async function toggleAgent(shop: string, agentId: string, active: boolean) {
  return prisma.refundAgent.updateMany({
    where: { id: agentId, shop },
    data: { active },
  });
}

export async function isActiveAgent(shop: string, email: string): Promise<boolean> {
  const agent = await prisma.refundAgent.findUnique({
    where: { shop_email: { shop, email: email.toLowerCase().trim() } },
  });
  return !!agent && agent.active;
}
