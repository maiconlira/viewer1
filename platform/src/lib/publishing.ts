// Publicação automática das postagens aprovadas na data agendada.
// Só publica o que o cliente aprovou (status APPROVED/SCHEDULED) — nunca rascunhos.
import { db } from "./db";
import { logActivity } from "./activity";
import { escalateToAdmin } from "./services";
import { canPublish, createInstagramContainer, publishInstagramContainer, publishToFacebook } from "./meta";

const MAX_ATTEMPTS = 3;

async function loadPost(postId: string) {
  return db.post.findUniqueOrThrow({
    where: { id: postId },
    include: { company: true, media: { where: { status: "READY", url: { not: null } }, orderBy: { createdAt: "asc" } } },
  });
}

async function markPublished(postId: string, data: { igMediaId?: string; fbPostId?: string; permalink?: string }, actor: string) {
  const post = await db.post.update({
    where: { id: postId },
    data: {
      ...data,
      status: "PUBLISHED",
      publishState: "PUBLISHED",
      publishedAt: new Date(),
      publishError: null,
    },
  });
  await logActivity({
    type: "post.published",
    summary: `📤 Publicado: "${post.title}"${data.permalink ? ` — ${data.permalink}` : ""}`,
    actor,
    companyId: post.companyId,
  });
  return post;
}

async function markFailure(postId: string, error: string, keepContainer = false) {
  const post = await db.post.update({
    where: { id: postId },
    data: {
      publishAttempts: { increment: 1 },
      publishError: error,
      ...(keepContainer ? {} : { igContainerId: null, publishState: null }),
    },
    include: { company: true },
  });
  if (post.publishAttempts >= MAX_ATTEMPTS) {
    await db.post.update({ where: { id: postId }, data: { publishState: "FAILED" } });
    await escalateToAdmin({
      title: `Falha ao publicar "${post.title}" (${post.company.name})`,
      description: `Após ${MAX_ATTEMPTS} tentativas: ${error}\nCorrija e use "Publicar agora" na postagem.`,
      companyId: post.companyId,
      actor: "SYSTEM",
    });
  }
  return post;
}

/**
 * Publica (ou avança a publicação de) uma postagem.
 * Retorna o estado: PUBLISHED | PROCESSING (vídeo ainda processando) | MANUAL | ERROR
 */
export async function publishPost(postId: string, actor = "SYSTEM"): Promise<{ state: string; message: string; permalink?: string }> {
  const post = await loadPost(postId);
  const { company } = post;

  if (post.publishState === "PUBLISHED") return { state: "PUBLISHED", message: "Já publicado", permalink: post.permalink ?? undefined };

  if (!canPublish(company, post.platform)) {
    if (post.publishState !== "MANUAL") {
      await db.post.update({ where: { id: post.id }, data: { publishState: "MANUAL" } });
      await escalateToAdmin({
        title: `Publicar manualmente: "${post.title}" (${company.name})`,
        description:
          post.platform === "INSTAGRAM" || post.platform === "FACEBOOK"
            ? "A empresa não tem Instagram/Facebook conectado. Conecte em Empresas → Redes sociais, ou publique à mão e marque como publicado."
            : `Publicação automática em ${post.platform} ainda não é suportada. Publique à mão e marque como publicado.`,
        companyId: company.id,
        actor: "SYSTEM",
      });
    }
    return { state: "MANUAL", message: "Publicação manual necessária (pendência criada)" };
  }

  try {
    if (post.platform === "FACEBOOK") {
      const r = await publishToFacebook(company, post, post.media);
      await markPublished(post.id, { fbPostId: r.postId, permalink: r.permalink }, actor);
      return { state: "PUBLISHED", message: "Publicado no Facebook", permalink: r.permalink };
    }

    // Instagram em duas etapas
    let containerId = post.igContainerId;
    if (!containerId) {
      containerId = await createInstagramContainer(company, post, post.media);
      await db.post.update({ where: { id: post.id }, data: { igContainerId: containerId, publishState: "CONTAINER" } });
    }
    const result = await publishInstagramContainer(company, containerId);
    if (!result) return { state: "PROCESSING", message: "Instagram ainda processando o vídeo — a rotina conclui em alguns minutos" };

    let fbPostId: string | undefined;
    if (company.crosspostFacebook && company.fbPageId) {
      try {
        fbPostId = (await publishToFacebook(company, post, post.media)).postId;
      } catch (err) {
        console.error("[publish] crosspost Facebook falhou", err);
      }
    }
    await markPublished(post.id, { igMediaId: result.mediaId, fbPostId, permalink: result.permalink }, actor);
    return { state: "PUBLISHED", message: "Publicado no Instagram", permalink: result.permalink };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailure(post.id, msg);
    return { state: "ERROR", message: msg };
  }
}

/** Rotina: publica tudo que está aprovado e com horário vencido. */
export async function runScheduledPublishing() {
  const due = await db.post.findMany({
    where: {
      status: { in: ["APPROVED", "SCHEDULED"] },
      scheduledAt: { lte: new Date() },
      OR: [{ publishState: null }, { publishState: "CONTAINER" }],
      company: { autoPublish: true },
    },
    select: { id: true },
    take: 20,
  });
  let published = 0;
  for (const p of due) {
    const r = await publishPost(p.id);
    if (r.state === "PUBLISHED") published++;
  }
  return published;
}
