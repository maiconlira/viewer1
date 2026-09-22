// Geração de conteúdo com IA: ideias de pauta, legendas, briefings visuais e contratos.
import { z } from "zod";
import { db } from "./db";
import { generateJSON, generateText } from "./claude";
import { createIdea } from "./services";
import { AGENCY_NAME, date, money } from "./utils";
import type { Company } from "@prisma/client";

function brandContext(c: Company) {
  return [
    `Empresa: ${c.name}`,
    c.segment && `Segmento: ${c.segment}`,
    c.instagram && `Instagram: ${c.instagram}`,
    c.brandVoice && `Tom de voz: ${c.brandVoice}`,
    c.brandGuidelines && `Diretrizes da marca: ${c.brandGuidelines}`,
    c.notes && `Observações: ${c.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const STRATEGIST_SYSTEM = `Você é o estrategista de conteúdo sênior da agência ${AGENCY_NAME}, especializado em redes sociais no Brasil.
Escreva em português do Brasil, com linguagem natural e alinhada ao tom de voz da marca.
Priorize ideias concretas, executáveis por uma equipe enxuta, com gancho forte nos primeiros segundos/linhas.`;

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe("Título curto da pauta"),
      description: z.string().describe("Formato sugerido, gancho, roteiro resumido e objetivo"),
    }),
  ),
});

export async function generateIdeas(companyId: string, count = 5, theme?: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const recent = await db.post.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { title: true },
  });
  const result = await generateJSON({
    system: STRATEGIST_SYSTEM,
    schema: IdeasSchema,
    prompt: `${brandContext(company)}

Postagens recentes (evite repetir): ${recent.map((r) => r.title).join("; ") || "nenhuma"}
${theme ? `Tema/objetivo pedido: ${theme}` : ""}

Gere exatamente ${count} ideias de conteúdo variadas (educativo, bastidores, prova social, oferta, tendência).`,
  });
  const created = [];
  for (const idea of result.ideas.slice(0, count)) {
    created.push(await createIdea({ companyId, title: idea.title, description: idea.description, source: "AI" }));
  }
  return created;
}

const CaptionSchema = z.object({
  caption: z.string().describe("Legenda completa pronta para publicar, com quebras de linha e CTA"),
  hashtags: z.string().describe("De 5 a 12 hashtags separadas por espaço"),
  briefing: z.string().describe("Briefing visual em inglês para gerar a arte/vídeo com IA (cena, estilo, cores, enquadramento)"),
});

export async function generateCaption(postId: string, instructions?: string) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { company: true, idea: true } });
  const result = await generateJSON({
    system: STRATEGIST_SYSTEM,
    schema: CaptionSchema,
    prompt: `${brandContext(post.company)}

Postagem: ${post.title}
Rede: ${post.platform} — Formato: ${post.format}
${post.idea?.description ? `Ideia de origem: ${post.idea.description}` : ""}
${post.feedback ? `Pedido de alteração do cliente (obrigatório atender): ${post.feedback}` : ""}
${post.caption ? `Legenda atual: ${post.caption}` : ""}
${instructions ? `Instruções extras: ${instructions}` : ""}

Escreva a legenda, hashtags e o briefing visual.`,
  });
  return db.post.update({
    where: { id: postId },
    data: {
      caption: result.caption,
      hashtags: result.hashtags,
      briefing: result.briefing,
      status: post.status === "IDEA" || post.status === "CHANGES_REQUESTED" ? "PRODUCTION" : post.status,
    },
  });
}

export async function draftContract(input: {
  companyId: string;
  title?: string;
  services: string;
  value: number;
  months: number;
  startDate?: Date;
  extraClauses?: string;
}) {
  const company = await db.company.findUniqueOrThrow({ where: { id: input.companyId } });
  const start = input.startDate ?? new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + input.months);

  const body = await generateText({
    system: `Você redige contratos de prestação de serviços de marketing digital para a agência ${AGENCY_NAME}, conforme a legislação brasileira.
Produza um contrato claro e completo em português, em texto simples (use títulos de cláusula em MAIÚSCULAS, sem markdown).
Inclua: partes, objeto, escopo detalhado, prazos e aprovações de conteúdo, obrigações das partes, valor e forma de pagamento,
vigência e renovação, rescisão, propriedade intelectual e uso de imagem, confidencialidade/LGPD, foro. Onde faltar dado, deixe [PREENCHER].`,
    prompt: `Contratante: ${company.name}${company.document ? `, CPF/CNPJ ${company.document}` : ""}${company.contactName ? `, representada por ${company.contactName}` : ""}
Contratada: ${AGENCY_NAME}
Serviços: ${input.services}
Valor mensal: ${money(input.value)}${company.billingDay ? `, vencimento todo dia ${company.billingDay}` : ""}
Vigência: ${input.months} meses, de ${date(start)} a ${date(end)}
${input.extraClauses ? `Cláusulas adicionais pedidas: ${input.extraClauses}` : ""}`,
  });

  return db.contract.create({
    data: {
      companyId: company.id,
      title: input.title || `Prestação de serviços — ${company.name}`,
      body,
      value: input.value,
      startDate: start,
      endDate: end,
    },
  });
}
