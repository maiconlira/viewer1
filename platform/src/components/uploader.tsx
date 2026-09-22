"use client";
// Envio de fotos/vídeos direto do navegador para o Cloudflare R2 (URL assinada), depois registra na postagem.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registerUpload } from "@/app/actions";

export function Uploader({ postId, companyId, folder }: { postId?: string; companyId?: string; folder: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const [i, file] of Array.from(files).entries()) {
        setStatus(`Enviando ${i + 1}/${files.length}: ${file.name}`);
        const res = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, size: file.size, folder }),
        });
        const data = (await res.json()) as { uploadUrl?: string; key?: string; error?: string };
        if (!res.ok || !data.uploadUrl || !data.key) throw new Error(data.error ?? "Falha ao preparar envio");
        const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error(`Falha no envio (${put.status}) — verifique o CORS do bucket R2`);
        await registerUpload({ postId, companyId, key: data.key, contentType: file.type });
      }
      setStatus(null);
      router.refresh();
    } catch (err) {
      setStatus(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={Boolean(status && !status.startsWith("Erro"))}
        onClick={() => input.current?.click()}
      >
        {status && !status.startsWith("Erro") ? status : "⬆️ Enviar fotos/vídeos"}
      </button>
      {status?.startsWith("Erro") && <p className="mt-1 text-xs text-rose-600">{status}</p>}
    </div>
  );
}
