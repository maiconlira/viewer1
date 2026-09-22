import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1>Página não encontrada</h1>
      <Link href="/" className="link">Voltar ao painel</Link>
    </div>
  );
}
