# Agência OS

Plataforma para operar uma agência de marketing inteira com **uma pessoa só**. Você é o administrador: dá as ordens, e uma equipe de funcionários de IA faz o trabalho, do primeiro contato com o lead até o pós-venda.

- **Diretor IA**: recebe ordens em linguagem natural e executa usando o sistema inteiro.
  > "Planeje 8 posts de novembro para a Padaria Sol, gere as artes e mande os 2 primeiros para aprovação"
- **Funcionários de IA no WhatsApp** (SDR, Closer, Atendimento, Pós-venda, Financeiro): conversam com clientes e leads, e registram o que acontece no sistema. Aprovam posts, anotam pedidos de alteração, movem leads no funil, agendam follow-ups e passam a conversa para você quando algo foge da alçada deles.
- **Organização por empresa**: cada cliente tem marca, tom de voz, postagens, ideias, contratos, cobranças, tarefas e histórico.

## Módulos

| Módulo | O que faz |
|---|---|
| **Painel** | KPIs (clientes, MRR, aprovações, inadimplência), funil, pendências escaladas pela IA e atividade recente |
| **Diretor IA** (`/comando`) | Ordens em linguagem natural, com 39 ferramentas: clientes, conteúdo, artes, publicação, WhatsApp, contratos, cobrança, agenda, relatórios, leads e equipe |
| **Empresas** | Cadastro, marca (tom de voz e diretrizes usados pela IA), visão 360° e onboarding feito pela IA |
| **Postagens** | Kanban: ideia → produção → aprovação → alteração → aprovado → agendado → publicado. Legenda, hashtags e briefing escritos por IA; imagem e vídeo gerados por IA; upload direto de fotos/vídeos |
| **Publicação automática** | Post aprovado pelo cliente é publicado sozinho no Instagram (feed, carrossel, reels, stories) e/ou Facebook na data agendada, com link do post salvo |
| **Cronograma** | Calendário mensal por empresa |
| **Ideias** | Banco de ideias com três origens: equipe, IA e cliente (pelo WhatsApp) |
| **WhatsApp** | Caixa de entrada, conversas em tempo real e botão para assumir a conversa ou devolver para a IA. Você pode dar ordens ao agente de cada conversa |
| **Prospecção** | Funil de leads, importação em massa (colando da planilha), primeiro contato e follow-ups automáticos pela IA, conversão em cliente |
| **Equipe de IA** | Crie e edite funcionários: nome, função, personalidade, metas e cadência de follow-up |
| **Contratos** | Redação por IA, envio pelo WhatsApp e assinatura eletrônica (registra nome, CPF, data/hora e IP) |
| **Financeiro** | Mensalidades geradas sozinhas, cobrança no Mercado Pago (link Pix/boleto/cartão + Pix copia e cola) enviada no WhatsApp, lembretes e **baixa automática** quando o cliente paga |
| **Agenda** | Horários livres do Google Agenda; os agentes de IA marcam reuniões com link do Meet e convite por e-mail; lembrete no WhatsApp 1h antes |
| **Relatórios** | Relatório mensal por cliente com métricas do Instagram + produção da agência, análise escrita pela IA, enviado no WhatsApp com link para a versão completa |
| **Tarefas** | Quadro operacional com as pendências que a IA escalou para você |
| **Páginas do cliente** | `/aprovar/[token]` para aprovar ou pedir alteração de um post, `/contrato/[token]` para assinar, `/relatorio/[token]` com o relatório do mês |

## Como a IA trabalha

```
WhatsApp ──webhook──▶ /api/webhooks/whatsapp
                         │
                         ├─ número de cliente → Atendimento (ou Pós-venda se em onboarding)
                         └─ número desconhecido → vira Lead → SDR
                                   │
                         agente Claude + ferramentas (aprovar post, pedir alteração,
                         mover lead, agendar follow-up, transferir para o Closer,
                         fechar venda, escalar para o dono...)
                                   │
                         resposta enviada no WhatsApp + tudo registrado no painel

Rotina (/api/cron/tick, a cada 5 min): publica posts aprovados na hora marcada, follow-ups
de leads, vídeos prontos, gera e envia mensalidades, lembretes de vencimento/atraso,
lembrete de reunião, relatórios no dia 1, contratos vencendo.
```

- Modelo: `claude-opus-5` (configurável em `CLAUDE_MODEL`), com pensamento adaptativo e **fallback automático no servidor** se houver recusa de segurança.
- Cada ferramenta tem schema Zod e a entrada é validada antes de executar. O agente de um cliente só consegue mexer nas postagens **daquele** cliente.
- As mensagens do contato entram no prompt como dados, não como instruções. Descontos, contratos e decisões sensíveis viram pendência para você decidir.
- O conhecimento da agência (serviços, planos, preços, link de agenda) fica em **Configurações** e todos os agentes usam.

