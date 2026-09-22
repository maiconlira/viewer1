"use server";
// Ações do painel (server actions). Cada uma valida o formulário, executa e revalida as telas afetadas.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { AgentRole, ContractStatus, InvoiceStatus, LeadStage, Platform, PostFormat, PostStatus, CompanyStatus, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { dateField, normalizePhone, num, str } from "@/lib/utils";
import {
  approvePost,
  convertLeadToCompany,
  createIdea,
  createPost,
  requestPostChanges,
  sendContract,
  sendPostForApproval,
  updateLeadStage,
} from "@/lib/services";
import { draftContract, generateCaption, generateIdeas } from "@/lib/content";
import { generateImage, requestVideo } from "@/lib/media";
import { sendWhatsApp } from "@/lib/whatsapp";
import { agentRespond, startOnboarding, startOutreach } from "@/lib/agents/whatsapp-agent";
import { runCommand } from "@/lib/agents/director";
import { setSetting, SETTING_KEYS, type SettingKey } from "@/lib/settings";
import { tick } from "@/lib/automation";

function req(form: FormData, key: string) {
  const v = str(form, key);
  if (!v) throw new Error(`Campo obrigatório: ${key}`);
  return v;
}

// ─────────────── Diretor IA ───────────────

export async function createCommand(form: FormData) {
  const prompt = req(form, "prompt");
  const command = await db.command.create({ data: { prompt } });
  void runCommand(command.id); // executa em segundo plano; a tela atualiza sozinha
  revalidatePath("/comando");
  revalidatePath("/");
}

// ─────────────── Empresas ───────────────

function companyData(form: FormData) {
  return {
    name: req(form, "name"),
    segment: str(form, "segment") ?? null,
    contactName: str(form, "contactName") ?? null,
    whatsapp: normalizePhone(str(form, "whatsapp")),
    email: str(form, "email") ?? null,
    document: str(form, "document") ?? null,
    instagram: str(form, "instagram") ?? null,
    status: (str(form, "status") as CompanyStatus) ?? undefined,
    monthlyFee: num(form, "monthlyFee") ?? null,
    billingDay: num(form, "billingDay") ?? null,
    postsPerMonth: num(form, "postsPerMonth") ?? null,
    brandVoice: str(form, "brandVoice") ?? null,
    brandGuidelines: str(form, "brandGuidelines") ?? null,
    notes: str(form, "notes") ?? null,
  };
}

export async function createCompany(form: FormData) {
  const company = await db.company.create({ data: companyData(form) });
  await logActivity({ type: "company.created", summary: `Cliente cadastrado: ${company.name}`, actor: "ADMIN", companyId: company.id });
  redirect(`/empresas/${company.id}`);
}

export async function updateCompany(id: string, form: FormData) {
  await db.company.update({ where: { id }, data: companyData(form) });
  revalidatePath(`/empresas/${id}`);
  revalidatePath("/empresas");
}

export async function deleteCompany(id: string) {
  await db.company.delete({ where: { id } });
  redirect("/empresas");
}

export async function onboardCompany(id: string) {
  await startOnboarding(id);
  revalidatePath(`/empresas/${id}`);
}

// ─────────────── Conteúdo ───────────────

export async function createPostAction(form: FormData) {
  const post = await createPost({
    companyId: req(form, "companyId"),
    title: req(form, "title"),
    caption: str(form, "caption"),
    platform: str(form, "platform") as Platform | undefined,
    format: str(form, "format") as PostFormat | undefined,
    scheduledAt: dateField(form, "scheduledAt"),
    ideaId: str(form, "ideaId"),
    actor: "ADMIN",
  });
  if (form.get("aiCaption") === "on") await generateCaption(post.id);
  redirect(`/conteudo/${post.id}`);
}

export async function updatePost(id: string, form: FormData) {
  await db.post.update({
    where: { id },
    data: {
      title: req(form, "title"),
      caption: str(form, "caption") ?? null,
      hashtags: str(form, "hashtags") ?? null,
      briefing: str(form, "briefing") ?? null,
      platform: str(form, "platform") as Platform,
      format: str(form, "format") as PostFormat,
      status: str(form, "status") as PostStatus,
      scheduledAt: dateField(form, "scheduledAt") ?? null,
    },
  });
  revalidatePath(`/conteudo/${id}`);
  revalidatePath("/conteudo");
}

export async function setPostStatus(id: string, status: PostStatus) {
  await db.post.update({ where: { id }, data: { status, publishedAt: status === "PUBLISHED" ? new Date() : undefined } });
  revalidatePath("/conteudo");
  revalidatePath(`/conteudo/${id}`);
}

