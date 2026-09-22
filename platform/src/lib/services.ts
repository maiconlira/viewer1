// Operações de negócio reutilizadas pelo painel, pelos agentes de WhatsApp e pelo Diretor IA.
import type { Platform, PostFormat, LeadStage, Prisma } from "@prisma/client";
import { db } from "./db";
import { logActivity } from "./activity";
import { sendWhatsApp } from "./whatsapp";
import { AGENCY_NAME, appUrl, date, money, normalizePhone, postStatusLabel } from "./utils";

// ─────────────── Postagens ───────────────

export async function createPost(input: {
  companyId: string;
  title: string;
  caption?: string;
  hashtags?: string;
  briefing?: string;
  platform?: Platform;
  format?: PostFormat;
  scheduledAt?: Date;
  ideaId?: string;
  actor?: string;
}) {
  const post = await db.post.create({
    data: {
      companyId: input.companyId,
      title: input.title,
      caption: input.caption,
      hashtags: input.hashtags,
      briefing: input.briefing,
      platform: input.platform,
      format: input.format,
      scheduledAt: input.scheduledAt,
      ideaId: input.ideaId,
      status: input.caption ? "PRODUCTION" : "IDEA",
    },
  });
  if (input.ideaId) await db.idea.update({ where: { id: input.ideaId }, data: { status: "CONVERTED" } });
  await logActivity({
    type: "post.created",
    summary: `Postagem criada: ${post.title}`,
    actor: input.actor,
    companyId: post.companyId,
  });
  return post;
}

export async function sendPostForApproval(postId: string, actor = "SYSTEM") {
  const post = await db.post.findUniqueOrThrow({
    where: { id: postId },
    include: { company: true, media: { where: { status: "READY" }, orderBy: { createdAt: "desc" } } },
  });
  if (!post.company.whatsapp) throw new Error(`A empresa ${post.company.name} não tem WhatsApp cadastrado.`);

  const link = appUrl(`/aprovar/${post.approvalToken}`);
  const lines = [
    `Olá${post.company.contactName ? `, ${post.company.contactName.split(" ")[0]}` : ""}! Aqui é da ${AGENCY_NAME} 👋`,
    ``,
    `Temos uma postagem pronta para sua aprovação:`,
    `*${post.title}*${post.scheduledAt ? ` — previsto para ${date(post.scheduledAt, true)}` : ""}`,
  ];
  if (post.caption) lines.push("", `📝 Legenda:`, post.caption);
  if (post.hashtags) lines.push("", post.hashtags);
  lines.push("", `Você pode aprovar pelo link: ${link}`, `ou responder aqui mesmo: *APROVADO* ou me diga o que deseja alterar.`);

  const cover = post.media[0]?.url ?? undefined;
  const result = await sendWhatsApp({
    phone: post.company.whatsapp,
    text: lines.join("\n"),
    mediaUrl: cover,
    author: actor,
  });

  await db.post.update({
    where: { id: post.id },
    data: { status: "PENDING_APPROVAL", sentForApprovalAt: new Date() },
  });
  await logActivity({
    type: "post.sent_for_approval",
    summary: `Postagem "${post.title}" enviada para aprovação`,
    actor,
    companyId: post.companyId,
  });
  return { ok: result.ok, dryRun: result.dryRun ?? false, error: result.error, link };
}

export async function approvePost(postId: string, actor = "CLIENTE") {
  const post = await db.post.update({
    where: { id: postId },
    data: { status: "APPROVED", approvedAt: new Date(), feedback: null },
  });
  await logActivity({
    type: "post.approved",
    summary: `Postagem "${post.title}" aprovada`,
    actor,
    companyId: post.companyId,
  });
  return post;
}

export async function requestPostChanges(postId: string, feedback: string, actor = "CLIENTE") {
  const post = await db.post.update({
    where: { id: postId },
    data: { status: "CHANGES_REQUESTED", feedback },
  });
  await db.task.create({
    data: {
      companyId: post.companyId,
      title: `Ajustar postagem: ${post.title}`,
      description: feedback,
      priority: 1,
      createdBy: actor,
    },
  });
  await logActivity({
    type: "post.changes_requested",
    summary: `Alteração pedida em "${post.title}": ${feedback.slice(0, 140)}`,
    actor,
    companyId: post.companyId,
  });
  return post;
}

export async function pendingApprovals(companyId: string) {
  return db.post.findMany({
    where: { companyId, status: { in: ["PENDING_APPROVAL", "CHANGES_REQUESTED"] } },
    orderBy: { sentForApprovalAt: "desc" },
    select: { id: true, title: true, caption: true, status: true, scheduledAt: true, feedback: true },
  });
}

export async function companySchedule(companyId: string, days = 30) {
  const from = new Date();
  const to = new Date(Date.now() + days * 86400000);
  const posts = await db.post.findMany({
    where: { companyId, scheduledAt: { gte: from, lte: to } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, title: true, platform: true, format: true, status: true, scheduledAt: true },
  });
  return posts.map((p) => ({ ...p, status: postStatusLabel[p.status], scheduledAt: date(p.scheduledAt, true) }));
}

// ─────────────── Ideias ───────────────

export async function createIdea(input: {
  companyId: string;
  title: string;
  description?: string;
  source?: "ADMIN" | "AI" | "CLIENT";
}) {
  const idea = await db.idea.create({ data: input });
  await logActivity({
    type: "idea.created",
    summary: `Nova ideia (${input.source ?? "ADMIN"}): ${idea.title}`,
    actor: input.source ?? "ADMIN",
    companyId: idea.companyId,
  });
  return idea;
}

