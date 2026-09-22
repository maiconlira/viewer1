"use server";
// Ações do painel (server actions). Cada uma valida o formulário, executa e revalida as telas afetadas.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AgentRole, ContractStatus, InvoiceStatus, LeadStage, Platform, PostFormat, PostStatus, CompanyStatus, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-server";
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
import { tick } from "@/lib/automation";
import { encrypt } from "@/lib/crypto";
import { OPTION_DEFAULTS, SETTING_KEYS, getSecret, setSecret, setSetting, type OptionKey, type SettingKey } from "@/lib/settings";
import { listMetaPages } from "@/lib/meta";
import { publishPost } from "@/lib/publishing";
import { createCharge, sendInvoice } from "@/lib/mercadopago";
import { ensureMonthlyInvoices } from "@/lib/billing";
import { bookMeeting, cancelMeeting } from "@/lib/agenda";
import { generateReport, sendReport } from "@/lib/reports";
import { publicUrlFor } from "@/lib/storage";

function req(form: FormData, key: string) {
  const v = str(form, key);
  if (!v) throw new Error(`Campo obrigatório: ${key}`);
  return v;
}

// ─────────────── Diretor IA ───────────────

export async function createCommand(form: FormData) {
  await requireAdmin();
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
  await requireAdmin();
  const company = await db.company.create({ data: companyData(form) });
  await logActivity({ type: "company.created", summary: `Cliente cadastrado: ${company.name}`, actor: "ADMIN", companyId: company.id });
  redirect(`/empresas/${company.id}`);
}

export async function updateCompany(id: string, form: FormData) {
  await requireAdmin();
  await db.company.update({ where: { id }, data: companyData(form) });
  revalidatePath(`/empresas/${id}`);
  revalidatePath("/empresas");
}

export async function deleteCompany(id: string) {
  await requireAdmin();
  await db.company.delete({ where: { id } });
  redirect("/empresas");
}

export async function onboardCompany(id: string) {
  await requireAdmin();
  await startOnboarding(id);
  revalidatePath(`/empresas/${id}`);
}

// ─────────────── Conteúdo ───────────────

export async function createPostAction(form: FormData) {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
  await db.post.update({ where: { id }, data: { status, publishedAt: status === "PUBLISHED" ? new Date() : undefined } });
  revalidatePath("/conteudo");
  revalidatePath(`/conteudo/${id}`);
}

export async function deletePost(id: string) {
  await requireAdmin();
  await db.post.delete({ where: { id } });
  redirect("/conteudo");
}

export async function aiCaption(id: string, form: FormData) {
  await requireAdmin();
  await generateCaption(id, str(form, "instructions"));
  revalidatePath(`/conteudo/${id}`);
}

export async function aiImage(id: string, form: FormData) {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
  await db.mediaAsset.delete({ where: { id: mediaId } });
  revalidatePath(`/conteudo/${postId}`);
}

export async function sendForApproval(id: string) {
  await requireAdmin();
  await sendPostForApproval(id, "ADMIN");
  revalidatePath(`/conteudo/${id}`);
  revalidatePath("/conteudo");
}

export async function adminApprovePost(id: string) {
  await requireAdmin();
  await approvePost(id, "ADMIN");
  revalidatePath(`/conteudo/${id}`);
}

// ─────────────── Ideias ───────────────

export async function createIdeaAction(form: FormData) {
  await requireAdmin();
  await createIdea({ companyId: req(form, "companyId"), title: req(form, "title"), description: str(form, "description") });
  revalidatePath("/ideias");
}

export async function aiIdeas(form: FormData) {
  await requireAdmin();
  await generateIdeas(req(form, "companyId"), Math.min(num(form, "count") ?? 5, 20), str(form, "theme"));
  revalidatePath("/ideias");
}

export async function setIdeaStatus(id: string, status: "NEW" | "APPROVED" | "DISCARDED") {
  await requireAdmin();
  await db.idea.update({ where: { id }, data: { status } });
  revalidatePath("/ideias");
}

