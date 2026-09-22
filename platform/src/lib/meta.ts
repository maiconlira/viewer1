// Integração com a Meta Graph API: login com Facebook, publicação no Instagram/Facebook e métricas.
// Fluxo: o dono conecta a conta do Facebook dele UMA vez (que administra as páginas dos clientes no
// Business Manager). Depois, em cada empresa, escolhe a página/Instagram — o token da página é salvo criptografado.
import type { Company, MediaAsset, Post } from "@prisma/client";
import { decrypt } from "./crypto";

const GRAPH_VERSION = "v21.0";
export const GRAPH = () => (process.env.GRAPH_API_BASE || `https://graph.facebook.com/${GRAPH_VERSION}`).replace(/\/$/, "");

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "read_insights",
  "business_management",
];

export function metaOAuthEnabled() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
  ) {
    super(message);
  }
}

async function graph<T>(path: string, token: string, opts: { method?: "GET" | "POST"; params?: Record<string, string | undefined> } = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined) params.set(k, v);
  if (token) params.set("access_token", token);
  const method = opts.method ?? "GET";
  const url = `${GRAPH()}${path}${method === "GET" ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: method === "POST" ? params : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message: string; code?: number } };
  if (!res.ok || json.error) {
    throw new GraphError(json.error?.message ?? `Graph API ${res.status}`, res.status, json.error?.code);
  }
  return json as T;
}

// ─────────────── OAuth ───────────────

export function metaAuthUrl(redirectUri: string, state: string) {
  const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", process.env.META_APP_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

/** Troca o código do OAuth por um token de usuário de longa duração (~60 dias). */
export async function exchangeMetaCode(code: string, redirectUri: string) {
  const short = await graph<{ access_token: string }>("/oauth/access_token", "", {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    },
  });
  const long = await graph<{ access_token: string }>("/oauth/access_token", "", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    },
  });
  const me = await graph<{ name: string }>("/me", long.access_token, { params: { fields: "name" } });
  return { token: long.access_token, name: me.name };
}

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

/** Páginas (e Instagram vinculados) que o usuário conectado administra. Tokens de página não expiram. */
export async function listMetaPages(userToken: string) {
  const res = await graph<{ data: MetaPage[] }>("/me/accounts", userToken, {
    params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" },
  });
  return res.data;
}

export async function checkCompanyConnection(company: Company) {
  const token = decrypt(company.metaToken);
  if (!token) return { ok: false, error: "Sem token" };
  try {
    const out: Record<string, string> = {};
    if (company.igUserId) {
      const ig = await graph<{ username: string; followers_count: number }>(`/${company.igUserId}`, token, {
        params: { fields: "username,followers_count" },
      });
      out.instagram = `@${ig.username} (${ig.followers_count} seguidores)`;
    }
    if (company.fbPageId) {
      const page = await graph<{ name: string }>(`/${company.fbPageId}`, token, { params: { fields: "name" } });
      out.facebook = page.name;
    }
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────── Publicação ───────────────

export function canPublish(company: Company, platform: Post["platform"]) {
  if (!company.metaToken) return false;
  if (platform === "INSTAGRAM") return Boolean(company.igUserId);
  if (platform === "FACEBOOK") return Boolean(company.fbPageId);
  return false;
}

function fullCaption(post: Post) {
  return [post.caption, post.hashtags].filter(Boolean).join("\n\n");
}

const isVideo = (m: MediaAsset) => m.kind === "VIDEO";

async function waitContainer(id: string, token: string, maxMs: number) {
  const start = Date.now();
  while (true) {
    const s = await graph<{ status_code: string; status?: string }>(`/${id}`, token, { params: { fields: "status_code,status" } });
    if (s.status_code === "FINISHED") return "FINISHED";
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram recusou a mídia: ${s.status ?? s.status_code}`);
    if (Date.now() - start > maxMs) return "IN_PROGRESS";
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/**
 * Cria o container de mídia no Instagram (etapa 1). Vídeos podem levar minutos para processar,
 * por isso a publicação (etapa 2) é concluída pela rotina automática quando o container fica pronto.
 */
export async function createInstagramContainer(company: Company, post: Post, media: MediaAsset[]) {
  const token = decrypt(company.metaToken)!;
  const ig = company.igUserId!;
  const caption = fullCaption(post);
  if (media.length === 0) throw new Error("Instagram exige imagem ou vídeo — adicione uma mídia à postagem.");

  if (post.format === "CAROUSEL" && media.length > 1) {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const child = await graph<{ id: string }>(`/${ig}/media`, token, {
        method: "POST",
        params: isVideo(m)
          ? { media_type: "VIDEO", video_url: m.url!, is_carousel_item: "true" }
          : { image_url: m.url!, is_carousel_item: "true" },
      });
      if (isVideo(m)) await waitContainer(child.id, token, 90_000);
      children.push(child.id);
    }
    const parent = await graph<{ id: string }>(`/${ig}/media`, token, {
      method: "POST",
      params: { media_type: "CAROUSEL", children: children.join(","), caption },
    });
    return parent.id;
  }

  const m = media[0];
  let params: Record<string, string>;
  if (post.format === "STORY") {
    params = isVideo(m) ? { media_type: "STORIES", video_url: m.url! } : { media_type: "STORIES", image_url: m.url! };
  } else if (isVideo(m)) {
    params = { media_type: "REELS", video_url: m.url!, caption, share_to_feed: "true" };
  } else {
    params = { image_url: m.url!, caption };
  }
  const container = await graph<{ id: string }>(`/${ig}/media`, token, { method: "POST", params });
  return container.id;
}