// ─────────────── Contratos ───────────────

export async function sendContract(contractId: string, actor = "SYSTEM") {
  const contract = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { company: true } });
  if (!contract.company.whatsapp) throw new Error(`A empresa ${contract.company.name} não tem WhatsApp cadastrado.`);
  const link = appUrl(`/contrato/${contract.publicToken}`);
  const text = [
    `Olá${contract.company.contactName ? `, ${contract.company.contactName.split(" ")[0]}` : ""}!`,
    `Segue o contrato *${contract.title}*${contract.value ? ` (${money(contract.value)})` : ""} para leitura e assinatura digital:`,
    link,
    ``,
    `Qualquer dúvida, é só responder esta mensagem.`,
  ].join("\n");
  const result = await sendWhatsApp({ phone: contract.company.whatsapp, text, author: actor });
  await db.contract.update({ where: { id: contract.id }, data: { status: "SENT", sentAt: new Date() } });
  await logActivity({
    type: "contract.sent",
    summary: `Contrato "${contract.title}" enviado para ${contract.company.name}`,
    actor,
    companyId: contract.companyId,
  });
  return { ok: result.ok, dryRun: result.dryRun ?? false, link };
}

// ─────────────── Prospecção ───────────────

export async function updateLeadStage(leadId: string, stage: LeadStage, actor = "ADMIN", note?: string) {
  const current = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const lead = await db.lead.update({
    where: { id: leadId },
    data: {
      stage,
      notes: note ? [current.notes, `[${date(new Date(), true)}] ${note}`].filter(Boolean).join("\n") : undefined,
      // Negócio encerrado (ganho ou perdido) não recebe mais follow-up automático.
      nextFollowUpAt: stage === "WON" || stage === "LOST" ? null : undefined,
    },
  });
  await logActivity({ type: "lead.stage", summary: `${lead.name} → ${stage}`, actor, leadId });
  return lead;
}

/** Converte um lead fechado em empresa cliente (e amarra a conversa de WhatsApp). */
export async function convertLeadToCompany(leadId: string, extra: Partial<Prisma.CompanyCreateInput> = {}) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.convertedCompanyId) return db.company.findUniqueOrThrow({ where: { id: lead.convertedCompanyId } });

  const phone = normalizePhone(lead.phone);
  const existing = phone ? await db.company.findUnique({ where: { whatsapp: phone } }) : null;
  const company =
    existing ??
    (await db.company.create({
      data: {
        name: lead.businessName || lead.name,
        contactName: lead.name,
        whatsapp: phone,
        email: lead.email,
        instagram: lead.instagram,
        segment: lead.segment,
        monthlyFee: lead.estimatedValue ?? undefined,
        status: "ONBOARDING",
        notes: lead.notes,
        ...extra,
      },
    }));

  await db.lead.update({ where: { id: lead.id }, data: { stage: "WON", convertedCompanyId: company.id, nextFollowUpAt: null } });
  if (phone) {
    const postSales = await db.agent.findFirst({ where: { role: "POST_SALES", active: true }, orderBy: { isDefault: "desc" } });
    await db.conversation.updateMany({
      where: { phone },
      data: { companyId: company.id, agentId: postSales?.id ?? null },
    });
  }
  await logActivity({
    type: "lead.won",
    summary: `🎉 ${lead.name} virou cliente (${company.name})`,
    leadId: lead.id,
    companyId: company.id,
  });
  return company;
}

// ─────────────── Operação ───────────────

export async function escalateToAdmin(input: {
  title: string;
  description?: string;
  companyId?: string | null;
  leadId?: string | null;
  actor: string;
}) {
  const task = await db.task.create({
    data: {
      title: input.title,
      description: input.description,
      companyId: input.companyId ?? undefined,
      leadId: input.leadId ?? undefined,
      forAdmin: true,
      priority: 1,
      createdBy: input.actor,
    },
  });
  await logActivity({
    type: "admin.escalation",
    summary: `⚠️ ${input.actor} precisa de você: ${input.title}`,
    actor: input.actor,
    companyId: input.companyId,
    leadId: input.leadId,
  });
  return task;
}

export async function dashboardSummary() {
  const now = new Date();
  const [activeCompanies, mrr, pendingApprovals, changes, leadsByStage, overdue, openTasks, escalations, upcoming] =
    await Promise.all([
      db.company.count({ where: { status: { in: ["ACTIVE", "ONBOARDING"] } } }),
      db.company.aggregate({ _sum: { monthlyFee: true }, where: { status: { in: ["ACTIVE", "ONBOARDING"] } } }),
      db.post.count({ where: { status: "PENDING_APPROVAL" } }),
      db.post.count({ where: { status: "CHANGES_REQUESTED" } }),
      db.lead.groupBy({ by: ["stage"], _count: true }),
      db.invoice.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { OR: [{ status: "OVERDUE" }, { status: "PENDING", dueDate: { lt: now } }] },
      }),
      db.task.count({ where: { status: { not: "DONE" } } }),
      db.task.count({ where: { status: { not: "DONE" }, forAdmin: true } }),
      db.post.count({ where: { scheduledAt: { gte: now, lte: new Date(Date.now() + 7 * 86400000) } } }),
    ]);
  return {
    activeCompanies,
    mrr: Number(mrr._sum.monthlyFee ?? 0),
    pendingApprovals,
    changesRequested: changes,
    leadsByStage: Object.fromEntries(leadsByStage.map((g) => [g.stage, g._count])),
    overdueInvoices: { count: overdue._count, total: Number(overdue._sum.amount ?? 0) },
    openTasks,
    escalations,
    postsNext7Days: upcoming,
  };
}
