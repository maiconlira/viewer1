import { db } from "@/lib/db";
import { Badge, Field, PageHeader, Section } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { saveSettings } from "../../actions";
import { SETTING_KEYS, type SettingKey } from "@/lib/settings";
import { appUrl } from "@/lib/utils";
import { aiEnabled, CLAUDE_MODEL } from "@/lib/claude";
import { whatsappProvider } from "@/lib/whatsapp";
import { mediaEnabled } from "@/lib/media";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span>{label}</span>
      <Badge className={ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{ok ? "Configurado" : "Pendente"}</Badge>
    </div>
  );
}

export default async function Configuracoes() {
  const rows = await db.setting.findMany();
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const provider = whatsappProvider();
  const webhook = appUrl(`/api/webhooks/whatsapp${process.env.WEBHOOK_SECRET ? "?secret=SEU_WEBHOOK_SECRET" : ""}`);
  const cron = appUrl("/api/cron/tick?secret=SEU_CRON_SECRET");

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Integrações (variáveis de ambiente)">
          <div className="divide-y divide-slate-100">
            <Status ok={aiEnabled()} label={`IA — Claude (${CLAUDE_MODEL})`} />
            <Status ok={provider !== "none"} label={`WhatsApp — ${provider === "none" ? "modo simulação" : provider}`} />
            <Status ok={mediaEnabled()} label="Geração de imagens e vídeos (fal.ai)" />
            <Status ok={Boolean(process.env.CRON_SECRET)} label="Rotina automática (CRON_SECRET)" />
            <Status ok={Boolean(process.env.APP_URL)} label="URL pública (APP_URL)" />
          </div>
          <p className="muted mt-3">As chaves ficam nas variáveis de ambiente do servidor (Railway → Variables). Veja o <code>.env.example</code>.</p>
        </Section>
        <Section title="URLs para configurar">
          <div className="space-y-4 text-sm">
            <div>
              <div className="label">Webhook do WhatsApp (Evolution: evento MESSAGES_UPSERT · Meta: callback URL)</div>
              <div className="flex items-center gap-2"><code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{webhook}</code><CopyButton text={webhook} /></div>
            </div>
            <div>
              <div className="label">Rotina automática — chamar a cada 5 minutos</div>
              <div className="flex items-center gap-2"><code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{cron}</code><CopyButton text={cron} /></div>
              <p className="muted mt-1">Ou rode o serviço worker (<code>npm run worker</code>), que faz isso sozinho.</p>
            </div>
          </div>
        </Section>
      </div>
      <Section title="Conhecimento da agência (usado pelos agentes de IA)">
        <form action={saveSettings} className="space-y-4">
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
                      : key === "director_notes"
                        ? "Ex.: nunca envie contratos sem minha aprovação; posts sempre às 11h ou 18h; responda de forma resumida."
                        : ""
                  }
                />
              )}
            </Field>
          ))}
          <SubmitButton>Salvar</SubmitButton>
        </form>
      </Section>
    </div>
  );
}
