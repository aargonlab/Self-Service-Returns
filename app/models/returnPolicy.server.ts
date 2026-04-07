import prisma from "~/db.server";
import type { PolicyType } from "@prisma/client";
import { Prisma } from "@prisma/client";

export interface PolicyCondition {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "greater_than" | "less_than" | "in" | "not_in";
  value: string | number | string[];
}

export interface PolicyOutcome {
  action: "EXCLUDE" | "AUTO_APPROVE" | "AUTO_REJECT" | "REQUIRE_PHOTO" | "MANUAL_REVIEW" | "OVERRIDE_WINDOW";
  message?: string;
  returnWindowDays?: number;
  manualReviewReasonIds?: string[]; // reason IDs that override AUTO_APPROVE to MANUAL_REVIEW
}

export async function createPolicy(data: {
  shop: string;
  name: string;
  description?: string;
  type: PolicyType;
  priority?: number;
  conditions: PolicyCondition[];
  outcome: PolicyOutcome;
}) {
  // Validate JSON structure
  if (!Array.isArray(data.conditions)) throw new Error("conditions must be an array");
  if (!data.outcome || typeof data.outcome !== 'object') throw new Error("outcome must be an object");

  // Validate condition structure
  for (const cond of data.conditions) {
    if (!cond.field || typeof cond.field !== "string") throw new Error("Each condition must have a 'field' string");
    if (!cond.operator || typeof cond.operator !== "string") throw new Error("Each condition must have an 'operator' string");
    if (cond.value === undefined || cond.value === null) throw new Error("Each condition must have a 'value'");
  }

  // Bug #386: Validate returnWindowDays in OVERRIDE_WINDOW policies
  if (data.outcome.action === "OVERRIDE_WINDOW") {
    if (
      data.outcome.returnWindowDays === undefined ||
      typeof data.outcome.returnWindowDays !== "number" ||
      data.outcome.returnWindowDays < 1 ||
      data.outcome.returnWindowDays > 365
    ) {
      throw new Error("OVERRIDE_WINDOW policies must have returnWindowDays between 1 and 365");
    }
  }

  return prisma.returnPolicy.create({
    data: {
      ...data,
      conditions: data.conditions as unknown as Prisma.InputJsonValue,
      outcome: data.outcome as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updatePolicy(id: string, shop: string, data: {
  name?: string;
  description?: string;
  priority?: number;
  active?: boolean;
  conditions?: PolicyCondition[];
  outcome?: PolicyOutcome;
}) {
  // Verify ownership first
  const policy = await prisma.returnPolicy.findFirst({ where: { id, shop } });
  if (!policy) throw new Error("Policy not found");

  // Validate JSON structure if provided
  if (data.conditions !== undefined && !Array.isArray(data.conditions)) {
    throw new Error("conditions must be an array");
  }
  if (data.outcome !== undefined && (!data.outcome || typeof data.outcome !== 'object')) {
    throw new Error("outcome must be an object");
  }

  // Bug #386: Validate returnWindowDays in OVERRIDE_WINDOW policies
  if (data.outcome?.action === "OVERRIDE_WINDOW") {
    if (
      data.outcome.returnWindowDays === undefined ||
      typeof data.outcome.returnWindowDays !== "number" ||
      data.outcome.returnWindowDays < 1 ||
      data.outcome.returnWindowDays > 365
    ) {
      throw new Error("OVERRIDE_WINDOW policies must have returnWindowDays between 1 and 365");
    }
  }

  const updateData: Prisma.ReturnPolicyUpdateInput = {
    name: data.name,
    description: data.description,
    priority: data.priority,
    active: data.active,
    ...(data.conditions !== undefined && {
      conditions: data.conditions as unknown as Prisma.InputJsonValue,
    }),
    ...(data.outcome !== undefined && {
      outcome: data.outcome as unknown as Prisma.InputJsonValue,
    }),
  };

  return prisma.returnPolicy.update({
    where: { id },
    data: updateData,
  });
}

export async function deletePolicy(id: string, shop: string) {
  // Verify ownership first
  const policy = await prisma.returnPolicy.findFirst({ where: { id, shop } });
  if (!policy) throw new Error("Policy not found");

  return prisma.returnPolicy.delete({ where: { id } });
}

export async function getPolicy(id: string, shop: string) {
  return prisma.returnPolicy.findFirst({
    where: { id, shop },
  });
}

export async function listPolicies(shop: string, type?: PolicyType) {
  return prisma.returnPolicy.findMany({
    where: { shop, ...(type ? { type } : {}) },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
}

export async function getActivePolicies(shop: string) {
  return prisma.returnPolicy.findMany({
    where: { shop, active: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
}

export async function savePolicyEvaluation(data: {
  returnRequestId?: string;
  shop: string;
  shopifyOrderId: string;
  results: Array<{ policyId: string; policyName: string; matched: boolean; outcome: string }>;
  finalOutcome: string;
  reasons: string[];
}) {
  return prisma.policyEvaluation.create({ data });
}
