import type { Company } from "@prisma/client";

/** Filtro por empresa via querystring (GET). */
export function CompanyFilter({ companies, current, extra }: { companies: Pick<Company, "id" | "name">[]; current?: string; extra?: Record<string, string> }) {
  return (
    <form className="flex gap-2">
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select name="companyId" defaultValue={current ?? ""} className="input w-56">
        <option value="">Todas as empresas</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button className="btn-secondary">Filtrar</button>
    </form>
  );
}
