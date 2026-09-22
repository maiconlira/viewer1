import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CompanyFilter } from "@/components/company-filter";
import { postStatusColor, TZ, zonedParts, zonedTime } from "@/lib/utils";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function dayKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

export default async function Cronograma({ searchParams }: { searchParams: Promise<{ m?: string; companyId?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const nowP = zonedParts(now);
  const [y, m] = (sp.m ?? `${nowP.year}-${nowP.month}`).split("-").map(Number);
  // grade do mês calculada no fuso da agência (meio-dia evita bordas de fuso)
  const first = zonedTime(y, m, 1, 12);
  const firstWeekday = zonedParts(first).weekday;
  const lastDay = zonedParts(zonedTime(y, m + 1, 0, 12)).day;
  const days = Array.from({ length: Math.ceil((firstWeekday + lastDay) / 7) * 7 }, (_, i) => zonedTime(y, m, 1 - firstWeekday + i, 12));

  const [companies, posts] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.post.findMany({
      where: {
        companyId: sp.companyId || undefined,
        scheduledAt: { gte: zonedTime(y, m, 1 - 7), lte: zonedTime(y, m + 1, 7) },
      },
      orderBy: { scheduledAt: "asc" },
      include: { company: { select: { name: true } } },
    }),
  ]);

  const byDay = new Map<string, typeof posts>();
  for (const p of posts) {
    const k = dayKey(p.scheduledAt!);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }

  const prev = m === 1 ? `${y - 1}-12` : `${y}-${m - 1}`;
  const next = m === 12 ? `${y + 1}-1` : `${y}-${m + 1}`;
  const qs = (mm: string) => `?m=${mm}${sp.companyId ? `&companyId=${sp.companyId}` : ""}`;
  const today = dayKey(now);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cronograma"
        subtitle={first.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: TZ })}
        actions={
          <>
            <CompanyFilter companies={companies} current={sp.companyId} extra={{ m: `${y}-${m}` }} />
            <Link href={qs(prev)} className="btn-secondary">←</Link>
            <Link href={qs(next)} className="btn-secondary">→</Link>
          </>
        }
      />
      <div className="overflow-x-auto">
        <div className="grid min-w-[800px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-slate-50 p-2 text-center text-xs font-medium text-slate-500">{w}</div>
          ))}
          {days.map((d) => {
            const k = dayKey(d);
            const dp = zonedParts(d);
            const inMonth = dp.month === m;
            return (
              <div key={k} className={`min-h-28 bg-white p-1.5 ${inMonth ? "" : "opacity-40"}`}>
                <div className={`mb-1 text-xs ${k === today ? "inline-block rounded-full bg-brand-600 px-1.5 text-white" : "text-slate-400"}`}>{dp.day}</div>
                <div className="space-y-1">
                  {(byDay.get(k) ?? []).map((p) => (
                    <Link key={p.id} href={`/conteudo/${p.id}`} className={`block truncate rounded px-1.5 py-0.5 text-[11px] ${postStatusColor[p.status]}`} title={`${p.company.name}: ${p.title}`}>
                      {p.scheduledAt!.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })} {p.company.name} · {p.title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
