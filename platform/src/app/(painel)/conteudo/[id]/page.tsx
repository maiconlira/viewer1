import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, Field, PageHeader, Section } from "@/components/ui";
import { AutoRefresh, CopyButton, SubmitButton } from "@/components/client";
import {
  addMediaUrl,
  adminApprovePost,
  aiCaption,
  aiImage,
  aiVideo,
  deleteMedia,
  deletePost,
  sendForApproval,
  setPostStatus,
  updatePost,
} from "../../../actions";
import { appUrl, date, postStatusColor, postStatusLabel, toInputDateTime } from "@/lib/utils";
import { mediaEnabled } from "@/lib/media";

export default async function PostDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await db.post.findUnique({
    where: { id },
    include: { company: true, idea: true, media: { orderBy: { createdAt: "desc" } } },
  });
  if (!post) notFound();
  const approvalLink = appUrl(`/aprovar/${post.approvalToken}`);
  const processing = post.media.some((m) => m.status === "PROCESSING" || m.status === "PENDING");
  const defaultAspect = post.format === "STORY" || post.format === "REELS" ? "9:16" : "4:5";

  return (
    <div className="space-y-6">
      <AutoRefresh active={processing} ms={8000} />
      <PageHeader
        title={post.title}
        subtitle={`${post.company.name} · ${post.platform} · ${post.format}`}
        actions={
          <>
            <Badge className={postStatusColor[post.status]}>{postStatusLabel[post.status]}</Badge>
            <form action={sendForApproval.bind(null, post.id)}>
              <SubmitButton pending="Enviando...">📲 Enviar para aprovação</SubmitButton>
            </form>
          </>
        }
      />

      {post.feedback && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="font-medium">Pedido de alteração do cliente:</div>
          <div className="mt-1 whitespace-pre-wrap">{post.feedback}</div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Section title="Conteúdo">
            <form key={post.updatedAt.toISOString()} action={updatePost.bind(null, post.id)} className="space-y-4">
              <Field label="Título"><input name="title" defaultValue={post.title} className="input" required /></Field>
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Rede">
                  <select name="platform" defaultValue={post.platform} className="input">
                    {["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN", "YOUTUBE", "OTHER"].map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Formato">
                  <select name="format" defaultValue={post.format} className="input">
                    {["FEED", "CAROUSEL", "REELS", "STORY", "VIDEO", "TEXT"].map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select name="status" defaultValue={post.status} className="input">
                    {Object.entries(postStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Data de publicação">
                  <input type="datetime-local" name="scheduledAt" defaultValue={toInputDateTime(post.scheduledAt)} className="input" />
                </Field>
              </div>
              <Field label="Legenda"><textarea name="caption" rows={10} defaultValue={post.caption ?? ""} className="input" /></Field>
              <Field label="Hashtags"><input name="hashtags" defaultValue={post.hashtags ?? ""} className="input" /></Field>
              <Field label="Briefing visual (prompt para gerar a arte)"><textarea name="briefing" rows={3} defaultValue={post.briefing ?? ""} className="input" /></Field>
              <SubmitButton>Salvar</SubmitButton>
            </form>
          </Section>

          <Section title="✨ Reescrever com IA">
            <form action={aiCaption.bind(null, post.id)} className="flex flex-wrap gap-2">
              <input name="instructions" placeholder="Instruções (opcional): mais curta, tom mais divertido, CTA para WhatsApp..." className="input flex-1" />
              <SubmitButton className="btn-ai" pending="Escrevendo...">Gerar legenda</SubmitButton>
            </form>
            {post.feedback && <p className="muted mt-2">A IA vai considerar automaticamente o pedido de alteração do cliente.</p>}
          </Section>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Section title="Mídia">
            {!mediaEnabled() && (
              <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">Configure FAL_KEY para gerar imagens e vídeos com IA. Você ainda pode anexar por URL.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {post.media.map((m) => (
                <div key={m.id} className="relative overflow-hidden rounded-lg border border-slate-200">
                  {m.status === "READY" && m.url ? (
                    m.kind === "VIDEO" ? (
                      <video src={m.url} controls className="aspect-[9/16] w-full bg-black object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a href={m.url} target="_blank"><img src={m.url} alt="" className="aspect-[4/5] w-full object-cover" /></a>
                    )
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center p-2 text-center text-xs text-slate-500">
                      {m.status === "FAILED" ? `Falhou: ${m.error?.slice(0, 120)}` : "Gerando…"}
                    </div>
                  )}
                  <form action={deleteMedia.bind(null, m.id, post.id)} className="absolute right-1 top-1">
                    <button className="rounded bg-white/90 px-1.5 text-xs text-rose-600">✕</button>
                  </form>
                </div>
              ))}
            </div>

            <form action={aiImage.bind(null, post.id)} className="mt-4 space-y-2">
              <textarea name="prompt" rows={2} className="input" placeholder="Prompt da imagem (vazio = usa o briefing visual)" />
              <div className="flex gap-2">
                <select name="aspect" defaultValue={defaultAspect} className="input w-24">
                  {["4:5", "1:1", "9:16", "16:9"].map((a) => <option key={a}>{a}</option>)}
                </select>
                <SubmitButton className="btn-ai flex-1" pending="Gerando arte...">🎨 Gerar imagem</SubmitButton>
              </div>
            </form>
            <form action={aiVideo.bind(null, post.id)} className="mt-3 flex gap-2">
              <input type="hidden" name="aspect" value="9:16" />
              <select name="duration" className="input w-20"><option value="5">5s</option><option value="10">10s</option></select>
              <SubmitButton className="btn-ai flex-1" pending="Solicitando...">🎬 Gerar vídeo</SubmitButton>
            </form>
            <form action={addMediaUrl.bind(null, post.id)} className="mt-3 flex gap-2">
              <input name="url" type="url" required placeholder="Ou cole a URL de uma arte pronta" className="input flex-1" />
              <SubmitButton className="btn-secondary">Anexar</SubmitButton>
            </form>
          </Section>

          <Section title="Aprovação">
            <div className="space-y-2 text-sm">
              <div>Enviado: {date(post.sentForApprovalAt, true)}</div>
              <div>Aprovado: {date(post.approvedAt, true)}</div>
              <div className="flex items-center gap-2">
                <span className="truncate text-xs text-slate-500">{approvalLink}</span>
                <CopyButton text={approvalLink} label="Copiar link" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={adminApprovePost.bind(null, post.id)}><SubmitButton className="btn-secondary btn-sm">Marcar aprovado</SubmitButton></form>
              <form action={setPostStatus.bind(null, post.id, "PUBLISHED")}><SubmitButton className="btn-secondary btn-sm">Marcar publicado</SubmitButton></form>
            </div>
          </Section>

          <div className="flex justify-between text-sm">
            <Link href={`/empresas/${post.companyId}`} className="link">← {post.company.name}</Link>
            <form action={deletePost.bind(null, post.id)}>
              <SubmitButton className="btn-danger btn-sm" confirm="Excluir esta postagem?">Excluir</SubmitButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