## Rodando localmente

Requisitos: Node 20 ou superior e PostgreSQL.

```bash
cd platform
cp .env.example .env          # preencha DATABASE_URL e ADMIN_PASSWORD
npm install
npx prisma db push            # cria as tabelas
npm run db:seed               # cria a equipe de IA inicial (SEED_DEMO=1 para dados de exemplo)
npm run dev                   # http://localhost:3000
```

Sem `ANTHROPIC_API_KEY` o painel funciona, mas a IA fica desligada. Sem provedor de WhatsApp, o sistema roda em **modo simulação**: as mensagens são registradas, mas nada é enviado.

## Deploy no Railway

1. Crie um serviço a partir deste repositório com **Root Directory = `platform`**. O `Dockerfile` e o `railway.json` já estão prontos.
2. Adicione um banco **PostgreSQL** e aponte `DATABASE_URL` para ele.
3. Preencha as variáveis do `.env.example` (no mínimo `ADMIN_PASSWORD`, `SESSION_SECRET`, `APP_URL`, `ANTHROPIC_API_KEY`, `CRON_SECRET` e `WEBHOOK_SECRET`).
4. Na inicialização, o container aplica o schema, cria a equipe de IA e sobe o servidor.
5. **Rotina automática**: crie um Cron no Railway (ou use cron-job.org) chamando `GET {APP_URL}/api/cron/tick?secret={CRON_SECRET}` a cada 5 minutos. Outra opção é um segundo serviço rodando `npm run worker`.

## Conectando o WhatsApp