export async function deletePost(id: string) {
  await db.post.delete({ where: { id } });
  redirect("/conteudo");
}

export async function aiCaption(id: string, form: FormData) {
  await generateCaption(id, str(form, "instructions"));
  revalidatePath(`/conteudo/${id}`);
}

export async function aiImage(id: string, form: FormData) {
  const post = await db.post.findUniqueOrThrow({ where: { id } });
  await generateImage({
    prompt: str(form, "prompt") ?? post.briefing ?? post.title,
    postId: id,
    companyId: post.companyId,
    aspectRatio: (str(form, "aspect") as "1:1" | "4:5" | "9:16" | "16:9") ?? "4:5",
  });
  revalidatePath(`/conteudo/${id}`);
}

export async function aiVideo(id: string, form: FormData) {
  const post = await db.post.findUniqueOrThrow({ where: { id } });
  await requestVideo({
    prompt: str(form, "prompt") ?? post.briefing ?? post.title,
    postId: id,
    companyId: post.companyId,
    aspectRatio: (str(form, "aspect") as "1:1" | "4:5" | "9:16" | "16:9") ?? "9:16",
    durationSeconds: str(form, "duration") === "10" ? 10 : 5,
  });
  revalidatePath(`/conteudo/${id}`);
}

export async function addMediaUrl(id: string, form: FormData) {
  const post = await db.post.findUniqueOrThrow({ where: { id } });
  const url = req(form, "url");
  await db.mediaAsset.create({
    data: {
      postId: id,
      companyId: post.companyId,
      url,
      kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "VIDEO" : "IMAGE",
      status: "READY",
      provider: "upload",
    },
  });
  revalidatePath(`/conteudo/${id}`);
}

export async function deleteMedia(mediaId: string, postId: string) {
  await db.mediaAsset.delete({ where: { id: mediaId } });
  revalidatePath(`/conteudo/${postId}`);
}

export async function sendForApproval(id: string) {
  await sendPostForApproval(id, "ADMIN");
  revalidatePath(`/conteudo/${id}`);
  revalidatePath("/conteudo");
}

export async function adminApprovePost(id: string) {
  await approvePost(id, "ADMIN");
  revalidatePath(`/conteudo/${id}`);
}

// ─────────────── Ideias ───────────────

export async function createIdeaAction(form: FormData) {
  await createIdea({ companyId: req(form, "companyId"), title: req(form, "title"), description: str(form, "description") });
  revalidatePath("/ideias");
}

export async function aiIdeas(form: FormData) {
  await generateIdeas(req(form, "companyId"), Math.min(num(form, "count") ?? 5, 20), str(form, "theme"));
  revalidatePath("/ideias");
}

export async function setIdeaStatus(id: string, status: "NEW" | "APPROVED" | "DISCARDED") {
  await db.idea.update({ where: { id }, data: { status } });
  revalidatePath("/ideias");
}

export async function ideaToPost(id: string) {
  const idea = await db.idea.findUniqueOrThrow({ where: { id } });
  const post = await createPost({ companyId: idea.companyId, title: idea.title, ideaId: idea.id, actor: "ADMIN" });
  redirect(`/conteudo/${post.id}`);
}

// ─────────────── Contratos ───────────────

export async function aiContract(form: FormData) {
  const contract = await draftContract({
    companyId: req(form, "companyId"),
    title: str(form, "title"),
    services: req(form, "services"),
    value: num(form, "value") ?? 0,
    months: num(form, "months") ?? 12,
    startDate: dateField(form, "startDate"),
    extraClauses: str(form, "extra"),
  });
  redirect(`/contratos/${contract.id}`);
}

export async function createContract(form: FormData) {
  const contract = await db.contract.create({
    data: {
      companyId: req(form, "companyId"),
      title: req(form, "title"),
      body: req(form, "body"),
      value: num(form, "value"),
      startDate: dateField(form, "startDate"),
      endDate: dateField(form, "endDate"),
    },
  });
  redirect(`/contratos/${contract.id}`);
}

export async function updateContract(id: string, form: FormData) {
  await db.contract.update({
    where: { id },
    data: {
      title: req(form, "title"),
      body: req(form, "body"),
      value: num(form, "value") ?? null,
      startDate: dateField(form, "startDate") ?? null,
      endDate: dateField(form, "endDate") ?? null,
      status: str(form, "status") as ContractStatus,
    },
  });
  revalidatePath(`/contratos/${id}`);
}

export async function sendContractAction(id: string) {
  await sendContract(id, "ADMIN");
  revalidatePath(`/contratos/${id}`);
}