export async function ideaToPost(id: string) {
  await requireAdmin();
  const idea = await db.idea.findUniqueOrThrow({ where: { id } });
  const post = await createPost({ companyId: idea.companyId, title: idea.title, ideaId: idea.id, actor: "ADMIN" });
  redirect(`/conteudo/${post.id}`);
}

// ─────────────── Contratos ───────────────

export async function aiContract(form: FormData) {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
  await sendContract(id, "ADMIN");
  revalidatePath(`/contratos/${id}`);
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
  await requireAdmin();
  const lead = await db.lead.create({ data: leadData(form) });
  await logActivity({ type: "lead.created", summary: `Lead cadastrado: ${lead.name}`, actor: "ADMIN", leadId: lead.id });
  if (form.get("outreach") === "on" && lead.phone) await startOutreach(lead.id);
  revalidatePath("/prospeccao");
}

/** Importação em massa: uma linha por lead → nome; telefone; empresa; segmento; origem */
export async function importLeads(form: FormData) {
  await requireAdmin();
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
  await requireAdmin();
  await db.lead.update({ where: { id }, data: { ...leadData(form), stage: str(form, "stage") as LeadStage } });
  revalidatePath(`/prospeccao/${id}`);
  revalidatePath("/prospeccao");
}

export async function moveLead(id: string, stage: LeadStage) {
  await requireAdmin();
  await updateLeadStage(id, stage, "ADMIN");
  revalidatePath("/prospeccao");
  revalidatePath(`/prospeccao/${id}`);
}

export async function outreachLead(id: string) {
  await requireAdmin();
  await startOutreach(id);
  revalidatePath(`/prospeccao/${id}`);
}

export async function convertLead(id: string) {
  await requireAdmin();
  const company = await convertLeadToCompany(id);
  redirect(`/empresas/${company.id}`);
}

export async function deleteLead(id: string) {
  await requireAdmin();
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
  await requireAdmin();
  const data = agentData(form);
  if (data.isDefault) await db.agent.updateMany({ where: { role: data.role }, data: { isDefault: false } });
  await db.agent.create({ data });
  revalidatePath("/agentes");
}

export async function updateAgent(id: string, form: FormData) {
  await requireAdmin();
  const data = agentData(form);
  if (data.isDefault) await db.agent.updateMany({ where: { role: data.role, id: { not: id } }, data: { isDefault: false } });
  await db.agent.update({ where: { id }, data });
  revalidatePath("/agentes");
}

export async function deleteAgent(id: string) {
  await requireAdmin();
  await db.agent.delete({ where: { id } });
  revalidatePath("/agentes");
}

// ─────────────── WhatsApp ───────────────

