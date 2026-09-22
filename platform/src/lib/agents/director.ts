// Diretor IA: recebe ordens do dono em linguagem natural e executa usando toda a plataforma.
// Ex.: "Planeje 8 posts de outubro para a Padaria Sol, gere as artes e mande para aprovação"
//      "Cadastre esses 5 leads e peça para a Lara abordar todos hoje"
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { runAgent, tool, type AgentTool } from "../claude";
import { draftContract, generateCaption, generateIdeas } from "../content";
import { generateImage, requestVideo } from "../media";
import {
  convertLeadToCompany,
  createPost,
  dashboardSummary,
  sendContract,
  sendPostForApproval,
  updateLeadStage,
} from "../services";
import { sendWhatsApp } from "../whatsapp";
import { agentRespond, startOnboarding, startOutreach } from "./whatsapp-agent";
import { getOrCreateConversation } from "../whatsapp";
import { logActivity } from "../activity";
import { AGENCY_NAME, date, money, normalizePhone, parseLocalDate } from "../utils";
import { getSetting } from "../settings";
import { publishPost } from "../publishing";
import { createCharge, sendInvoice } from "../mercadopago";
import { ensureMonthlyInvoices } from "../billing";
import { availableSlots, bookMeeting, cancelMeeting } from "../agenda";
import { generateReport, periodLabel, previousPeriod, sendReport } from "../reports";

const ACTOR = "Diretor IA";

const platform = z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN", "YOUTUBE", "OTHER"]);
const format = z.enum(["FEED", "CAROUSEL", "REELS", "STORY", "VIDEO", "TEXT"]);
const aspect = z.enum(["1:1", "4:5", "9:16", "16:9"]);

function parseDate(value?: string) {
  if (!value) return undefined;
  const d = parseLocalDate(value);
  if (!d) throw new Error(`Data inválida: ${value}. Use ISO 8601 (ex.: 2026-10-05T10:00:00-03:00).`);
  return d;
}

