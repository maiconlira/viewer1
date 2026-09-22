import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createInvoice, generateMonthlyInvoices, setInvoiceStatus } from "../../actions";
import { date, invoiceStatusLabel, money } from "@/lib/utils";

export default async function Financeiro() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
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
  const overdue = invoices.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        subtitle="Cobranças dos clientes. Faturas vencidas são marcadas e lembradas automaticamente pelo WhatsApp."
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
          <input name="paymentLink" placeholder="Link de pagamento (Pix/boleto)" className="input" />
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
                    {i.status !== "PAID" && (
                      <form action={setInvoiceStatus.bind(null, i.id, "PAID")}><SubmitButton className="btn-secondary btn-sm">Recebido</SubmitButton></form>
                    )}
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
