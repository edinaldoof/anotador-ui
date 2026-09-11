import { EscolhaDeAcesso } from "@/components/escolha-de-acesso";

export default function PaginaEntrar() {
  return (
    <main className="min-h-dvh">
      <section className="acesso">
        <p className="font-sans text-xs font-bold uppercase tracking-[0.13em] text-interactive">Acesso institucional</p>
        <EscolhaDeAcesso />
      </section>
    </main>
  );
}
