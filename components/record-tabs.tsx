"use client";

import { Tabs } from "@base-ui/react/tabs";

export type RecordTab = {
  value: string;
  label: string;
  count?: number;
  content: React.ReactNode;
};

// Subtab bar under a record's field groups, like NetSuite's Sales / Support /
// Address tabs. Panels stay mounted so a half-filled form survives a switch.
export function RecordTabs({ tabs, defaultTab }: { tabs: RecordTab[]; defaultTab: string }) {
  return (
    <Tabs.Root defaultValue={defaultTab} className="mt-8">
      <Tabs.List className="flex overflow-x-auto rounded-t-lg bg-tabbar px-2">
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className="relative flex shrink-0 items-center gap-1.5 px-4 py-3 text-[0.95rem] font-medium whitespace-nowrap text-white/80 outline-none transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset data-active:font-semibold data-active:text-white data-active:after:bg-brand-green"
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-white/15 px-1.5 text-[0.75rem] font-semibold tabular-nums">
                {tab.count}
              </span>
            )}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Panel
          key={tab.value}
          value={tab.value}
          keepMounted
          className="rounded-b-lg border border-t-0 bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
        >
          {tab.content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
