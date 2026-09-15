"use client";

// Collapsible, resizable drawer under the chart: option chain,
// compare, calculator, paper positions.

import { ChevronDown, ChevronUp } from "lucide-react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import type { Broker } from "@/components/options/types";
import ChainTab from "@/components/options/tabs/ChainTab";
import CompareTab from "@/components/options/tabs/CompareTab";
import CalculatorTab from "@/components/options/tabs/CalculatorTab";
import BrokerTab from "@/components/options/tabs/BrokerTab";
import { Seg } from "@/components/ui/primitives";

export type DrawerTab = "chain" | "compare" | "calc" | "broker";

export default function BottomDrawer({
  analysis, broker, compareSet, setCompareSet, onTicket, refreshBroker, isOwner, tab, setTab, open, setOpen,
}: {
  analysis: OptionsAnalysis;
  broker: Broker | null;
  compareSet: string[];
  setCompareSet: (fn: (v: string[]) => string[]) => void;
  onTicket: (c: RankedContract) => void;
  refreshBroker: () => void;
  isOwner: boolean;
  tab: DrawerTab;
  setTab: (t: DrawerTab) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const compared = analysis.contracts.filter((c) => compareSet.includes(c.symbol));
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 px-2">
        <Seg
          value={tab}
          onChange={(t) => { setTab(t); if (!open) setOpen(true); }}
          options={[
            { key: "chain", label: `Option chain · ${analysis.contracts.length}` },
            { key: "compare", label: `Compare${compareSet.length ? ` · ${compareSet.length}` : ""}` },
            { key: "calc", label: "Calculator" },
            { key: "broker", label: `Paper${broker?.positions.length ? ` · ${broker.positions.length}` : ""}` },
          ]}
        />
        <button onClick={() => setOpen(!open)} className="btn-quiet ml-auto h-6 px-1" data-tip={open ? "Collapse (O)" : "Expand (O)"}>
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>
      {open && (
        <div className="min-h-0 flex-1">
          {tab === "chain" && <ChainTab analysis={analysis} compareSet={compareSet} setCompareSet={setCompareSet} onTicket={onTicket} canTicket={isOwner && !analysis.indexMode} />}
          {tab === "compare" && <CompareTab analysis={analysis} contracts={compared} />}
          {tab === "calc" && <CalculatorTab analysis={analysis} />}
          {tab === "broker" && <BrokerTab broker={broker} refresh={refreshBroker} isOwner={isOwner} />}
        </div>
      )}
    </div>
  );
}