function directorTools(): AgentTool[] {
  return [
    // ── Visão geral ──
    tool({
      name: "get_dashboard",
      description: "Resumo da agência: clientes ativos, MRR, aprovações pendentes, funil de leads, inadimplência, pendências.",
      schema: z.object({}),
      run: async () => dashboardSummary(),
    }),
    tool({
      name: "list_companies",
      description: "Lista empresas clientes (id, nome, status, mensalidade, WhatsApp).",
      schema: z.object({ search: z.string().optional() }),
      run: async ({ search }) =>
        (
          await db.company.findMany({
            where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            select: { id: true, name: true, status: true, monthlyFee: true, whatsapp: true, segment: true, postsPerMonth: true },
          })
        ).map((c) => ({ ...c, monthlyFee: c.monthlyFee ? money(c.monthlyFee) : null })),
    }),
    tool({
      name: "get_company",
      description: "Detalhes de uma empresa: marca, postagens recentes, contratos, faturas e ideias abertas.",
      schema: z.object({ company_id: z.string() }),
      run: async ({ company_id }) =>
        db.company.findUniqueOrThrow({
          where: { id: company_id },
          include: {
            posts: { orderBy: { createdAt: "desc" }, take: 15, select: { id: true, title: true, status: true, scheduledAt: true } },
            contracts: { select: { id: true, title: true, status: true, value: true, endDate: true } },
            invoices: { where: { status: { in: ["PENDING", "OVERDUE"] } }, select: { id: true, amount: true, dueDate: true, status: true } },
            ideas: { where: { status: "NEW" }, select: { id: true, title: true } },
          },
        }),
    }),
    tool({
      name: "create_company",
      description: "Cadastra uma nova empresa cliente.",
      schema: z.object({
        name: z.string(),
        contact_name: z.string().optional(),
        whatsapp: z.string().optional(),
        email: z.string().optional(),
        segment: z.string().optional(),
        instagram: z.string().optional(),
        monthly_fee: z.number().optional(),
        billing_day: z.number().int().min(1).max(28).optional(),
        posts_per_month: z.number().int().optional(),
        brand_voice: z.string().optional(),
        send_welcome: z.boolean().optional().describe("Se true, o pós-venda IA envia boas-vindas no WhatsApp"),
      }),
      run: async (i) => {
        const company = await db.company.create({
          data: {
            name: i.name,
            contactName: i.contact_name,
            whatsapp: normalizePhone(i.whatsapp),
            email: i.email,
            segment: i.segment,
            instagram: i.instagram,
            monthlyFee: i.monthly_fee,
            billingDay: i.billing_day,
            postsPerMonth: i.posts_per_month,
            brandVoice: i.brand_voice,
          },
        });
        await logActivity({ type: "company.created", summary: `Cliente cadastrado: ${company.name}`, actor: ACTOR, companyId: company.id });
        if (i.send_welcome && company.whatsapp) await startOnboarding(company.id);
        return { id: company.id, name: company.name };
      },
    }),
    tool({
      name: "update_company",
      description: "Atualiza dados de uma empresa (status, mensalidade, tom de voz, diretrizes, notas...).",
      schema: z.object({
        company_id: z.string(),
        status: z.enum(["ONBOARDING", "ACTIVE", "PAUSED", "CHURNED"]).optional(),
        monthly_fee: z.number().optional(),
        whatsapp: z.string().optional(),
        brand_voice: z.string().optional(),
        brand_guidelines: z.string().optional(),
        notes: z.string().optional(),
        posts_per_month: z.number().int().optional(),
      }),
      run: async (i) => {
        await db.company.update({
          where: { id: i.company_id },
          data: {
            status: i.status,
            monthlyFee: i.monthly_fee,
            whatsapp: i.whatsapp ? normalizePhone(i.whatsapp) : undefined,
            brandVoice: i.brand_voice,
            brandGuidelines: i.brand_guidelines,
            notes: i.notes,
            postsPerMonth: i.posts_per_month,
          },
        });
        return "Empresa atualizada.";
      },
    }),

    // ── Conteúdo ──
    tool({
      name: "list_posts",
      description: "Lista postagens, filtrando por empresa e/ou status.",
      schema: z.object({
        company_id: z.string().optional(),
        status: z.enum(["IDEA", "PRODUCTION", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"]).optional(),
      }),
      run: async ({ company_id, status }) =>
        db.post.findMany({
          where: { companyId: company_id, status },
          orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
          take: 50,
          select: { id: true, title: true, status: true, scheduledAt: true, feedback: true, company: { select: { name: true } } },
        }),
    }),
    tool({
      name: "generate_post_ideas",
      description: "Gera ideias de conteúdo com IA para uma empresa e salva no banco de ideias.",
      schema: z.object({ company_id: z.string(), count: z.number().int().min(1).max(20), theme: z.string().optional() }),
      run: async ({ company_id, count, theme }) =>
        (await generateIdeas(company_id, count, theme)).map((i) => ({ id: i.id, title: i.title })),
    }),
    tool({
      name: "create_post",
      description: "Cria uma postagem no cronograma. Com write_caption=true a IA já escreve legenda, hashtags e briefing visual.",
      schema: z.object({
        company_id: z.string(),
        title: z.string(),
        platform: platform.optional(),
        format: format.optional(),
        scheduled_at: z.string().optional().describe("ISO 8601 com fuso, ex.: 2026-10-05T10:00:00-03:00"),
        idea_id: z.string().optional(),
        write_caption: z.boolean().optional(),
        instructions: z.string().optional(),
      }),
      run: async (i) => {
        const post = await createPost({
          companyId: i.company_id,
          title: i.title,
          platform: i.platform,
          format: i.format,
          scheduledAt: parseDate(i.scheduled_at),
          ideaId: i.idea_id,
          actor: ACTOR,
        });
        if (i.write_caption) await generateCaption(post.id, i.instructions);
        return { id: post.id, title: post.title };
      },
    }),
    tool({
      name: "write_post_caption",
      description: "(Re)escreve legenda, hashtags e briefing de uma postagem, considerando o feedback do cliente se houver.",
      schema: z.object({ post_id: z.string(), instructions: z.string().optional() }),
      run: async ({ post_id, instructions }) => {
        const p = await generateCaption(post_id, instructions);
        return { caption: p.caption, hashtags: p.hashtags };
      },
    }),
    tool({
      name: "generate_post_image",
      description: "Gera a arte da postagem com IA de imagem. Sem prompt, usa o briefing visual da postagem.",
      schema: z.object({ post_id: z.string(), prompt: z.string().optional(), aspect_ratio: aspect.optional() }),
      run: async ({ post_id, prompt, aspect_ratio }) => {
        const post = await db.post.findUniqueOrThrow({ where: { id: post_id } });
        const finalPrompt = prompt ?? post.briefing ?? post.title;
        const asset = await generateImage({
          prompt: finalPrompt,
          postId: post.id,
          companyId: post.companyId,
          aspectRatio: aspect_ratio ?? (post.format === "STORY" || post.format === "REELS" ? "9:16" : "4:5"),
        });
        return { status: asset.status, url: asset.url, error: asset.error };
      },
    }),
    tool({
      name: "generate_post_video",
      description: "Solicita um vídeo curto com IA para a postagem (processa em segundo plano, fica pronto em alguns minutos).",
      schema: z.object({
        post_id: z.string(),
        prompt: z.string().optional(),
        aspect_ratio: aspect.optional(),
        duration_seconds: z.union([z.literal(5), z.literal(10)]).optional(),
      }),
      run: async ({ post_id, prompt, aspect_ratio, duration_seconds }) => {
        const post = await db.post.findUniqueOrThrow({ where: { id: post_id } });
        const asset = await requestVideo({
          prompt: prompt ?? post.briefing ?? post.title,
          postId: post.id,
          companyId: post.companyId,
          aspectRatio: aspect_ratio,
          durationSeconds: duration_seconds,
        });
        return { status: asset.status, error: asset.error };
      },
    }),
    tool({
      name: "send_post_for_approval",
      description: "Envia a postagem ao cliente pelo WhatsApp para aprovação (com arte e link).",
      schema: z.object({ post_id: z.string() }),
      run: async ({ post_id }) => sendPostForApproval(post_id, ACTOR),
    }),
    tool({
      name: "set_post_status",
      description: "Altera o status de uma postagem manualmente (ex.: marcar como publicada).",
      schema: z.object({
        post_id: z.string(),
        status: z.enum(["IDEA", "PRODUCTION", "APPROVED", "SCHEDULED", "PUBLISHED"]),
      }),
      run: async ({ post_id, status }) => {
        await db.post.update({
          where: { id: post_id },
          data: { status, publishedAt: status === "PUBLISHED" ? new Date() : undefined },
        });
        return "Status atualizado.";
      },
    }),

    // ── Contratos e financeiro ──
    tool({
      name: "draft_contract",
      description: "Redige um contrato de prestação de serviços com IA para a empresa (fica como rascunho).",
      schema: z.object({
        company_id: z.string(),
        services: z.string(),
        monthly_value: z.number(),
        months: z.number().int().min(1).max(60),
        start_date: z.string().optional(),
        extra_clauses: z.string().optional(),
      }),
      run: async (i) => {
        const c = await draftContract({
          companyId: i.company_id,
          services: i.services,
          value: i.monthly_value,
          months: i.months,
          startDate: parseDate(i.start_date),
          extraClauses: i.extra_clauses,
        });
        return { id: c.id, title: c.title, status: c.status };
      },
    }),
    tool({
      name: "send_contract",
      description: "Envia o contrato ao cliente pelo WhatsApp com link de assinatura digital.",
      schema: z.object({ contract_id: z.string() }),
      run: async ({ contract_id }) => sendContract(contract_id, ACTOR),
    }),
    tool({
      name: "create_invoice",
      description: "Cria uma cobrança para a empresa.",
      schema: z.object({
        company_id: z.string(),
        description: z.string(),
        amount: z.number(),
        due_date: z.string(),
        payment_link: z.string().optional(),
      }),
      run: async (i) => {
        const inv = await db.invoice.create({
          data: {
            companyId: i.company_id,
            description: i.description,
            amount: i.amount,
            dueDate: parseDate(i.due_date)!,
            paymentLink: i.payment_link,
          },
        });
        return { id: inv.id };
      },
    }),
    tool({
      name: "list_invoices",
      description: "Lista cobranças por status.",
      schema: z.object({ status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELED"]).optional() }),
      run: async ({ status }) =>
        (
          await db.invoice.findMany({
            where: { status },
            orderBy: { dueDate: "asc" },
            take: 50,
            include: { company: { select: { name: true } } },
          })
        ).map((i) => ({ id: i.id, company: i.company.name, amount: money(i.amount), dueDate: date(i.dueDate), status: i.status })),
    }),
    tool({
      name: "mark_invoice_paid",
      description: "Marca uma cobrança como paga.",
      schema: z.object({ invoice_id: z.string() }),
      run: async ({ invoice_id }) => {
        await db.invoice.update({ where: { id: invoice_id }, data: { status: "PAID", paidAt: new Date() } });
        return "Cobrança marcada como paga.";
      },
    }),

    // ── Prospecção ──
    tool({
      name: "list_leads",
      description: "Lista leads do funil de prospecção.",
      schema: z.object({ stage: z.enum(["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "WON", "LOST"]).optional() }),
      run: async ({ stage }) =>
        db.lead.findMany({
          where: { stage },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            id: true,
            name: true,
            businessName: true,
            phone: true,
            stage: true,
            nextFollowUpAt: true,
            agent: { select: { name: true } },
          },
        }),
    }),
    tool({
      name: "create_lead",
      description: "Cadastra um lead. Com start_outreach=true, o SDR de IA faz o primeiro contato no WhatsApp imediatamente.",
      schema: z.object({
        name: z.string(),
        phone: z.string().optional(),
        business_name: z.string().optional(),
        segment: z.string().optional(),
        instagram: z.string().optional(),
        source: z.string().optional(),
        notes: z.string().optional(),
        start_outreach: z.boolean().optional(),
      }),
      run: async (i) => {
        const phone = normalizePhone(i.phone);
        const lead = await db.lead.create({
          data: {
            name: i.name,
            phone,
            businessName: i.business_name,
            segment: i.segment,
            instagram: i.instagram,
            source: i.source,
            notes: i.notes,
          },
        });
        await logActivity({ type: "lead.created", summary: `Lead cadastrado: ${lead.name}`, actor: ACTOR, leadId: lead.id });
        let outreach: unknown = null;
        if (i.start_outreach && phone) outreach = await startOutreach(lead.id);
        return { id: lead.id, outreach };
      },
    }),
    tool({
      name: "start_outreach",
      description: "Pede ao SDR de IA para fazer o primeiro contato com um lead já cadastrado.",
      schema: z.object({ lead_id: z.string() }),
      run: async ({ lead_id }) => startOutreach(lead_id),
    }),
    tool({
      name: "set_lead_stage",
      description: "Move um lead de estágio.",
      schema: z.object({
        lead_id: z.string(),
        stage: z.enum(["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "LOST"]),
        note: z.string().optional(),
      }),
      run: async ({ lead_id, stage, note }) => {
        await updateLeadStage(lead_id, stage, ACTOR, note);
        return "Estágio atualizado.";
      },
    }),
    tool({
      name: "convert_lead_to_client",
      description: "Converte um lead fechado em empresa cliente. Opcionalmente dispara o onboarding pelo pós-venda IA.",
      schema: z.object({ lead_id: z.string(), start_onboarding: z.boolean().optional() }),
      run: async ({ lead_id, start_onboarding }) => {
        const company = await convertLeadToCompany(lead_id);
        if (start_onboarding && company.whatsapp) await startOnboarding(company.id);
        return { company_id: company.id, name: company.name };
      },
    }),

    // ── Equipe de IA e comunicação ──
    tool({
      name: "list_agents",
      description: "Lista os funcionários de IA (nome, função, ativo).",
      schema: z.object({}),
      run: async () => db.agent.findMany({ select: { id: true, name: true, role: true, active: true, isDefault: true } }),
    }),
    tool({
      name: "create_agent",
      description: "Contrata (cria) um novo funcionário de IA com personalidade e processo próprios.",
      schema: z.object({
        name: z.string(),
        role: z.enum(["SDR", "CLOSER", "ACCOUNT_MANAGER", "POST_SALES", "CONTENT", "FINANCE"]),
        persona: z.string(),
        goals: z.string().optional(),
        make_default: z.boolean().optional(),
      }),
      run: async (i) => {
        if (i.make_default) await db.agent.updateMany({ where: { role: i.role }, data: { isDefault: false } });
        const a = await db.agent.create({
          data: { name: i.name, role: i.role, persona: i.persona, goals: i.goals, isDefault: i.make_default ?? false },
        });
        return { id: a.id };
      },
    }),
    tool({
      name: "delegate_contact",
      description:
        "Delegar a um funcionário de IA um contato no WhatsApp com um cliente ou lead, com uma instrução (ex.: cobrar aprovação pendente, pedir material, avisar atraso). O agente escreve e envia a mensagem no tom dele.",
      schema: z.object({
        company_id: z.string().optional(),
        lead_id: z.string().optional(),
        instruction: z.string(),
      }),
      run: async ({ company_id, lead_id, instruction }) => {
        let phone: string | null = null;
        let name: string | undefined;
        if (company_id) {
          const c = await db.company.findUniqueOrThrow({ where: { id: company_id } });
          phone = c.whatsapp;
          name = c.contactName ?? undefined;
        } else if (lead_id) {
          const l = await db.lead.findUniqueOrThrow({ where: { id: lead_id } });
          phone = l.phone;
          name = l.name;
        }
        if (!phone) throw new Error("Contato sem WhatsApp cadastrado.");
        const conv = await getOrCreateConversation(phone, name);
        return agentRespond(conv.id, `Ordem do dono da agência: ${instruction}`);
      },
    }),
    tool({
      name: "send_whatsapp_message",
      description: "Envia uma mensagem exata (texto literal) pelo WhatsApp, em nome da agência.",
      schema: z.object({ phone: z.string(), text: z.string() }),
      run: async ({ phone, text }) => {
        const r = await sendWhatsApp({ phone, text, author: "ADMIN" });
        return { ok: r.ok, dryRun: r.dryRun ?? false, error: r.error };
      },
    }),

    // ── Publicação ──
    tool({
      name: "publish_post_now",
      description: "Publica agora no Instagram/Facebook uma postagem já aprovada pelo cliente.",
      schema: z.object({ post_id: z.string() }),
      run: async ({ post_id }) => {
        const post = await db.post.findUniqueOrThrow({ where: { id: post_id } });
        if (!["APPROVED", "SCHEDULED"].includes(post.status)) {
          return `A postagem está "${post.status}". Só publico conteúdo aprovado pelo cliente.`;
        }
        return publishPost(post_id, ACTOR);
      },
    }),

    // ── Cobrança ──
    tool({
      name: "send_invoice",
      description: "Gera a cobrança no Mercado Pago (link + Pix) e envia ao cliente pelo WhatsApp.",
      schema: z.object({ invoice_id: z.string(), kind: z.enum(["new", "reminder", "overdue"]).optional() }),
      run: async ({ invoice_id, kind }) => sendInvoice(invoice_id, kind ?? "new", ACTOR),
    }),
    tool({
      name: "create_payment_link",
      description: "Gera o link de pagamento (Mercado Pago) de uma cobrança sem enviar ao cliente.",
      schema: z.object({ invoice_id: z.string() }),
      run: async ({ invoice_id }) => {
        const inv = await createCharge(invoice_id);
        return { paymentLink: inv.paymentLink, pix: Boolean(inv.pixCode) };
      },
    }),
    tool({
      name: "generate_monthly_invoices",
      description: "Gera as mensalidades do mês para todos os clientes ativos (e envia a cobrança se o Mercado Pago estiver configurado).",
      schema: z.object({ send: z.boolean().optional() }),
      run: async ({ send }) => ({ created: await ensureMonthlyInvoices({ force: true, send }) }),
    }),

    // ── Agenda ──
    tool({
      name: "check_availability",
      description: "Próximos horários livres na agenda do dono.",
      schema: z.object({ days_ahead: z.number().int().min(1).max(30).optional() }),
      run: async ({ days_ahead }) => availableSlots(days_ahead ?? 7, 12),
    }),
    tool({
      name: "book_meeting",
      description: "Marca reunião (Google Agenda + Meet quando conectado). Use um `start` livre de check_availability.",
      schema: z.object({
        start: z.string(),
        title: z.string(),
        lead_id: z.string().optional(),
        company_id: z.string().optional(),
        attendee_email: z.string().optional(),
        notify_whatsapp: z.boolean().optional().describe("Avisa o lead/cliente no WhatsApp com data e link"),
      }),
      run: async (i) => {
        const m = await bookMeeting({
          start: parseDate(i.start)!,
          title: i.title,
          leadId: i.lead_id,
          companyId: i.company_id,
          attendeeEmail: i.attendee_email,
          bookedBy: ACTOR,
        });
        if (i.notify_whatsapp) {
          const phone = i.lead_id
            ? (await db.lead.findUnique({ where: { id: i.lead_id } }))?.phone
            : i.company_id
              ? (await db.company.findUnique({ where: { id: i.company_id } }))?.whatsapp
              : null;
          if (phone) {
            await sendWhatsApp({
              phone,
              author: ACTOR,
              text: `Reunião confirmada para ${date(m.startAt, true)} ✅${m.meetLink ? `\nLink: ${m.meetLink}` : ""}`,
            });
          }
        }
        return { id: m.id, startAt: date(m.startAt, true), meetLink: m.meetLink };
      },
    }),
    tool({
      name: "list_meetings",
      description: "Próximas reuniões marcadas.",
      schema: z.object({}),
      run: async () =>
        (
          await db.meeting.findMany({
            where: { status: "SCHEDULED", startAt: { gte: new Date() } },
            orderBy: { startAt: "asc" },
            take: 30,
            include: { lead: { select: { name: true } }, company: { select: { name: true } } },
          })
        ).map((m) => ({ id: m.id, title: m.title, when: date(m.startAt, true), with: m.lead?.name ?? m.company?.name, meetLink: m.meetLink })),
    }),
    tool({
      name: "cancel_meeting",
      description: "Cancela uma reunião (e o evento no Google Agenda).",
      schema: z.object({ meeting_id: z.string() }),
      run: async ({ meeting_id }) => {
        await cancelMeeting(meeting_id, ACTOR);
        return "Reunião cancelada.";
      },
    }),

    // ── Relatórios ──
    tool({
      name: "generate_report",
      description: "Gera (ou refaz) o relatório mensal de desempenho de um cliente como rascunho. Período no formato AAAA-MM (padrão: mês anterior).",
      schema: z.object({ company_id: z.string(), period: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
      run: async ({ company_id, period }) => {
        const r = await generateReport(company_id, period ?? previousPeriod());
        return { report_id: r.id, periodo: periodLabel(r.period), destaque: r.headline };
      },
    }),
    tool({
      name: "send_report",
      description: "Envia um relatório ao cliente pelo WhatsApp (resumo + link da versão completa).",
      schema: z.object({ report_id: z.string() }),
      run: async ({ report_id }) => sendReport(report_id, ACTOR),
    }),

    // ── Tarefas ──
    tool({
      name: "create_task",
      description: "Cria uma tarefa no quadro operacional.",
      schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        company_id: z.string().optional(),
        due_date: z.string().optional(),
        priority: z.number().int().min(1).max(3).optional(),
      }),
      run: async (i) => {
        const t = await db.task.create({
          data: {
            title: i.title,
            description: i.description,
            companyId: i.company_id,
            dueDate: parseDate(i.due_date),
            priority: i.priority ?? 2,
            createdBy: ACTOR,
          },
        });
        return { id: t.id };
      },
    }),
    tool({
      name: "list_tasks",
      description: "Lista tarefas abertas (inclui pendências escalonadas pelos agentes para o dono).",
      schema: z.object({ only_escalations: z.boolean().optional() }),
      run: async ({ only_escalations }) =>
        db.task.findMany({
          where: { status: { not: "DONE" }, forAdmin: only_escalations ? true : undefined },
          orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
          take: 50,
          select: { id: true, title: true, description: true, forAdmin: true, createdBy: true, dueDate: true },
        }),
    }),
  ];
}

async function systemPrompt() {
  const [notes, profile, recent] = await Promise.all([
    getSetting("director_notes"),
    getSetting("agency_profile"),
    db.command.findMany({ where: { status: "DONE" }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return `Você é o Diretor de Operações (IA) da agência de marketing ${AGENCY_NAME}. O dono da agência é o único humano da operação: ele dá ordens e você as executa usando as ferramentas da plataforma — clientes, conteúdo, artes, aprovações pelo WhatsApp, contratos, financeiro, prospecção e a equipe de funcionários de IA.

Como trabalhar:
- Execute a ordem de ponta a ponta. Encadeie as ferramentas necessárias (ex.: criar posts → escrever legendas → gerar artes → enviar para aprovação) sem pedir confirmação para passos intermediários óbvios.
- Busque IDs com as ferramentas de listagem; nunca invente IDs.
- Ações irreversíveis ou sensíveis com clientes que a ordem não pediu explicitamente (enviar contrato, cobrar, publicar, enviar relatório, mensagens com valores) — não faça; sugira no relatório final.
- Datas: hoje é ${date(new Date(), true)} (fuso America/Sao_Paulo). Use ISO 8601 com -03:00.
- Ao terminar, responda com um relatório curto em português: o que foi feito (com nomes), o que falhou e próximos passos sugeridos. Use markdown simples.
${profile ? `\nPerfil da agência:\n${profile}` : ""}
${notes ? `\nInstruções permanentes do dono:\n${notes}` : ""}
${recent.length ? `\nÚltimas ordens executadas (contexto):\n${recent.map((c) => `- "${c.prompt.slice(0, 200)}" → ${(c.result ?? "").slice(0, 300)}`).join("\n")}` : ""}`;
}

export async function runCommand(commandId: string) {
  const command = await db.command.findUniqueOrThrow({ where: { id: commandId } });
  try {
    const result = await runAgent({
      system: await systemPrompt(),
      messages: [{ role: "user", content: command.prompt }],
      tools: directorTools(),
      effort: "high",
      maxIterations: 40,
    });
    await db.command.update({
      where: { id: commandId },
      data: {
        status: result.refused ? "FAILED" : "DONE",
        result: result.refused ? "A IA recusou esta ordem." : result.text,
        steps: result.steps as unknown as Prisma.InputJsonValue,
      },
    });
    await logActivity({ type: "command.done", summary: `Ordem executada: ${command.prompt.slice(0, 100)}`, actor: ACTOR });
  } catch (err) {
    console.error("[director]", err);
    await db.command.update({
      where: { id: commandId },
      data: { status: "FAILED", result: err instanceof Error ? err.message : String(err) },
    });
  }
}
