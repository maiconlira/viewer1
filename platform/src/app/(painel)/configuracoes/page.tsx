import { db } from "@/lib/db";
import { Badge, Field, PageHeader, Section } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { disconnectMeta, saveSettings } from "../../actions";
import { getOption, getSecret, OPTION_DEFAULTS, SETTING_KEYS, type OptionKey, type SettingKey } from "@/lib/settings";
import { appUrl } from "@/lib/utils";
import { aiEnabled, CLAUDE_MODEL } from "@/lib/claude";
import { whatsappProvider } from "@/lib/whatsapp";
import { mediaEnabled } from "@/lib/media";
import { storageEnabled } from "@/lib/storage";
import { mercadoPagoEnabled } from "@/lib/mercadopago";
import { metaOAuthEnabled } from "@/lib/meta";
import { googleOAuthEnabled } from "@/lib/google";

function Status({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <div>
        <div>{label}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </div>
      <Badge className={ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{ok ? "Ativo" : "Pendente"}</Badge>
    </div>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-2"><code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{url}</code><CopyButton text={url} /></div>
    </div>
  );
}

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ meta?: string; google?: string; msg?: string }> }) {
  const sp = await searchParams;
  const rows = await db.setting.findMany({ where: { key: { in: Object.keys(SETTING_KEYS) } } });
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const opts = Object.fromEntries(
    await Promise.all((Object.keys(OPTION_DEFAULTS) as OptionKey[]).map(async (k) => [k, await getOption(k)] as const)),
  ) as Record<OptionKey, string>;
  const [metaUser, googleEmail, googleToken] = await Promise.all([getSecret("meta_user_name"), getSecret("google_email"), getSecret("google_refresh_token")]);
  const provider = whatsappProvider();
  const days = opts.meeting_days.split(",").map((d) => d.trim());

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" />

      {(sp.meta || sp.google) && (
        <div className={`rounded-lg px-4 py-3 text-sm ${sp.meta === "ok" || sp.google === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {sp.meta === "ok" && "Conta do Facebook conectada. Agora vincule a página de cada cliente na tela da empresa."}
          {sp.google === "ok" && "Google Agenda conectado."}
          {(sp.meta === "erro" || sp.google === "erro") && `Falha ao conectar: ${sp.msg ?? ""}`}
          {(sp.meta === "cancelado" || sp.google === "cancelado") && "Conexão cancelada."}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Contas conectadas">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">📘 Facebook / Instagram</div>
                <div className="text-xs text-slate-500">
                  {metaUser ? `Conectado como ${metaUser}` : metaOAuthEnabled() ? "Publicação automática e métricas dos clientes" : "Configure META_APP_ID e META_APP_SECRET"}
                </div>
              </div>
              {metaOAuthEnabled() && (
                <div className="flex gap-2">
                  <a href="/api/meta/connect" className="btn-primary btn-sm">{metaUser ? "Reconectar" : "Conectar"}</a>
                  {metaUser && <form action={disconnectMeta}><SubmitButton className="btn-danger btn-sm">Sair</SubmitButton></form>}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">📅 Google Agenda</div>
                <div className="text-xs text-slate-500">
                  {googleToken ? `Conectado${googleEmail ? ` (${googleEmail})` : ""}` : googleOAuthEnabled() ? "Reuniões com link do Meet e horários livres reais" : "Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET"}
                </div>
              </div>
              {googleOAuthEnabled() && (
                <div className="flex gap-2">
                  <a href="/api/google/connect" className="btn-primary btn-sm">{googleToken ? "Reconectar" : "Conectar"}</a>
                  {googleToken && (
                    <form action="/api/google/disconnect" method="post"><button className="btn-danger btn-sm">Sair</button></form>
                  )}
                </div>
              )}
            </div>
          </div>
        </Section>

        <Section title="Integrações (variáveis de ambiente)">
          <div className="divide-y divide-slate-100">
            <Status ok={aiEnabled()} label={`IA — Claude (${CLAUDE_MODEL})`} />
            <Status ok={provider !== "none"} label={`WhatsApp — ${provider === "none" ? "modo simulação" : provider}`} />
            <Status ok={mercadoPagoEnabled()} label="Mercado Pago" hint="cobrança com baixa automática" />
            <Status ok={storageEnabled()} label="Cloudflare R2" hint="upload de fotos e vídeos" />
            <Status ok={mediaEnabled()} label="Imagens e vídeos com IA (fal.ai)" />
            <Status ok={Boolean(process.env.CRON_SECRET)} label="Rotina automática (CRON_SECRET)" />
          </div>
        </Section>
      </div>

      <Section title="URLs para configurar nos provedores">
        <div className="grid gap-4 md:grid-cols-2">
          <UrlRow label="Webhook do WhatsApp" url={appUrl(`/api/webhooks/whatsapp${process.env.WEBHOOK_SECRET ? "?secret=SEU_WEBHOOK_SECRET" : ""}`)} />
          <UrlRow label="Webhook do Mercado Pago (evento: Pagamentos)" url={appUrl("/api/webhooks/mercadopago")} />
          <UrlRow label="Redirect OAuth — app da Meta" url={appUrl("/api/meta/callback")} />
          <UrlRow label="Redirect OAuth — Google Cloud" url={appUrl("/api/google/callback")} />
          <UrlRow label="Rotina automática (a cada 5 min)" url={appUrl("/api/cron/tick?secret=SEU_CRON_SECRET")} />
        </div>
      </Section>

      <form action={saveSettings} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Agenda de reuniões">
            <div className="space-y-3">
              <Field label="Horário (início-fim)"><input name="meeting_hours" defaultValue={opts.meeting_hours} className="input" placeholder="09:00-18:00" /></Field>
              <Field label="Duração (minutos)"><input name="meeting_duration" type="number" min={15} step={15} defaultValue={opts.meeting_duration} className="input" /></Field>
              <Field label="Dias (0=dom … 6=sáb)">
                <input name="meeting_days" defaultValue={opts.meeting_days} className="input" />
              </Field>
              <p className="text-xs text-slate-500">Atual: {days.map((d) => DAYS[Number(d)]).filter(Boolean).join(", ")}</p>
            </div>
          </Section>
          <Section title="Cobrança">
            <div className="space-y-3">
              <Field label="Gerar e enviar mensalidade automaticamente">
                <select name="auto_charge" defaultValue={opts.auto_charge} className="input">
                  <option value="on">Sim (Mercado Pago)</option>
                  <option value="off">Não</option>
                </select>
              </Field>
              <Field label="Dias de antecedência do envio">
                <input name="invoice_reminder_days" type="number" min={1} max={15} defaultValue={opts.invoice_reminder_days} className="input" />
              </Field>
              <p className="text-xs text-slate-500">Usa a mensalidade e o dia de vencimento cadastrados em cada empresa.</p>
            </div>
          </Section>
          <Section title="Relatórios mensais">
            <Field label="No dia 1 de cada mês">
              <select name="reports_mode" defaultValue={opts.reports_mode} className="input">
                <option value="draft">Gerar rascunhos para eu revisar</option>
                <option value="send">Gerar e enviar sozinho</option>
                <option value="off">Não gerar</option>
              </select>
            </Field>
          </Section>
        </div>

        <Section title="Conhecimento da agência (usado pelos agentes de IA)">
          <div className="space-y-4">
            {(Object.keys(SETTING_KEYS) as SettingKey[]).map((key) => (
              <Field key={key} label={SETTING_KEYS[key]}>
                {key === "meeting_link" ? (
                  <input name={key} defaultValue={values[key] ?? ""} className="input" />
                ) : (
                  <textarea
                    name={key}
                    rows={key === "agency_profile" ? 10 : 4}
                    defaultValue={values[key] ?? ""}
                    className="input"
                    placeholder={
                      key === "agency_profile"
                        ? "Quem somos, nichos atendidos, serviços, planos (Essencial R$ 1.200: 8 posts...), prazos, formas de pagamento, diferenciais, cases, perguntas frequentes..."
                        : "Ex.: nunca envie contratos sem minha aprovação; posts sempre às 11h ou 18h; responda de forma resumida."
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </Section>
        <SubmitButton>Salvar configurações</SubmitButton>
      </form>
    </div>
  );
}
