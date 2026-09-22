import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: process.env.AGENCY_NAME ? `${process.env.AGENCY_NAME} · Agência OS` : "Agência OS",
  description: "Plataforma operacional da agência: clientes, conteúdo, aprovações, contratos, prospecção e funcionários de IA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
