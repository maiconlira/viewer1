import Link from "next/link";
import type { PostStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { Collapsible, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CompanyFilter } from "@/components/company-filter";
import { createPostAction } from "../../actions";
import { date, postStatusColor, postStatusLabel } from "@/lib/utils";

const COLUMNS: PostStatus[] = ["IDEA", "PRODUCTION", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"];

export default async function Conteudo({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const { companyId } = await searchParams;
  const [companies, posts] = await Promise.all([
    db.company.findMany({ where: { status: { not: "CHURNED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.post.findMany({
      where: {
        companyId: companyId || undefined,
        OR: [{ status: { not: "PUBLISHED" } }, { publishedAt: { gte: new Date(Date.now() - 30 * 86400000) } }],
      },
      orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
      include: { company: { select: { name: true } }, media: { where: { status: "READY" }, take: 1 } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Postagens"
        subtitle="Fluxo de produção: ideia → produção → aprovação do cliente → agendado → publicado"
        actions={<CompanyFilter companies={companies} current={companyId} />}
      />

      <Collapsible title="Nova postagem">
        <form action={createPostAction} className="grid gap-3 md:grid-cols-3">
          <select name="companyId" required defaultValue={companyId ?? ""} className="input">
            <option value="" disabled>Empresa...</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="title" required placeholder="Título / pauta" className="input md:col-span-2" />
          <select name="platform" className="input">
            {["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN", "YOUTUBE"].map((p) => <option key={p}>{p}</option>)}
          </select>
          <select name="format" className="input">
            {["FEED", "CAROUSEL", "REELS", "STORY", "VIDEO"].map((p) => <option key={p}>{p}</option>)}
          </select>
          <input type="datetime-local" name="scheduledAt" className="input" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="aiCaption" defaultChecked /> Escrever legenda, hashtags e briefing com IA
          </label>
          <div className="md:col-span-2"><SubmitButton pending="Criando...">Criar</SubmitButton></div>
        </form>
      </Collapsible>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((status) => {
          const items = posts.filter((p) => p.status === status);
          return (
            <div key={status} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className={`badge ${postStatusColor[status]}`}>{postStatusLabel[status]}</span>
                <span className="text-xs text-slate-400">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((p) => (
                  <Link key={p.id} href={`/conteudo/${p.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-brand-300">
                    {p.media[0]?.url && p.media[0].kind === "IMAGE" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.media[0].url} alt="" className="mb-2 aspect-[4/5] w-full rounded object-cover" />
                    )}
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{p.company.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{p.platform} · {p.format}{p.scheduledAt ? ` · ${date(p.scheduledAt, true)}` : ""}</div>
                    {p.feedback && status === "CHANGES_REQUESTED" && (
                      <div className="mt-2 line-clamp-3 rounded bg-rose-50 p-2 text-xs text-rose-800">“{p.feedback}”</div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