/** Assinatura pública pelo cliente (página /contrato/[token]). */
export async function signContract(token: string, form: FormData) {
  const name = req(form, "name");
  const doc = req(form, "document");
  if (form.get("agree") !== "on") throw new Error("É necessário aceitar os termos.");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const contract = await db.contract.findUniqueOrThrow({ where: { publicToken: token } });
  if (contract.status === "SIGNED") return;
  if (contract.status === "CANCELED" || contract.status === "EXPIRED") throw new Error("Contrato indisponível.");
  await db.contract.update({
    where: { id: contract.id },
    data: { status: "SIGNED", signedAt: new Date(), signedByName: name, signedByDoc: doc, signedIp: ip },
  });
  await db.company.updateMany({ where: { id: contract.companyId, status: "ONBOARDING" }, data: { status: "ACTIVE" } });
  await logActivity({
    type: "contract.signed",
    summary: `✍️ Contrato "${contract.title}" assinado por ${name}`,
    actor: "CLIENTE",
    companyId: contract.companyId,
  });
  revalidatePath(`/contrato/${token}`);
}

// ─────────────── Aprovação pública ───────────────

export async function publicApprove(token: string) {
  const post = await db.post.findUniqueOrThrow({ where: { approvalToken: token } });
  await approvePost(post.id, "CLIENTE (link)");
  revalidatePath(`/aprovar/${token}`);
}

export async function publicRequestChanges(token: string, form: FormData) {
  const post = await db.post.findUniqueOrThrow({ where: { approvalToken: token } });
  await requestPostChanges(post.id, req(form, "feedback"), "CLIENTE (link)");
  revalidatePath(`/aprovar/${token}`);
}

// ─────────────── Prospecção ───────────────

function leadData(form: FormData) {
  return {
    name: req(form, "name"),
    businessName: str(form, "businessName") ?? null,
    segment: str(form, "segment") ?? null,
    phone: normalizePhone(str(form, "phone")),
    email: str(form, "email") ?? null,
    instagram: str(form, "instagram") ?? null,
    source: str(form, "source") ?? null,
    estimatedValue: num(form, "estimatedValue") ?? null,
    notes: str(form, "notes") ?? null,
    agentId: str(form, "agentId") ?? null,
  };
}

export async function createLead(form: FormData) {
  const lead = await db.lead.create({ data: leadData(form) });
  await logActivity({ type: "lead.created", summary: `Lead cadastrado: ${lead.name}`, actor: "ADMIN", leadId: lead.id });
  if (form.get("outreach") === "on" && lead.phone) await startOutreach(lead.id);
  revalidatePath("/prospeccao");
}

/** Importação em massa: uma linha por lead → nome; telefone; empresa; segmento; origem */
export async function importLeads(form: FormData) {
  const raw = req(form, "rows");
  const outreach = form.get("outreach") === "on";
  const agentId = str(form, "agentId");
  let created = 0;
  for (const line of raw.split("\n")) {
    const [name, phone, businessName, segment, source] = line.split(/[;\t]/).map((s) => s?.trim());
    if (!name) continue;
    const p = normalizePhone(phone);
    if (p && (await db.lead.findUnique({ where: { phone: p } }))) continue;
    const lead = await db.lead.create({
      data: { name, phone: p, businessName, segment, source: source || "Importação", agentId },
    });
    created++;
    if (outreach && p) {
      try {
        await startOutreach(lead.id);
      } catch (err) {
        console.error("[import] outreach", err);
      }
    }
  }
  await logActivity({ type: "lead.import", summary: `${created} leads importados`, actor: "ADMIN" });
  revalidatePath("/prospeccao");
}

export async function updateLead(id: string, form: FormData) {
  await db.lead.update({ where: { id }, data: { ...leadData(form), stage: str(form, "stage") as LeadStage } });
  revalidatePath(`/prospeccao/${id}`);
  revalidatePath("/prospeccao");
}

export async function moveLead(id: string, stage: LeadStage) {
  await updateLeadStage(id, stage, "ADMIN");
  revalidatePath("/prospeccao");
  revalidatePath(`/prospeccao/${id}`);
}

export async function outreachLead(id: string) {
  await startOutreach(id);
  revalidatePath(`/prospeccao/${id}`);
}

export async function convertLead(id: string) {
  const company = await convertLeadToCompany(id);
  redirect(`/empresas/${company.id}`);
}

export async function deleteLead(id: string) {
  await db.lead.delete({ where: { id } });
  redirect("/prospeccao");
}

// ─────────────── Agentes ───────────────

