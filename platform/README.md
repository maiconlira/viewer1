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
| **Diretor IA** (`/comando`) | Ordens em linguagem natural, com cerca de 35 ferramentas: clientes, conteúdo, artes, WhatsApp, contratos, financeiro, leads e equipe |
| **Empresas** | Cadastro, marca (tom de voz e diretrizes usados pela IA), visão 360° e onboarding feito pela IA |
| **Postagens** | Kanban: ideia → produção → aprovação → alteração → aprovado → agendado → publicado. Legenda, hashtags e briefing escritos por IA; imagem e vídeo gerados por IA |
| **Cronograma** | Calendário mensal por empresa |
| **Ideias** | Banco de ideias com três origens: equipe, IA e cliente (pelo WhatsApp) |
| **WhatsApp** | Caixa de entrada, conversas em tempo real e botão para assumir a conversa ou devolver para a IA. Você pode dar ordens ao agente de cada conversa |
| **Prospecção** | Funil de leads, importação em massa (colando da planilha), primeiro contato e follow-ups automáticos pela IA, conversão em cliente |
| **Equipe de IA** | Crie e edite funcionários: nome, função, personalidade, metas e cadência de follow-up |
| **Contratos** | Redação por IA, envio pelo WhatsApp e assinatura eletrônica (registra nome, CPF, data/hora e IP) |
| **Financeiro** | Mensalidades, cobranças e lembrete automático de fatura vencida |
| **Tarefas** | Quadro operacional com as pendências que a IA escalou para você |
| **Páginas do cliente** | `/aprovar/[token]` para aprovar ou pedir alteração de um post, `/contrato/[token]` para assinar |

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

Rotina (/api/cron/tick, a cada 5 min): follow-ups de leads, vídeos prontos,
posts aprovados → agendados, faturas vencidas + lembrete, contratos vencendo.
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

Configure `FAL_KEY` ([fal.ai](https://fal.ai)). Os modelos padrão são `fal-ai/flux/dev` (imagem) e Kling (vídeo), e podem ser trocados em `FAL_IMAGE_MODEL` e `FAL_VIDEO_MODEL`. As imagens são geradas na hora. Os vídeos entram numa fila e a rotina automática busca o resultado quando fica pronto.

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
│  └─ automation.ts            # rotina automática
├─ src/app/(painel)/...        # telas do painel
├─ src/app/aprovar, contrato   # páginas públicas do cliente
└─ src/app/api/...             # webhook, cron, login
```

## Próximos passos sugeridos

- Publicação automática no Instagram/Facebook (Meta Graph API) quando o post estiver agendado
- Cobrança integrada (Asaas, Mercado Pago ou Stripe) com link de Pix gerado automaticamente
- Agendamento de reuniões com Google Calendar
- Relatórios mensais de desempenho por cliente (Meta Insights) gerados e enviados pela IA
- Upload de arquivos direto (S3/R2) em vez de URL
