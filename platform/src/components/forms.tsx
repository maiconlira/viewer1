// Formulários reutilizados (server components).
import type { Agent, Company, Lead } from "@prisma/client";
import { Field } from "./ui";
import { agentRoleLabel, companyStatusLabel, leadStageLabel } from "@/lib/utils";

export function CompanyFields({ c }: { c?: Company | null }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field label="Nome da empresa *"><input name="name" required defaultValue={c?.name} className="input" /></Field>
      <Field label="Segmento"><input name="segment" defaultValue={c?.segment ?? ""} className="input" /></Field>
      <Field label="Status">
        <select name="status" defaultValue={c?.status ?? "ONBOARDING"} className="input">
          {Object.entries(companyStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Contato"><input name="contactName" defaultValue={c?.contactName ?? ""} className="input" /></Field>
      <Field label="WhatsApp (com DDD)"><input name="whatsapp" defaultValue={c?.whatsapp ?? ""} className="input" placeholder="11 99999-9999" /></Field>
      <Field label="E-mail"><input name="email" type="email" defaultValue={c?.email ?? ""} className="input" /></Field>
      <Field label="CNPJ/CPF"><input name="document" defaultValue={c?.document ?? ""} className="input" /></Field>
      <Field label="Instagram"><input name="instagram" defaultValue={c?.instagram ?? ""} className="input" placeholder="@perfil" /></Field>
      <Field label="Posts por mês"><input name="postsPerMonth" type="number" defaultValue={c?.postsPerMonth ?? ""} className="input" /></Field>
      <Field label="Mensalidade (R$)"><input name="monthlyFee" defaultValue={c?.monthlyFee?.toString() ?? ""} className="input" /></Field>
      <Field label="Dia de vencimento"><input name="billingDay" type="number" min={1} max={28} defaultValue={c?.billingDay ?? ""} className="input" /></Field>
      <div />
      <Field label="Tom de voz (usado pela IA)" className="md:col-span-3">
        <textarea name="brandVoice" rows={2} defaultValue={c?.brandVoice ?? ""} className="input" placeholder="Ex.: descontraído, próximo, usa humor leve, fala com mães de 25-40 anos" />
      </Field>
      <Field label="Diretrizes da marca" className="md:col-span-3">
        <textarea name="brandGuidelines" rows={3} defaultValue={c?.brandGuidelines ?? ""} className="input" placeholder="Cores, fontes, o que evitar, produtos principais, concorrentes, referências..." />
      </Field>
      <Field label="Observações internas" className="md:col-span-3">
        <textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} className="input" />
      </Field>
    </div>
  );
}

export function LeadFields({ l, agents }: { l?: Lead | null; agents: Agent[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field label="Nome *"><input name="name" required defaultValue={l?.name} className="input" /></Field>
      <Field label="Empresa"><input name="businessName" defaultValue={l?.businessName ?? ""} className="input" /></Field>
      <Field label="Segmento"><input name="segment" defaultValue={l?.segment ?? ""} className="input" /></Field>
      <Field label="WhatsApp"><input name="phone" defaultValue={l?.phone ?? ""} className="input" /></Field>
      <Field label="E-mail"><input name="email" defaultValue={l?.email ?? ""} className="input" /></Field>
      <Field label="Instagram"><input name="instagram" defaultValue={l?.instagram ?? ""} className="input" /></Field>
      <Field label="Origem"><input name="source" defaultValue={l?.source ?? ""} className="input" placeholder="Indicação, Instagram, lista..." /></Field>
      <Field label="Valor estimado/mês (R$)"><input name="estimatedValue" defaultValue={l?.estimatedValue?.toString() ?? ""} className="input" /></Field>
      <Field label="Funcionário de IA responsável">
        <select name="agentId" defaultValue={l?.agentId ?? ""} className="input">
          <option value="">Padrão (SDR)</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {agentRoleLabel[a.role]}</option>)}
        </select>
      </Field>
      {l && (
        <Field label="Estágio">
          <select name="stage" defaultValue={l.stage} className="input">
            {Object.entries(leadStageLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      )}
      <Field label="Anotações" className="md:col-span-3">
        <textarea name="notes" rows={3} defaultValue={l?.notes ?? ""} className="input" />
      </Field>
    </div>
  );
}
