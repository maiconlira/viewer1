// Visualização de um relatório mensal (usada no painel e na página pública do cliente).
import type { Report } from "@prisma/client";
import type { ReportMetrics } from "@/lib/reports";
import { periodLabel } from "@/lib/reports";

const nf = (n?: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR"));

const METRIC_LABEL: Record<string, string> = {
  reach: "Contas alcançadas",
  views: "Visualizações",
  accounts_engaged: "Contas engajadas",
  total_interactions: "Interações",
  likes: "Curtidas",
  comments: "Comentários",
  shares: "Compartilhamentos",
  saves: "Salvamentos",
  profile_links_taps: "Cliques no perfil",
  follows_and_unfollows: "Novos seguidores (líquido)",
};

const FORMAT_LABEL: Record<string, string> = {
  FEED: "Feed", CAROUSEL: "Carrossel", REELS: "Reels", STORY: "Stories", VIDEO: "Vídeo", TEXT: "Texto",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function ReportView({ report, companyName }: { report: Report; companyName: string }) {
  const m = report.metrics as unknown as ReportMetrics;
  const rec = (report.recommendations ?? {}) as { highlights?: string[]; recommendations?: string[] };
  const ig = m.instagram;
  const topPosts = [...(ig?.posts ?? [])].sort((a, b) => (b.reach ?? b.likes) - (a.reach ?? a.likes)).slice(0, 5);
  const accountEntries = Object.entries(ig?.account ?? {}).filter(([k]) => METRIC_LABEL[k]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-slate-500">{companyName} · {periodLabel(report.period)}</div>
        {report.headline && <h2 className="mt-1 text-xl">{report.headline}</h2>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ig?.followers != null && (
          <Tile
            label="Seguidores"
            value={nf(ig.followers)}
            hint={m.followersGrowth != null ? `${m.followersGrowth >= 0 ? "+" : ""}${nf(m.followersGrowth)} no mês` : undefined}
          />
        )}
        <Tile label="Posts publicados" value={nf(m.production.published)} />
        <Tile label="Posts aprovados" value={nf(m.production.approved)} hint={`${m.production.changesRequested} pedido(s) de ajuste`} />
        <Tile
          label="Tempo de aprovação"
          value={m.production.avgApprovalHours != null ? `${m.production.avgApprovalHours}h` : "—"}
          hint="média entre envio e aprovação"
        />
      </div>

      {accountEntries.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Instagram no mês</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {accountEntries.map(([k, v]) => <Tile key={k} label={METRIC_LABEL[k]} value={nf(v)} />)}
          </div>
        </div>
      )}

      {rec.highlights?.length ? (
        <div>
          <h3 className="mb-2 font-semibold">Destaques</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">{rec.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      ) : null}

      {report.analysis && (
        <div>
          <h3 className="mb-2 font-semibold">Análise</h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{report.analysis}</div>
        </div>
      )}

      {topPosts.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Melhores posts</h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Post</th><th className="text-right">Alcance</th><th className="text-right">Curtidas</th><th className="text-right">Comentários</th><th className="text-right">Salvos</th></tr>
              </thead>
              <tbody>
                {topPosts.map((p) => (
                  <tr key={p.id}>
                    <td className="max-w-xs">
                      {p.permalink ? <a href={p.permalink} target="_blank" className="link">{p.caption || p.type}</a> : p.caption || p.type}
                      <div className="text-xs text-slate-400">{new Date(p.timestamp).toLocaleDateString("pt-BR")} · {p.type}</div>
                    </td>
                    <td className="text-right tabular-nums">{nf(p.reach)}</td>
                    <td className="text-right tabular-nums">{nf(p.likes)}</td>
                    <td className="text-right tabular-nums">{nf(p.comments)}</td>
                    <td className="text-right tabular-nums">{nf(p.saves)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {Object.keys(m.production.byFormat).length > 0 && (
        <div className="text-sm text-slate-600">
          <b>Produção por formato:</b>{" "}
          {Object.entries(m.production.byFormat).map(([f, n]) => `${FORMAT_LABEL[f] ?? f}: ${n}`).join(" · ")}
        </div>
      )}

      {rec.recommendations?.length ? (
        <div className="rounded-xl bg-slate-50 p-4">
          <h3 className="mb-2 font-semibold">Próximos passos</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">{rec.recommendations.map((r) => <li key={r}>{r}</li>)}</ol>
        </div>
      ) : null}
    </div>
  );
}
