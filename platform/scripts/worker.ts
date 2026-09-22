// Worker opcional: roda a rotina automática a cada N minutos sem precisar de cron externo.
// Uso: npm run worker   (ou como serviço separado no Railway com o mesmo código e variáveis)
const url = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/cron/tick?secret=${encodeURIComponent(process.env.CRON_SECRET || "")}`;
const minutes = Number(process.env.WORKER_INTERVAL_MINUTES || 5);

async function run() {
  try {
    const res = await fetch(url, { method: "POST" });
    console.log(new Date().toISOString(), res.status, await res.text());
  } catch (err) {
    console.error(new Date().toISOString(), "falha no tick", err);
  }
}

run();
setInterval(run, minutes * 60_000);
