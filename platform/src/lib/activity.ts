import type { Prisma } from "@prisma/client";
import { db } from "./db";

export async function logActivity(input: {
  type: string;
  summary: string;
  actor?: string;
  companyId?: string | null;
  leadId?: string | null;
  data?: Prisma.InputJsonValue;
}) {
  try {
    await db.activity.create({
      data: {
        type: input.type,
        summary: input.summary,
        actor: input.actor ?? "SYSTEM",
        companyId: input.companyId ?? undefined,
        leadId: input.leadId ?? undefined,
        data: input.data,
      },
    });
  } catch (err) {
    console.error("[activity] falha ao registrar", err);
  }
}
