import type { AgentRole, LeadStage, PostStatus, ContractStatus, InvoiceStatus, CompanyStatus } from "@prisma/client";

export const AGENCY_NAME = process.env.AGENCY_NAME || "Agência";

export function appUrl(path = "") {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}

/** Normaliza telefone para somente dígitos com DDI 55 quando vier sem DDI. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

export function money(value: unknown) {
  const n = Number(value ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function date(d?: Date | string | null, withTime = false) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: withTime ? undefined : "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: process.env.TZ || "America/Sao_Paulo",
  });
}

export function toInputDateTime(d?: Date | null) {
  if (!d) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export const postStatusLabel: Record<PostStatus, string> = {
  IDEA: "Ideia",
  PRODUCTION: "Em produção",
  PENDING_APPROVAL: "Aguardando aprovação",
  CHANGES_REQUESTED: "Alteração pedida",
  APPROVED: "Aprovado",
  SCHEDULED: "Agendado",
  PUBLISHED: "Publicado",
};

export const postStatusColor: Record<PostStatus, string> = {
  IDEA: "bg-slate-100 text-slate-700",
  PRODUCTION: "bg-sky-100 text-sky-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  CHANGES_REQUESTED: "bg-rose-100 text-rose-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  SCHEDULED: "bg-indigo-100 text-indigo-800",
  PUBLISHED: "bg-violet-100 text-violet-800",
};

export const leadStageLabel: Record<LeadStage, string> = {
  NEW: "Novo",
  CONTACTED: "Contatado",
  QUALIFIED: "Qualificado",
  MEETING: "Reunião",
  PROPOSAL: "Proposta",
  WON: "Fechado",
  LOST: "Perdido",
};

export const agentRoleLabel: Record<AgentRole, string> = {
  SDR: "SDR — primeiro contato",
  CLOSER: "Closer — fechamento",
  ACCOUNT_MANAGER: "Atendimento de clientes",
  POST_SALES: "Pós-venda / onboarding",
  CONTENT: "Estrategista de conteúdo",
  FINANCE: "Financeiro / cobrança",
};

export const contractStatusLabel: Record<ContractStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado",
  SIGNED: "Assinado",
  CANCELED: "Cancelado",
  EXPIRED: "Expirado",
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  OVERDUE: "Vencido",
  CANCELED: "Cancelado",
};

export const companyStatusLabel: Record<CompanyStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  CHURNED: "Encerrado",
};

export function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function num(form: FormData, key: string): number | undefined {
  const v = str(form, key);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function dateField(form: FormData, key: string): Date | undefined {
  const v = str(form, key);
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}
