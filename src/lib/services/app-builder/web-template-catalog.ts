export type AppTemplateGroupId = "websites" | "apps" | "dashboards" | "automations";
export type WebTemplateId = "scroll-world";

export type AppTemplateGroup = {
  id: AppTemplateGroupId;
  name: string;
  description: string;
  readyCount: number;
};

export type WebTemplateCatalogEntry = {
  id: WebTemplateId;
  name: string;
  description: string;
  sourceRepository: string;
  sourceCommit: string;
  license: "MIT";
  auditLabel: string;
  files: ReadonlyArray<{ path: string; source: string }>;
};

export const APP_TEMPLATE_GROUPS: readonly AppTemplateGroup[] = [
  {
    id: "websites",
    name: "Websites",
    description: "Landing pages, portfolios, and interactive web experiences.",
    readyCount: 1,
  },
  {
    id: "apps",
    name: "Products & apps",
    description: "Starter kits for focused product and application experiences.",
    readyCount: 0,
  },
  {
    id: "dashboards",
    name: "Dashboards",
    description: "Operational views, reports, and data-rich control surfaces.",
    readyCount: 0,
  },
  {
    id: "automations",
    name: "Automations",
    description: "Repeatable workflows with a clear human review point.",
    readyCount: 0,
  },
];

const SCROLL_WORLD_ASSET_ROOT = "/app-builder-templates/scroll-world";

export const WEB_TEMPLATE_CATALOG: readonly WebTemplateCatalogEntry[] = [
  {
    id: "scroll-world",
    name: "Scroll World",
    description: "An immersive landing page that turns scrolling into a continuous flight through a connected visual world.",
    sourceRepository: "https://github.com/oso95/scroll-world",
    sourceCommit: "2912048246d057cdfe134dfc0b4dfb7e6a12f30e",
    license: "MIT",
    auditLabel: "Audited browser-only starter",
    files: [
      { path: "index.html", source: `${SCROLL_WORLD_ASSET_ROOT}/index.html` },
      { path: "styles.css", source: `${SCROLL_WORLD_ASSET_ROOT}/styles.css` },
      { path: "script.js", source: `${SCROLL_WORLD_ASSET_ROOT}/script.js` },
      { path: "scrub-engine.js", source: `${SCROLL_WORLD_ASSET_ROOT}/scrub-engine.js` },
      { path: "TEMPLATE.md", source: `${SCROLL_WORLD_ASSET_ROOT}/TEMPLATE.md` },
      { path: "LICENSE", source: `${SCROLL_WORLD_ASSET_ROOT}/LICENSE.txt` },
      { path: "assets/arrival.svg", source: `${SCROLL_WORLD_ASSET_ROOT}/assets/arrival.svg` },
      { path: "assets/workshop.svg", source: `${SCROLL_WORLD_ASSET_ROOT}/assets/workshop.svg` },
      { path: "assets/finale.svg", source: `${SCROLL_WORLD_ASSET_ROOT}/assets/finale.svg` },
    ],
  },
];

export function webTemplateById(value: unknown) {
  return WEB_TEMPLATE_CATALOG.find((template) => template.id === value);
}
