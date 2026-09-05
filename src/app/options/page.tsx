import OptionsTerminal from "@/components/options/OptionsTerminal";

export const dynamic = "force-dynamic";

export const metadata = { title: "Options Command Center — AlphaForge" };

export default function OptionsPage({ searchParams }: { searchParams: { s?: string; ticket?: string } }) {
  const symbol = /^[A-Z.]{1,6}$/.test(searchParams.s?.toUpperCase() ?? "") ? searchParams.s!.toUpperCase() : "NVDA";
  const ticket = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(searchParams.ticket?.toUpperCase() ?? "") ? searchParams.ticket!.toUpperCase() : null;
  return <OptionsTerminal initialSymbol={symbol} initialTicket={ticket} />;
}
