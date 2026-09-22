import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { createChargeAction, createInvoice, generateMonthlyInvoices, sendInvoiceAction, setInvoiceStatus } from "../../actions";
import { mercadoPagoEnabled } from "@/lib/mercadopago";
import { date, invoiceStatusLabel, money, zonedParts, zonedTime } from "@/lib/utils";

export default async function Financeiro() {
  const now = new Date();
  const nowP = zonedParts(now);
  const monthStart = zonedTime(nowP.year, nowP.month, 1);
  const [companies, invoices, paidMonth, mrr] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.invoice.findMany({
      where: { OR: [{ status: { in: ["PENDING", "OVERDUE"] } }, { dueDate: { gte: new Date(Date.now() - 60 * 86400000) } }] },
      orderBy: { dueDate: "asc" },
      include: { company: { select: { name: true } } },
    }),
    db.invoice.aggregate({ _sum: { amount: true }, where: { status: "PAID", paidAt: { gte: monthStart } } }),
    db.company.aggregate({ _sum: { monthlyFee: true }, where: { status: { in: ["ACTIVE", "ONBOARDING"] } } }),
  ]);
  const open = invoices.filter((i) => i.status === "PENDING").reduce((s, i) => s + Number(i.amount), 0);
  const mp = mercadoPagoEnabled();
  const overdue = invoices.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        subtitle={
          mp
            ? "Mercado Pago ativo: mensalidades geradas, cobradas por WhatsApp (link + Pix) e baixadas automaticamente quando pagas."
            : "Configure MP_ACCESS_TOKEN para cobrar pelo Mercado Pago com baixa automática. Sem isso, os lembretes usam o link que você informar."
        }
        actions={<form action={generateMonthlyInvoices}><SubmitButton className="btn-secondary" pending="Gerando...">Gerar mensalidades do mês</SubmitButton></form>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="MRR contratado" value={money(mrr._sum.monthlyFee ?? 0)} />
        <Stat label="Recebido no mês" value={money(paidMonth._sum.amount ?? 0)} tone="good" />
        <Stat label="A receber" value={money(open)} />
        <Stat label="Vencido" value={money(overdue)} tone={overdue ? "bad" : undefined} />
      </div>
      <Collapsible title="Nova cobrança">
        <form action={createInvoice} className="grid gap-3 md:grid-cols-5">
          <select name="companyId" required className="input">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="description" required placeholder="Descrição" className="input" />
          <input name="amount" required placeholder="Valor" className="input" />
          <input name="dueDate" type="date" required className="input" />
          {!mp && <input name="paymentLink" placeholder="Link de pagamento (Pix/boleto)" className="input" />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send" /> Enviar cobrança no WhatsApp</label>
          <SubmitButton>Criar</SubmitButton>
        </form>
      </Collapsible>
      <Section title="Cobranças">
        {invoices.length === 0 ? <Empty>Nenhuma cobrança.</Empty> : (
          <table className="table">
            <thead><tr><th>Empresa</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/empresas/${i.companyId}`} className="link">{i.company.name}</Link></td>
                  <td>{i.description}</td>
                  <td>{money(i.amount)}</td>
                  <td>{date(i.dueDate)}</td>
                  <td>
                    <Badge className={i.status === "OVERDUE" ? "bg-rose-100 text-rose-800" : i.status === "PAID" ? "bg-emerald-100 text-emerald-800" : undefined}>
                      {invoiceStatusLabel[i.status]}
                    </Badge>
                  </td>
                  <td className="text-right">
                    {i.status !== "PAID" && i.status !== "CANCELED" && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {mp && !i.paymentLink && (
                          <form action={createChargeAction.bind(null, i.id)}><SubmitButton className="btn-secondary btn-sm" pending="...">Gerar cobrança</SubmitButton></form>
                        )}
                        {i.paymentLink && <CopyButton text={i.paymentLink} label="Link" />}
                        {i.pixCode && <CopyButton text={i.pixCode} label="Pix" />}
                        <form action={sendInvoiceAction.bind(null, i.id)}>
                          <SubmitButton className="btn-secondary btn-sm" pending="...">{i.sentAt ? "Reenviar" : "Enviar"}</SubmitButton>
                        </form>
                        <form action={setInvoiceStatus.bind(null, i.id, "PAID")}><SubmitButton className="btn-secondary btn-sm">Recebido</SubmitButton></form>
                      </div>
                    )}
                    {i.status === "PAID" && <span className="text-xs text-slate-400">{date(i.paidAt)}{i.paidVia ? ` · ${i.paidVia}` : ""}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
