import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/client";
import { publicApprove, publicRequestChanges } from "../../actions";
import { AGENCY_NAME, date } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Aprovar({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const post = await db.post.findUnique({
    where: { approvalToken: token },
    include: { company: { select: { name: true } }, media: { where: { status: "READY" }, orderBy: { createdAt: "desc" } } },
  });
  if (!post) notFound();
  const approved = ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(post.status);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="text-center">
          <div className="text-sm text-slate-500">{AGENCY_NAME} · aprovação de conteúdo</div>
          <h1 className="mt-1">{post.company.name}</h1>
        </div>
        <div className="overflow-hidden rounded-2xl bg-white shadow">
          {post.media.map((m) =>
            m.kind === "VIDEO" ? (
              <video key={m.id} src={m.url!} controls className="w-full bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={m.url!} alt="" className="w-full" />
            ),
          )}
          <div className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              {post.platform} · {post.format}{post.scheduledAt ? ` · ${date(post.scheduledAt, true)}` : ""}
            </div>
            <h2>{post.title}</h2>
            {post.caption && <p className="whitespace-pre-wrap text-sm">{post.caption}</p>}
            {post.hashtags && <p className="text-sm text-brand-600">{post.hashtags}</p>}
          </div>
        </div>

        {approved ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-center text-emerald-800">✅ Postagem aprovada. Obrigado!</div>
        ) : (
          <div className="space-y-3 rounded-2xl bg-white p-5 shadow">
            {post.status === "CHANGES_REQUESTED" && post.feedback && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Alteração solicitada: “{post.feedback}”. Estamos ajustando!</div>
            )}
            <form action={publicApprove.bind(null, token)}>
              <SubmitButton className="btn-primary w-full py-3 text-base" pending="Aprovando...">✅ Aprovar postagem</SubmitButton>
            </form>
            <form action={publicRequestChanges.bind(null, token)} className="space-y-2">
              <textarea name="feedback" required rows={3} className="input" placeholder="O que você gostaria de alterar?" />
              <SubmitButton className="btn-secondary w-full" pending="Enviando...">✏️ Pedir alteração</SubmitButton>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