/** Etapa 2: publica o container se estiver pronto. Retorna null se ainda estiver processando. */
export async function publishInstagramContainer(company: Company, containerId: string, waitMs = 15_000) {
  const token = decrypt(company.metaToken)!;
  const status = await waitContainer(containerId, token, waitMs);
  if (status !== "FINISHED") return null;
  const published = await graph<{ id: string }>(`/${company.igUserId}/media_publish`, token, {
    method: "POST",
    params: { creation_id: containerId },
  });
  let permalink: string | undefined;
  try {
    permalink = (await graph<{ permalink?: string }>(`/${published.id}`, token, { params: { fields: "permalink" } })).permalink;
  } catch {
    /* stories não têm permalink */
  }
  return { mediaId: published.id, permalink };
}

export async function publishToFacebook(company: Company, post: Post, media: MediaAsset[]) {
  const token = decrypt(company.metaToken)!;
  const page = company.fbPageId!;
  const message = fullCaption(post);
  let postId: string;

  const video = media.find(isVideo);
  if (video) {
    const r = await graph<{ id: string }>(`/${page}/videos`, token, {
      method: "POST",
      params: { file_url: video.url!, description: message },
    });
    postId = r.id;
  } else if (media.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`/${page}/photos`, token, {
      method: "POST",
      params: { url: media[0].url!, message },
    });
    postId = r.post_id ?? r.id;
  } else if (media.length > 1) {
    const ids: string[] = [];
    for (const m of media.slice(0, 10)) {
      const r = await graph<{ id: string }>(`/${page}/photos`, token, {
        method: "POST",
        params: { url: m.url!, published: "false" },
      });
      ids.push(r.id);
    }
    const params: Record<string, string> = { message };
    ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    postId = (await graph<{ id: string }>(`/${page}/feed`, token, { method: "POST", params })).id;
  } else {
    postId = (await graph<{ id: string }>(`/${page}/feed`, token, { method: "POST", params: { message } })).id;
  }

  let permalink: string | undefined;
  try {
    permalink = (await graph<{ permalink_url?: string }>(`/${postId}`, token, { params: { fields: "permalink_url" } })).permalink_url;
  } catch {
    /* opcional */
  }
  return { postId, permalink };
}

// ─────────────── Métricas (relatórios) ───────────────

export type InstagramMonthStats = {
  username?: string;
  followers?: number;
  mediaCount?: number;
  account: Record<string, number>;
  posts: {
    id: string;
    caption: string;
    type: string;
    permalink?: string;
    timestamp: string;
    likes: number;
    comments: number;
    reach?: number;
    saves?: number;
    shares?: number;
    views?: number;
  }[];
  errors: string[];
};

const ACCOUNT_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "profile_links_taps", "follows_and_unfollows"];

/** Métricas do Instagram no período. Cada métrica é consultada separadamente para tolerar mudanças da API. */
export async function instagramStats(company: Company, since: Date, until: Date): Promise<InstagramMonthStats> {
  const token = decrypt(company.metaToken);
  const ig = company.igUserId;
  const out: InstagramMonthStats = { account: {}, posts: [], errors: [] };
  if (!token || !ig) {
    out.errors.push("Instagram não conectado");
    return out;
  }
  // a API aceita no máximo 30 dias por consulta
  const end = new Date(Math.min(until.getTime(), since.getTime() + 30 * 86400000));
  const s = String(Math.floor(since.getTime() / 1000));
  const u = String(Math.floor(end.getTime() / 1000));

  try {
    const p = await graph<{ username: string; followers_count: number; media_count: number }>(`/${ig}`, token, {
      params: { fields: "username,followers_count,media_count" },
    });
    out.username = p.username;
    out.followers = p.followers_count;
    out.mediaCount = p.media_count;
  } catch (err) {
    out.errors.push(`perfil: ${(err as Error).message}`);
  }

  await Promise.all(
    ACCOUNT_METRICS.map(async (metric) => {
      try {
        const r = await graph<{ data: { name: string; total_value?: { value: number }; values?: { value: number }[] }[] }>(
          `/${ig}/insights`,
          token,
          { params: { metric, period: "day", metric_type: "total_value", since: s, until: u } },
        );
        const d = r.data[0];
        const value = d?.total_value?.value ?? d?.values?.reduce((acc, v) => acc + (Number(v.value) || 0), 0);
        if (typeof value === "number") out.account[metric] = value;
      } catch (err) {
        out.errors.push(`${metric}: ${(err as Error).message}`);
      }
    }),
  );

  try {
    const media = await graph<{
      data: { id: string; caption?: string; media_type: string; permalink?: string; timestamp: string; like_count?: number; comments_count?: number }[];
    }>(`/${ig}/media`, token, {
      params: { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", since: s, until: u, limit: "50" },
    });
    out.posts = media.data.map((m) => ({
      id: m.id,
      caption: (m.caption ?? "").slice(0, 140),
      type: m.media_type,
      permalink: m.permalink,
      timestamp: m.timestamp,
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
    }));
    // métricas por post (melhor esforço, até 15 posts)
    await Promise.all(
      out.posts.slice(0, 15).map(async (post) => {
        for (const metric of ["reach", "saved", "shares", "views"] as const) {
          try {
            const r = await graph<{ data: { values?: { value: number }[]; total_value?: { value: number } }[] }>(`/${post.id}/insights`, token, {
              params: { metric },
            });
            const v = r.data[0]?.total_value?.value ?? r.data[0]?.values?.[0]?.value;
            if (typeof v === "number") {
              if (metric === "saved") post.saves = v;
              else post[metric] = v;
            }
          } catch {
            /* métrica indisponível para esse tipo de mídia */
          }
        }
      }),
    );
  } catch (err) {
    out.errors.push(`posts: ${(err as Error).message}`);
  }
  return out;
}
