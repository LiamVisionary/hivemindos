"use client";

import * as React from "react";
import {
  UnifiedSkillBrowser,
  type UnifiedSkillBrowserCategory,
  type UnifiedSkillBrowserItem,
  type UnifiedSkillBrowserSource,
} from "@/features/dashboard/views/chat/UnifiedSkillBrowser";
import { Card, SectionHead, aeonStyles as styles, type IconName } from "./parts";

type AeonSkillBrowserSectionProps = {
  items: UnifiedSkillBrowserItem[];
  sources?: UnifiedSkillBrowserSource[];
  categories?: UnifiedSkillBrowserCategory[];
  eyebrow?: string;
  title: string;
  icon?: IconName;
  action?: React.ReactNode;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  loading?: boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  controlledSourceId?: string;
  onSourceChange?: (sourceId: string) => void;
  selectedItemId?: string | null;
  onSelectItem?: (item: UnifiedSkillBrowserItem) => void;
  renderActions?: (item: UnifiedSkillBrowserItem) => React.ReactNode;
  renderDetail?: (item: UnifiedSkillBrowserItem | undefined) => React.ReactNode;
};

export function AeonSkillBrowserSection({
  items,
  sources,
  categories,
  eyebrow = "Skills",
  title,
  icon = "sparkles",
  action,
  query,
  onQueryChange,
  searchPlaceholder = "Search skills",
  loading,
  loadingLabel,
  emptyTitle,
  emptyDescription,
  controlledSourceId,
  onSourceChange,
  selectedItemId,
  onSelectItem,
  renderActions,
  renderDetail,
}: AeonSkillBrowserSectionProps) {
  return (
    <div className={styles.root}>
      <Card>
        <SectionHead eyebrow={eyebrow} title={title} icon={icon} action={action} />
        <UnifiedSkillBrowser
          items={items}
          sources={sources}
          categories={categories}
          query={query}
          onQueryChange={onQueryChange}
          searchPlaceholder={searchPlaceholder}
          loading={loading}
          loadingLabel={loadingLabel}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          controlledSourceId={controlledSourceId}
          onSourceChange={onSourceChange}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          renderActions={renderActions}
          renderDetail={renderDetail}
        />
      </Card>
    </div>
  );
}

export type { UnifiedSkillBrowserCategory, UnifiedSkillBrowserItem, UnifiedSkillBrowserSource };
