import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, Field, PageHeader, Section } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { bookMeetingAction, cancelMeetingAction, setMeetingStatus } from "../../actions";
import { availableSlots, slotLabel } from "@/lib/agenda";
import { googleConnected } from "@/lib/google";
import { date } from "@/lib/utils";

export default async function Agenda() {
  const [upcoming, past, leads, companies, connected] = await Promise.all([
    db.meeting.findMany({
      where: { status: "SCHEDULED", endAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      include: { lead: { select: { id: true, name: true } }, company: { select: { id: true, name: true } } },
    }),
    db.meeting.findMany({
      where: { OR: [{ status: { not: "SCHEDULED" } }, { endAt: { lt: new Date() } }] },
      orderBy: { startAt: "desc" },
      take: 15,
      include: { lead: { select: { id: true, name: true } }, company: { select: { id: true, name: true } } },
    }),
    db.lead.findMany({ where: { stage: { notIn: ["WON", "LOST"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    googleConnected(),
  ]);
  let slots: { start: string; label: string }[] = [];
  let slotsError: string | null = null;
  try {
    slots = await availableSlots(7, 10);
  } catch (err) {
    slotsError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenda"
        subtitle={
          connected
            ? "Sincronizada com o Google Agenda: os agentes de IA marcam reuniões nos horários livres, com link do Meet."
            : "Agenda interna. Conecte o Google Agenda em Configurações para sincronizar e gerar links do Meet."
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title={`Próximas reuniões (${upcoming.length})`}>
            {upcoming.length === 0 ? <Empty>Nenhuma reunião marcada.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-medium">{m.title}</div>
                      <div className="text-sm text-slate-500 capitalize">{slotLabel(m.startAt)}</div>
                      <div className="text-xs text-slate-400">
                        {m.lead && <Link href={`/prospeccao/${m.lead.id}`} className="hover:underline">Lead: {m.lead.name} · </Link>}
                        {m.company && <Link href={`/empresas/${m.company.id}`} className="hover:underline">{m.company.name} · </Link>}
                        marcada por {m.bookedBy}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {m.meetLink && <a href={m.meetLink} target="_blank" className="btn-primary btn-sm">Entrar no Meet</a>}
                      <form action={cancelMeetingAction.bind(null, m.id)}>
                        <SubmitButton className="btn-danger btn-sm" confirm="Cancelar esta reunião?">Cancelar</SubmitButton>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Collapsible title="Marcar reunião">
            <form action={bookMeetingAction} className="grid gap-3 md:grid-cols-2">
              <Field label="Título"><input name="title" required className="input" placeholder="Apresentação da agência" /></Field>
              <Field label="Data e hora"><input name="start" type="datetime-local" required className="input" /></Field>
              <Field label="Lead">
                <select name="leadId" className="input"><option value="">—</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              </Field>
              <Field label="Cliente">
                <select name="companyId" className="input"><option value="">—</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </Field>
              <Field label="E-mail do convidado"><input name="email" type="email" className="input" /></Field>
              <Field label="Pauta"><input name="description" className="input" /></Field>
              <div><SubmitButton pending="Marcando...">Marcar</SubmitButton></div>
            </form>
          </Collapsible>
          <Section title="Histórico">
            {past.length === 0 ? <Empty>Sem histórico.</Empty> : (
              <ul className="space-y-2 text-sm">
                {past.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>{date(m.startAt, true)} — {m.title}{m.lead ? ` (${m.lead.name})` : ""}</span>
                    {m.status === "SCHEDULED" ? (
                      <span className="flex gap-1">
                        <form action={setMeetingStatus.bind(null, m.id, "DONE")}><SubmitButton className="btn-secondary btn-sm">Realizada</SubmitButton></form>
                        <form action={setMeetingStatus.bind(null, m.id, "NO_SHOW")}><SubmitButton className="btn-secondary btn-sm">Não compareceu</SubmitButton></form>
                      </span>
                    ) : (
                      <Badge>{m.status === "DONE" ? "Realizada" : m.status === "NO_SHOW" ? "Não compareceu" : "Cancelada"}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <Section title="Horários livres (7 dias)">
          {slotsError ? <p className="text-sm text-rose-600">{slotsError}</p> : slots.length === 0 ? <Empty>Sem horários livres.</Empty> : (
            <ul className="space-y-1 text-sm capitalize">{slots.map((s) => <li key={s.start}>🟢 {s.label}</li>)}</ul>
          )}
          <p className="muted mt-3">Dias, horário e duração das reuniões em <Link href="/configuracoes" className="link">Configurações</Link>.</p>
        </Section>
      </div>
    </div>
  );
}
