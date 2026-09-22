import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, Field, PageHeader, Section } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { sendContractAction, updateContract } from "../../../actions";
import { appUrl, contractStatusLabel, date } from "@/lib/utils";

const d = (v?: Date | null) => (v ? v.toISOString().slice(0, 10) : "");

export default async function ContratoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.contract.findUnique({ where: { id }, include: { company: true } });
  if (!c) notFound();
  const link = appUrl(`/contrato/${c.publicToken}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.title}
        subtitle={c.company.name}
        actions={
          <>
            <Badge>{contractStatusLabel[c.status]}</Badge>
            {c.status !== "SIGNED" && (
              <form action={sendContractAction.bind(null, c.id)}>
                <SubmitButton pending="Enviando...">📲 Enviar para assinatura</SubmitButton>
              </form>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Contrato">
          <form key={c.updatedAt.toISOString()} action={updateContract.bind(null, c.id)} className="space-y-3">
            <Field label="Título"><input name="title" defaultValue={c.title} className="input" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor"><input name="value" defaultValue={c.value?.toString() ?? ""} className="input" /></Field>
              <Field label="Status">
                <select name="status" defaultValue={c.status} className="input">
                  {Object.entries(contractStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Início"><input type="date" name="startDate" defaultValue={d(c.startDate)} className="input" /></Field>
              <Field label="Fim"><input type="date" name="endDate" defaultValue={d(c.endDate)} className="input" /></Field>
            </div>
            <Field label="Texto"><textarea name="body" rows={16} defaultValue={c.body} className="input font-mono text-xs" /></Field>
            <SubmitButton>Salvar</SubmitButton>
          </form>
        </Section>
        <div className="space-y-6 lg:col-span-2">
          <Section title="Pré-visualização">
            <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-6 font-serif text-sm leading-relaxed">{c.body}</div>
          </Section>
          <Section title="Assinatura">
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2"><span className="truncate text-xs text-slate-500">{link}</span><CopyButton text={link} label="Copiar link" /></div>
              <div>Enviado em: {date(c.sentAt, true)}</div>
              {c.signedAt && (
                <div className="rounded bg-emerald-50 p-3 text-emerald-900">
                  ✍️ Assinado por <b>{c.signedByName}</b> ({c.signedByDoc}) em {date(c.signedAt, true)} · IP {c.signedIp ?? "—"}
                </div>
              )}
            </div>
            <Link href={`/empresas/${c.companyId}`} className="link mt-3 inline-block text-sm">← {c.company.name}</Link>
          </Section>
        </div>
      </div>
    </div>
  );
}
