// Cria a equipe inicial de funcionários de IA (e dados de demonstração com SEED_DEMO=1).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** @type {{ name: string; role: import("@prisma/client").AgentRole; persona: string; goals?: string }[]} */
const TEAM = [
  {
    name: "Lara",
    role: "SDR",
    persona:
      "Simpática, curiosa e objetiva. Faz uma pergunta por vez. Começa entendendo o negócio do lead (o que vende, para quem, como usa as redes hoje) antes de falar da agência. Nunca manda textão.",
    goals: "Qualificar: segmento, faturamento aproximado, quem decide, dor principal nas redes e urgência. Levar leads qualificados para reunião ou para o Closer.",
  },
  {
    name: "Rafael",
    role: "CLOSER",
    persona:
      "Consultivo, seguro e transparente. Conecta a dor do lead a um plano específico, apresenta valores com clareza e trata objeções com exemplos concretos. Não pressiona; conduz para uma decisão.",
    goals: "Fechar planos mensais com fidelidade. Oferecer o plano anual quando fizer sentido.",
  },
  {
    name: "Bia",
    role: "ACCOUNT_MANAGER",
    persona:
      "Atenciosa, organizada e rápida. Confirma sempre qual postagem o cliente está aprovando. Registra pedidos de alteração exatamente como o cliente pediu. Tom leve e profissional.",
    goals: "Aprovações rápidas, cliente sempre informado sobre o cronograma.",
  },
  {
    name: "Júlia",
    role: "POST_SALES",
    persona:
      "Acolhedora e didática. Faz o cliente se sentir bem cuidado desde o primeiro dia. Coleta as informações de marca em etapas, sem sobrecarregar.",
    goals: "Onboarding completo em até 3 dias: tom de voz, público, cores, referências, acessos e fotos de produtos.",
  },
  {
    name: "Marta",
    role: "FINANCE",
    persona: "Educada, clara e discreta. Lembra vencimentos com gentileza e facilita o pagamento.",
  },
];

async function main() {
  for (const a of TEAM) {
    const exists = await db.agent.findFirst({ where: { role: a.role } });
    if (!exists) await db.agent.create({ data: { ...a, isDefault: true } });
  }

  const profile = await db.setting.findUnique({ where: { key: "agency_profile" } });
  if (!profile) {
    await db.setting.create({
      data: {
        key: "agency_profile",
        value: `[EDITE EM CONFIGURAÇÕES]
Somos uma agência de marketing digital focada em pequenos e médios negócios locais.
Serviços: gestão de redes sociais (Instagram, Facebook, TikTok), criação de conteúdo (artes e vídeos), tráfego pago e relatórios.
Planos:
- Essencial — R$ 1.200/mês: 8 posts no feed + 8 stories, 1 relatório mensal.
- Crescimento — R$ 2.000/mês: 12 posts + 4 reels + stories, gestão de tráfego (verba à parte).
- Premium — R$ 3.500/mês: 20 posts + 8 reels, tráfego, gravação mensal.
Fidelidade mínima de 6 meses. Pagamento via Pix ou boleto. Aprovação de posts pelo WhatsApp.`,
      },
    });
  }

  if (process.env.SEED_DEMO === "1") {
    const company = await db.company.upsert({
      where: { whatsapp: "5511900000001" },
      update: {},
      create: {
        name: "Padaria Sol Nascente",
        segment: "Padaria e confeitaria",
        contactName: "Ana Paula",
        whatsapp: "5511900000001",
        status: "ACTIVE",
        monthlyFee: 1800,
        billingDay: 10,
        postsPerMonth: 12,
        brandVoice: "Acolhedor, caseiro, afetivo. Fala com famílias do bairro. Usa emojis de pão e café com moderação.",
        brandGuidelines: "Cores: amarelo e marrom. Destaque para pão de fermentação natural e bolos de festa.",
      },
    });
    const soon = new Date(Date.now() + 2 * 86400000);
    await db.post.create({
      data: {
        companyId: company.id,
        title: "Bastidores: o pão de fermentação natural",
        caption: "Você sabia que nosso pão leva 24h para ficar pronto? ⏳🍞\nTudo começa às 4h da manhã...",
        hashtags: "#padaria #fermentacaonatural #paocaseiro",
        status: "PENDING_APPROVAL",
        scheduledAt: soon,
        sentForApprovalAt: new Date(),
      },
    });
    await db.lead.upsert({
      where: { phone: "5511900000002" },
      update: {},
      create: { name: "Carlos", businessName: "Oficina Turbo", segment: "Automotivo", phone: "5511900000002", source: "Indicação" },
    });
  }
  console.log("Seed concluído.");
}

main().finally(() => db.$disconnect());
