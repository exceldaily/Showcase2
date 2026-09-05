import OptionsTerminal from "@/components/options/OptionsTerminal";

export const dynamic = "force-dynamic";

export const metadata = { title: "Options Command Center — AlphaForge" };

export default function OptionsPage({ searchParams }: { searchParams: { s?: string } }) {
  const symbol = /^[A-Z.]{1,6}$/.test(searchParams.s?.toUpperCase() ?? "") ? searchParams.s!.toUpperCase() : "NVDA";
  return <OptionsTerminal initialSymbol={symbol} />;
}