function agentData(form: FormData) {
  return {
    name: req(form, "name"),
    role: req(form, "role") as AgentRole,
    persona: req(form, "persona"),
    goals: str(form, "goals") ?? null,
    active: form.get("active") === "on",
    isDefault: form.get("isDefault") === "on",
    followUpDays: num(form, "followUpDays") ?? 2,
    maxFollowUps: num(form, "maxFollowUps") ?? 3,
  };
}

export async function createAgent(form: FormData) {
  const data = agentData(form);
  if (data.isDefault) await db.agent.updateMany({ where: { role: data.role }, data: { isDefault: false } });
  await db.agent.create({ data });
  revalidatePath("/agentes");
}

export async function updateAgent(id: string, form: FormData) {
  const data = agentData(form);
  if (data.isDefault) await db.agent.updateMany({ where: { role: data.role, id: { not: id } }, data: { isDefault: false } });
  await db.agent.update({ where: { id }, data });
  revalidatePath("/agentes");
}

export async function deleteAgent(id: string) {
  await db.agent.delete({ where: { id } });
  revalidatePath("/agentes");
}

// ─────────────── WhatsApp ───────────────

export async function sendManualMessage(conversationId: string, form: FormData) {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  await sendWhatsApp({ phone: conv.phone, text: req(form, "text"), author: "ADMIN", conversationId });
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function setConversationMode(conversationId: string, mode: "AI" | "HUMAN") {
  await db.conversation.update({ where: { id: conversationId }, data: { mode } });
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function setConversationAgent(conversationId: string, form: FormData) {
  await db.conversation.update({ where: { id: conversationId }, data: { agentId: str(form, "agentId") ?? null } });
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function instructAgent(conversationId: string, form: FormData) {
  await agentRespond(conversationId, `Ordem do dono da agência: ${req(form, "instruction")}`);
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function startConversation(form: FormData) {
  const phone = normalizePhone(req(form, "phone"));
  if (!phone) throw new Error("Telefone inválido");
  const r = await sendWhatsApp({ phone, text: req(form, "text"), author: "ADMIN" });
  redirect(`/whatsapp/${r.conversation.id}`);
}

// ─────────────── Financeiro ───────────────

export async function createInvoice(form: FormData) {
  await db.invoice.create({
    data: {
      companyId: req(form, "companyId"),
      description: req(form, "description"),
      amount: num(form, "amount") ?? 0,
      dueDate: dateField(form, "dueDate") ?? new Date(),
      paymentLink: str(form, "paymentLink"),
    },
  });
  revalidatePath("/financeiro");
}

/** Gera as mensalidades do mês para todos os clientes ativos com valor e dia de cobrança. */
export async function generateMonthlyInvoices() {
  const companies = await db.company.findMany({
    where: { status: { in: ["ACTIVE", "ONBOARDING"] }, monthlyFee: { not: null } },
  });
  const now = new Date();
  const ref = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  let created = 0;
  for (const c of companies) {
    const description = `Mensalidade ${ref}`;
    const exists = await db.invoice.findFirst({ where: { companyId: c.id, description } });
    if (exists) continue;
    await db.invoice.create({
      data: {
        companyId: c.id,
        description,
        amount: c.monthlyFee!,
        dueDate: new Date(now.getFullYear(), now.getMonth(), c.billingDay ?? 10, 12),
      },
    });
    created++;
  }
  await logActivity({ type: "invoice.batch", summary: `${created} mensalidades geradas (${ref})`, actor: "ADMIN" });
  revalidatePath("/financeiro");
}

export async function setInvoiceStatus(id: string, status: InvoiceStatus) {
  await db.invoice.update({ where: { id }, data: { status, paidAt: status === "PAID" ? new Date() : null } });
  revalidatePath("/financeiro");
}

// ─────────────── Tarefas ───────────────

export async function createTask(form: FormData) {
  await db.task.create({
    data: {
      title: req(form, "title"),
      description: str(form, "description"),
      companyId: str(form, "companyId"),
      dueDate: dateField(form, "dueDate"),
      priority: num(form, "priority") ?? 2,
    },
  });
  revalidatePath("/tarefas");
}

export async function setTaskStatus(id: string, status: TaskStatus) {
  await db.task.update({ where: { id }, data: { status } });
  revalidatePath("/tarefas");
  revalidatePath("/");
}

// ─────────────── Configurações ───────────────

export async function saveSettings(form: FormData) {
  for (const key of Object.keys(SETTING_KEYS) as SettingKey[]) {
    const v = form.get(key);
    if (typeof v === "string") await setSetting(key, v.trim());
  }
  revalidatePath("/configuracoes");
}

export async function runTickNow() {
  await tick();
  revalidatePath("/");
}