**Opção A: Evolution API** (conecta seu número por QR Code, sem aprovação da Meta)
1. Suba a Evolution API (existe template no Railway) e crie uma instância.
2. Configure `WHATSAPP_PROVIDER=evolution`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE`.
3. Na instância, configure o webhook `{APP_URL}/api/webhooks/whatsapp?secret={WEBHOOK_SECRET}` com o evento `MESSAGES_UPSERT`.

**Opção B: WhatsApp Cloud API oficial (Meta)**
1. `WHATSAPP_PROVIDER=meta`, `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_VERIFY_TOKEN` e `META_APP_SECRET`.
2. Callback URL: `{APP_URL}/api/webhooks/whatsapp`, com o mesmo verify token. Assine o campo `messages`.
3. Na API oficial, a primeira mensagem para quem não falou com você nas últimas 24h precisa ser um *template* aprovado. A prospecção ativa funciona melhor pela Evolution.

## Imagens e vídeos com IA

Configure `FAL_KEY` ([fal.ai](https://fal.ai)). Os modelos padrão são `fal-ai/flux/dev` (imagem) e Kling (vídeo), e podem ser trocados em `FAL_IMAGE_MODEL` e `FAL_VIDEO_MODEL`. As imagens são geradas na hora; os vídeos entram numa fila e a rotina busca o resultado. Com o R2 configurado, tudo que a IA gera é copiado para o seu bucket (link permanente).

## Publicação automática (Instagram e Facebook)

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Empresa**, adicione **Login do Facebook** e cadastre o redirect `{APP_URL}/api/meta/callback`. Preencha `META_APP_ID` e `META_APP_SECRET`.
2. Os Instagrams dos clientes precisam ser **profissionais** e vinculados a uma Página do Facebook que a sua conta administra (o jeito mais fácil é o cliente dar acesso à sua agência no Business Manager).
3. Em **Configurações → Conectar Facebook**, faça login uma vez. Depois, na tela de cada empresa, em **Redes sociais**, escolha a página/Instagram do cliente.
4. A partir daí: post **aprovado** + data agendada → a rotina publica sozinha. Falhou 3 vezes → vira pendência para você. Só conteúdo aprovado é publicado.

Enquanto o app estiver em modo de desenvolvimento, funciona para contas que têm papel no app (você). Para uso com contas de terceiros, a Meta exige a revisão do app com as permissões `instagram_content_publish`, `pages_manage_posts` e `instagram_manage_insights`.

## Cobrança (Mercado Pago)

1. Em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers) → Suas integrações → crie uma aplicação → **Credenciais de produção** → `MP_ACCESS_TOKEN`.
2. Em **Webhooks**, cadastre `{APP_URL}/api/webhooks/mercadopago` com o evento **Pagamentos** e copie a assinatura secreta para `MP_WEBHOOK_SECRET`.
3. Nas empresas, preencha **mensalidade**, **dia de vencimento** e **e-mail** (o e-mail habilita o Pix copia e cola; sem ele o cliente paga pelo link).

Fluxo: X dias antes do vencimento (configurável) a mensalidade é criada, a cobrança é gerada e enviada no WhatsApp; perto do vencimento vai um lembrete; se vencer, um aviso. Quando o cliente paga, o Mercado Pago avisa o sistema, a fatura é baixada e o cliente recebe a confirmação. O status é sempre conferido na API do Mercado Pago, então uma notificação falsa não baixa fatura.

## Agenda (Google Agenda + Meet)

1. No [Google Cloud Console](https://console.cloud.google.com): ative a **Google Calendar API**, configure a tela de consentimento OAuth e crie uma credencial **ID do cliente OAuth → Aplicativo da Web** com o redirect `{APP_URL}/api/google/callback`. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
2. Em **Configurações → Conectar Google Agenda**. Ajuste dias, horário e duração das reuniões.

Os agentes (SDR, Closer, Atendimento) consultam os horários livres, oferecem opções ao contato e marcam a reunião; o evento aparece na sua agenda com link do Meet e convite para o e-mail do contato. Sem o Google conectado, a agenda funciona só dentro da plataforma (sem Meet).

## Upload de arquivos (Cloudflare R2)

1. No painel da Cloudflare → R2: crie um bucket, ative o **acesso público** (domínio `r2.dev` ou domínio próprio) e crie um **token de API do R2** com permissão de leitura e escrita.
2. Preencha `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` e `R2_PUBLIC_URL`.
3. No bucket → Settings → **CORS policy**, libere o envio a partir do seu painel:

```json
[{ "AllowedOrigins": ["https://SEU-APP_URL"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
```

O arquivo vai direto do navegador para o R2 (até 500 MB), sem passar pelo servidor.

## Relatórios mensais

No dia 1 de cada mês a rotina gera o relatório do mês anterior para cada cliente ativo. Por padrão fica como **rascunho** e cria uma pendência para você revisar e enviar; em Configurações dá para mudar para "gerar e enviar sozinho" ou desligar. Também dá para gerar a qualquer momento em **Relatórios** ou pedir ao Diretor IA.

## Segurança

- Tokens da Meta e do Google ficam **criptografados** no banco (AES-256-GCM com `ENCRYPTION_KEY`).
- Toda ação do painel confere o login no servidor; as páginas do cliente só acessam o registro do próprio link secreto.
- Webhooks validados: WhatsApp (segredo na URL ou assinatura da Meta), Mercado Pago (assinatura + consulta do pagamento na API).
- Datas de calendário usam o fuso `AGENCY_TZ` (padrão America/Sao_Paulo), independentemente do fuso do servidor.

## Estrutura do código

```
platform/
├─ prisma/schema.prisma        # modelo de dados (empresas, posts, contratos, leads, agentes, conversas...)
├─ prisma/seed.mjs             # equipe de IA inicial + perfil da agência
├─ src/lib/
│  ├─ claude.ts                # loop de agente com ferramentas, JSON estruturado, fallback
│  ├─ agents/whatsapp-agent.ts # funcionários de IA do WhatsApp (ferramentas por contexto)
│  ├─ agents/director.ts       # Diretor IA (ordens do administrador)
│  ├─ services.ts              # regras de negócio compartilhadas
│  ├─ content.ts               # ideias, legendas, contratos com IA
│  ├─ media.ts                 # geração de imagem/vídeo (fal.ai)
│  ├─ whatsapp.ts              # Evolution API / Cloud API / simulação
│  ├─ meta.ts, publishing.ts   # Instagram/Facebook: OAuth, publicação, métricas
│  ├─ mercadopago.ts, billing.ts # cobrança, Pix, webhooks, mensalidades
│  ├─ google.ts, agenda.ts     # Google Agenda, horários livres, reuniões
│  ├─ reports.ts               # relatórios mensais
│  ├─ storage.ts               # Cloudflare R2
│  └─ automation.ts            # rotina automática
├─ src/app/(painel)/...        # telas do painel
├─ src/app/aprovar, contrato   # páginas públicas do cliente
└─ src/app/api/...             # webhook, cron, login
```

## Próximos passos sugeridos

- Publicação no TikTok e LinkedIn (hoje esses posts viram pendência para publicar à mão)
- Assinatura recorrente no Mercado Pago (débito automático no cartão)
- Receber fotos e áudios que o cliente manda no WhatsApp direto na pasta da empresa
- Painel de tráfego pago (Meta Ads) dentro dos relatórios
