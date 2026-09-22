import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/client";
import { signContract } from "../../actions";
import { AGENCY_NAME, date, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContratoPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await db.contract.findUnique({ where: { publicToken: token }, include: { company: { select: { name: true } } } });
  if (!c || c.status === "DRAFT") notFound();

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="text-center">
          <div className="text-sm text-slate-500">{AGENCY_NAME} · contrato</div>
          <h1 className="mt-1">{c.title}</h1>
          <div className="muted">{c.company.name}{c.value ? ` · ${money(c.value)}/mês` : ""}</div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white p-8 font-serif text-sm leading-relaxed shadow">{c.body}</div>

        {c.status === "SIGNED" ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-center text-emerald-800">
            ✍️ Assinado por <b>{c.signedByName}</b> em {date(c.signedAt, true)}.
          </div>
        ) : c.status === "SENT" ? (
          <form action={signContract.bind(null, token)} className="space-y-3 rounded-2xl bg-white p-6 shadow">
            <h2>Assinatura eletrônica</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <input name="name" required placeholder="Nome completo" className="input" />
              <input name="document" required placeholder="CPF" className="input" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="agree" required className="mt-1" />
              Li e concordo com todos os termos deste contrato e reconheço esta assinatura eletrônica como válida (Lei 14.063/2020 e MP 2.200-2/2001).
            </label>
            <SubmitButton className="btn-primary w-full py-3" pending="Assinando...">Assinar contrato</SubmitButton>
            <p className="text-center text-xs text-slate-400">Registramos nome, documento, data/hora e IP da assinatura.</p>
          </form>
        ) : (
          <div className="rounded-2xl bg-slate-200 p-5 text-center text-slate-700">Este contrato não está disponível para assinatura.</div>
        )}
      </div>
    </div>
  );
}
