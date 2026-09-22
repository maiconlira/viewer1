import { AGENCY_NAME } from "@/lib/utils";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form action="/api/auth/login" method="post" className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="mb-1">{AGENCY_NAME}</h1>
        <p className="muted mb-6">Acesso do administrador</p>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="label" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" className="input mb-4" autoFocus required />
        {sp.error && <p className="mb-4 text-sm text-rose-600">Senha incorreta.</p>}
        <button className="btn-primary w-full">Entrar</button>
      </form>
    </div>
  );
}