export async function sendManualMessage(conversationId: string, form: FormData) {
  await requireAdmin();
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  await sendWhatsApp({ phone: conv.phone, text: req(form, "text"), author: "ADMIN", conversationId });
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function setConversationMode(conversationId: string, mode: "AI" | "HUMAN") {
  await requireAdmin();
  await db.conversation.update({ where: { id: conversationId }, data: { mode } });
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function setConversationAgent(conversationId: string, form: FormData) {
  await requireAdmin();
  await db.conversation.update({ where: { id: conversationId }, data: { agentId: str(form, "agentId") ?? null } });
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function instructAgent(conversationId: string, form: FormData) {
  await requireAdmin();
  await agentRespond(conversationId, `Ordem do dono da agência: ${req(form, "instruction")}`);
  revalidatePath(`/whatsapp/${conversationId}`);
}

export async function startConversation(form: FormData) {
  await requireAdmin();
  const phone = normalizePhone(req(form, "phone"));
  if (!phone) throw new Error("Telefone inválido");
  const r = await sendWhatsApp({ phone, text: req(form, "text"), author: "ADMIN" });
  redirect(`/whatsapp/${r.conversation.id}`);
}

// ─────────────── Financeiro ───────────────

export async function createInvoice(form: FormData) {
  await requireAdmin();
  const inv = await db.invoice.create({
    data: {
      companyId: req(form, "companyId"),
      description: req(form, "description"),
      amount: num(form, "amount") ?? 0,
      dueDate: dateField(form, "dueDate") ?? new Date(),
      paymentLink: str(form, "paymentLink"),
    },
  });
  if (form.get("send") === "on") await sendInvoice(inv.id, "new", "ADMIN");
  revalidatePath("/financeiro");
}

/** Gera as mensalidades do mês para todos os clientes ativos (e envia cobrança se o Mercado Pago estiver ativo). */
export async function generateMonthlyInvoices() {
  await requireAdmin();
  await ensureMonthlyInvoices({ force: true });
  revalidatePath("/financeiro");
}

export async function createChargeAction(id: string) {
  await requireAdmin();
  await createCharge(id);
  revalidatePath("/financeiro");
}

export async function sendInvoiceAction(id: string) {
  await requireAdmin();
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  await sendInvoice(id, inv.status === "OVERDUE" ? "overdue" : inv.sentAt ? "reminder" : "new", "ADMIN");
  revalidatePath("/financeiro");
}

export async function setInvoiceStatus(id: string, status: InvoiceStatus) {
  await requireAdmin();
  await db.invoice.update({ where: { id }, data: { status, paidAt: status === "PAID" ? new Date() : null } });
  revalidatePath("/financeiro");
}

// ─────────────── Tarefas ───────────────

export async function createTask(form: FormData) {
  await requireAdmin();
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
  await requireAdmin();
  await db.task.update({ where: { id }, data: { status } });
  revalidatePath("/tarefas");
  revalidatePath("/");
}

// ─────────────── Configurações ───────────────

export async function saveSettings(form: FormData) {
  await requireAdmin();
  for (const key of [...Object.keys(SETTING_KEYS), ...Object.keys(OPTION_DEFAULTS)] as (SettingKey | OptionKey)[]) {
    const v = form.get(key);
    if (typeof v === "string") await setSetting(key, v.trim());
  }
  revalidatePath("/configuracoes");
}

export async function disconnectMeta() {
  await requireAdmin();
  await setSecret("meta_user_token", null);
  await setSecret("meta_user_name", null);
  revalidatePath("/configuracoes");
}

// ─────────────── Redes sociais da empresa ───────────────

/** Vincula a página do Facebook (e o Instagram ligado a ela) escolhida na lista da conta conectada. */
export async function linkMetaPage(companyId: string, form: FormData) {
  await requireAdmin();
  const pageId = req(form, "pageId");
  const userToken = await getSecret("meta_user_token");
  if (!userToken) throw new Error("Conecte a conta do Facebook em Configurações.");
  const page = (await listMetaPages(userToken)).find((p) => p.id === pageId);
  if (!page) throw new Error("Página não encontrada na conta conectada.");
  await db.company.update({
    where: { id: companyId },
    data: {
      fbPageId: page.id,
      fbPageName: page.name,
      igUserId: page.instagram_business_account?.id ?? null,
      igUsername: page.instagram_business_account?.username ?? null,
      metaToken: encrypt(page.access_token),
    },
  });
  await logActivity({ type: "company.social", summary: `Redes conectadas: ${page.name}`, actor: "ADMIN", companyId });
  revalidatePath(`/empresas/${companyId}`);
}

/** Configuração manual (IDs + token de página gerado no painel da Meta). */
export async function saveMetaManual(companyId: string, form: FormData) {
  await requireAdmin();
  const token = str(form, "token");
  await db.company.update({
    where: { id: companyId },
    data: {
      fbPageId: str(form, "fbPageId") ?? null,
      igUserId: str(form, "igUserId") ?? null,
      ...(token ? { metaToken: encrypt(token) } : {}),
    },
  });
  revalidatePath(`/empresas/${companyId}`);
}

export async function savePublishOptions(companyId: string, form: FormData) {
  await requireAdmin();
  await db.company.update({
    where: { id: companyId },
    data: { autoPublish: form.get("autoPublish") === "on", crosspostFacebook: form.get("crosspostFacebook") === "on" },
  });
  revalidatePath(`/empresas/${companyId}`);
}

export async function unlinkMeta(companyId: string) {
  await requireAdmin();
  await db.company.update({
    where: { id: companyId },
    data: { fbPageId: null, fbPageName: null, igUserId: null, igUsername: null, metaToken: null },
  });
  revalidatePath(`/empresas/${companyId}`);
}

// ─────────────── Publicação e mídia ───────────────

export async function publishNow(postId: string) {
  await requireAdmin();
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  if (!["APPROVED", "SCHEDULED"].includes(post.status)) throw new Error("Só é possível publicar postagens aprovadas.");
  // nova tentativa manual zera falhas anteriores
  if (post.publishState === "FAILED" || post.publishState === "MANUAL") {
    await db.post.update({ where: { id: postId }, data: { publishState: null, publishAttempts: 0, igContainerId: null } });
  }
  await publishPost(postId, "ADMIN");
  revalidatePath(`/conteudo/${postId}`);
}

/** Registra um arquivo que o navegador acabou de enviar ao R2. */
export async function registerUpload(input: { postId?: string; companyId?: string; key: string; contentType: string }) {
  await requireAdmin();
  if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(input.key)) throw new Error("Chave inválida");
  const post = input.postId ? await db.post.findUniqueOrThrow({ where: { id: input.postId } }) : null;
  await db.mediaAsset.create({
    data: {
      postId: post?.id,
      companyId: post?.companyId ?? input.companyId,
      url: publicUrlFor(input.key),
      storageKey: input.key,
      kind: input.contentType.startsWith("video/") ? "VIDEO" : "IMAGE",
      status: "READY",
      provider: "r2",
    },
  });
  if (post) revalidatePath(`/conteudo/${post.id}`);
}

// ─────────────── Agenda ───────────────

export async function bookMeetingAction(form: FormData) {
  await requireAdmin();
  const start = dateField(form, "start");
  if (!start) throw new Error("Informe data e hora");
  const leadId = str(form, "leadId");
  const companyId = str(form, "companyId");
  await bookMeeting({
    start,
    title: req(form, "title"),
    description: str(form, "description"),
    leadId,
    companyId,
    attendeeEmail: str(form, "email"),
    bookedBy: "ADMIN",
  });
  revalidatePath("/agenda");
}

export async function cancelMeetingAction(id: string) {
  await requireAdmin();
  await cancelMeeting(id, "ADMIN");
  revalidatePath("/agenda");
}

export async function setMeetingStatus(id: string, status: "DONE" | "NO_SHOW") {
  await requireAdmin();
  await db.meeting.update({ where: { id }, data: { status } });
  revalidatePath("/agenda");
}

// ─────────────── Relatórios ───────────────

export async function generateReportAction(form: FormData) {
  await requireAdmin();
  const report = await generateReport(req(form, "companyId"), req(form, "period"));
  redirect(`/relatorios/${report.id}`);
}

export async function regenerateReport(id: string) {
  await requireAdmin();
  const r = await db.report.findUniqueOrThrow({ where: { id } });
  await generateReport(r.companyId, r.period);
  revalidatePath(`/relatorios/${id}`);
}

export async function updateReport(id: string, form: FormData) {
  await requireAdmin();
  await db.report.update({
    where: { id },
    data: { headline: str(form, "headline") ?? null, summary: str(form, "summary") ?? null, analysis: str(form, "analysis") ?? null },
  });
  revalidatePath(`/relatorios/${id}`);
}

export async function sendReportAction(id: string) {
  await requireAdmin();
  await sendReport(id, "ADMIN");
  revalidatePath(`/relatorios/${id}`);
  revalidatePath("/relatorios");
}

export async function runTickNow() {
  await requireAdmin();
  await tick();
  revalidatePath("/");
}
