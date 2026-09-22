import type { AgentRole, LeadStage, PostStatus, ContractStatus, InvoiceStatus, CompanyStatus } from "@prisma/client";

export const AGENCY_NAME = process.env.AGENCY_NAME || "Agência";

// ─────────────── Fuso horário ───────────────
// Todas as datas "de calendário" (agenda, vencimentos, meses, formulários) são calculadas no fuso da agência,
// independentemente do fuso do servidor.
export const TZ = process.env.AGENCY_TZ || "America/Sao_Paulo";

/** Partes da data no fuso da agência. weekday: 0=domingo. */
export function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

function tzOffsetMs(date: Date) {
  const p = zonedParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Cria o instante correspondente a uma data/hora "de parede" no fuso da agência (mês 1-12; aceita dia/mês fora do intervalo). */
export function zonedTime(year: number, month: number, day: number, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - tzOffsetMs(new Date(guess));
  // segunda passada corrige transições de horário de verão
  return new Date(guess - tzOffsetMs(new Date(first)));
}

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
    timeZone: TZ,
  });
}

export function time(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Valor para <input type="datetime-local"> no fuso da agência. */
export function toInputDateTime(d?: Date | null) {
  if (!d) return "";
  const p = zonedParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Valor para <input type="date"> no fuso da agência. */
export function toInputDate(d?: Date | null) {
  if (!d) return "";
  const p = zonedParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Interpreta "AAAA-MM-DD" (meio-dia) ou "AAAA-MM-DDTHH:mm" no fuso da agência; outros formatos ISO com fuso ficam como estão. */
export function parseLocalDate(v: string): Date | undefined {
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0);
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (m) return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
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
  return v ? parseLocalDate(v) : undefined;
}
