import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { aiContract, createContract } from "../../actions";
import { contractStatusLabel, date, money } from "@/lib/utils";

export default async function Contratos({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const { companyId } = await searchParams;
  const [companies, contracts] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.contract.findMany({ orderBy: { createdAt: "desc" }, include: { company: { select: { name: true } } } }),
  ]);
  const companySelect = (
    <select name="companyId" required defaultValue={companyId ?? ""} className="input">
      <option value="" disabled>Empresa...</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Contratos" subtitle="Redação com IA, envio pelo WhatsApp e assinatura digital com registro de nome, documento, data e IP" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="✨ Redigir com IA">
          <form action={aiContract} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">{companySelect}</div>
            <Field label="Serviços contratados" className="md:col-span-2">
              <textarea name="services" required rows={3} className="input" placeholder="Gestão de Instagram e Facebook, 12 posts/mês (8 feed + 4 reels), 1 relatório mensal, tráfego pago com verba à parte" />
            </Field>
            <Field label="Valor mensal (R$)"><input name="value" required className="input" /></Field>
            <Field label="Meses"><input name="months" type="number" defaultValue={12} className="input" /></Field>
            <Field label="Início"><input name="startDate" type="date" className="input" /></Field>
            <Field label="Título (opcional)"><input name="title" className="input" /></Field>
            <Field label="Cláusulas extras" className="md:col-span-2"><input name="extra" className="input" placeholder="Multa rescisória de 1 mensalidade, fidelidade de 6 meses..." /></Field>
            <div className="md:col-span-2"><SubmitButton className="btn-ai" pending="Redigindo contrato...">Redigir contrato</SubmitButton></div>
          </form>
        </Section>
        <Section title="Colar contrato pronto">
          <form action={createContract} className="space-y-3">
            {companySelect}
            <input name="title" required placeholder="Título" className="input" />
            <textarea name="body" required rows={6} placeholder="Texto do contrato" className="input" />
            <div className="grid grid-cols-3 gap-2">
              <input name="value" placeholder="Valor" className="input" />
              <input name="startDate" type="date" className="input" />
              <input name="endDate" type="date" className="input" />
            </div>
            <SubmitButton>Salvar</SubmitButton>
          </form>
        </Section>
      </div>
      <Section title="Todos os contratos">
        {contracts.length === 0 ? <Empty>Nenhum contrato.</Empty> : (
          <table className="table">
            <thead><tr><th>Contrato</th><th>Empresa</th><th>Valor</th><th>Vigência</th><th>Status</th></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/contratos/${c.id}`} className="link">{c.title}</Link></td>
                  <td>{c.company.name}</td>
                  <td>{c.value ? money(c.value) : "—"}</td>
                  <td className="whitespace-nowrap">{date(c.startDate)} → {date(c.endDate)}</td>
                  <td><Badge className={c.status === "SIGNED" ? "bg-emerald-100 text-emerald-800" : c.status === "SENT" ? "bg-amber-100 text-amber-800" : undefined}>{contractStatusLabel[c.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
