"use server";
// Ações das páginas públicas do cliente (sem login): aprovar postagem, pedir alteração e assinar contrato.
// Cada uma só age sobre o registro identificado pelo token secreto do link.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { approvePost, requestPostChanges } from "@/lib/services";
import { str } from "@/lib/utils";

function req(form: FormData, key: string) {
  const v = str(form, key);
  if (!v) throw new Error(`Campo obrigatório: ${key}`);
  return v;
}

export async function publicApprove(token: string) {
  const post = await db.post.findUniqueOrThrow({ where: { approvalToken: token } });
  await approvePost(post.id, "CLIENTE (link)");
  revalidatePath(`/aprovar/${token}`);
}

export async function publicRequestChanges(token: string, form: FormData) {
  const post = await db.post.findUniqueOrThrow({ where: { approvalToken: token } });
  await requestPostChanges(post.id, req(form, "feedback"), "CLIENTE (link)");
  revalidatePath(`/aprovar/${token}`);
}

/** Assinatura pública pelo cliente (página /contrato/[token]). */
export async function signContract(token: string, form: FormData) {
  const name = req(form, "name");
  const doc = req(form, "document");
  if (form.get("agree") !== "on") throw new Error("É necessário aceitar os termos.");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const contract = await db.contract.findUniqueOrThrow({ where: { publicToken: token } });
  if (contract.status === "SIGNED") return;
  if (contract.status === "CANCELED" || contract.status === "EXPIRED") throw new Error("Contrato indisponível.");
  await db.contract.update({
    where: { id: contract.id },
    data: { status: "SIGNED", signedAt: new Date(), signedByName: name, signedByDoc: doc, signedIp: ip },
  });
  await db.company.updateMany({ where: { id: contract.companyId, status: "ONBOARDING" }, data: { status: "ACTIVE" } });
  await logActivity({
    type: "contract.signed",
    summary: `✍️ Contrato "${contract.title}" assinado por ${name}`,
    actor: "CLIENTE",
    companyId: contract.companyId,
  });
  revalidatePath(`/contrato/${token}`);
}
