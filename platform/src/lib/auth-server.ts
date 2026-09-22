// Verificação de sessão dentro de server actions. O middleware protege as páginas, mas uma server action
// pode ser chamada a partir de qualquer rota (inclusive as públicas), então cada ação do painel checa o login.
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

export async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) throw new Error("Não autorizado");
}
