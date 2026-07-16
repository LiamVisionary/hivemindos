import { completeTask } from './src/lib/services/kanban/local-kanban-store.ts';

const taskId = 't_mrl9a6z2_w75tt';
const artifact = '/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mrl9a6z2_w75tt-productized-website-offer/RESULT.md';
const jsonArtifact = '/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mrl9a6z2_w75tt-productized-website-offer/offer_ladder.json';
const receipt = '/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/Queen Bee/t_mrl9a6z2_w75tt/productized_website_offer_receipt.json';
const memoryPath = '/Users/liam/Documents/Obsidian/hivemindos-vault/Memory/Distillations/Agent Memory/learning/2026-07-14-website-outreach-agency-fixed-scope-offer-ladder-3f4c934e2c.md';

const result = `Status: done — productized Sarasota website offer and pricing ladder designed and recorded.

Defined fixed-scope packages:
- Rapid Launch Landing Page: $1,250 setup + $99/mo care, 48-hour turnaround, 100% upfront. Four sales/week reaches $5,000 setup revenue.
- Full Business Website: $3,500 setup + $199/mo care, 5-business-day turnaround, $1,750 deposit + $1,750 pre-launch or $3,250 paid-in-full. One full site plus two rapid launches/week reaches $6,000 setup revenue.
- Local Authority Website: $5,000 setup + $299/mo care, 7-business-day turnaround, $2,500 deposit + $2,500 pre-launch or $4,750 paid-in-full. One sale/week reaches $5,000 setup revenue.

Included deliverables, exclusions, turnaround times, payment terms, qualification/down-sell/up-sell/reject rules, checkout/fulfillment rules, recurring care ladder, and automated upsells: Booking Fix Pack, Review Engine Starter, Local SEO Expansion Page, Photo/Proof Upgrade, AI Lead Concierge, Rush Launch, and paid-in-full savings.

Evidence:
- Offer artifact: ${artifact}
- Structured JSON artifact: ${jsonArtifact}
- Queen Bee receipt: ${receipt}
- Shared Brain learning: ${memoryPath}

Outcome evidence tied to Weekly Revenue: the ladder has explicit paths to $5k/week: 4 x $1,250 Rapid Launch = $5,000; 1 x $5,000 Authority = $5,000; or 1 x $3,500 Full + 2 x $1,250 Rapid = $6,000. Recurring care compounding was modeled in the artifact.

Reusable learning: package around the weekly revenue target, not hourly effort; make care mandatory by default, bound revisions, and gate work on checkout/intake/domain access to preserve automation.

Governance: $0 spend, no customer emails, no public site changes, no checkout/product mutations, no paid tools, and no external customer-facing actions.`;

const loopReceipts = [
  {
    id: 'lr_offer_outcome_mrl9a6z2',
    gateId: 'company-df5c0f4a-4c12-4c5a-a923-0abb35c14e7a-mrl9a6hv-Design-a-productized-websi-outcome',
    status: 'passed',
    summary: 'Pricing ladder includes concrete $5k/week paths: 4 Rapid Launch sales, 1 Authority sale, or 1 Full + 2 Rapid sales.',
    evidence: [artifact, jsonArtifact, 'Revenue math: 4*1250=5000; 1*5000=5000; 3500+2*1250=6000.']
  },
  {
    id: 'lr_offer_learning_mrl9a6z2',
    gateId: 'company-df5c0f4a-4c12-4c5a-a923-0abb35c14e7a-mrl9a6hv-Design-a-productized-websi-learning',
    status: 'passed',
    summary: 'Captured reusable learning: productize around the weekly revenue target, mandatory recurring care, bounded revisions, and checkout/intake/domain gates.',
    evidence: [artifact, memoryPath]
  },
  {
    id: 'lr_offer_governance_mrl9a6z2',
    gateId: 'company-df5c0f4a-4c12-4c5a-a923-0abb35c14e7a-mrl9a6hv-Design-a-productized-websi-governance',
    status: 'passed',
    summary: 'Planning-only task stayed inside governance: $0 spend and 0 external customer-facing actions.',
    evidence: [receipt, 'governance: spendUsd=0 customerEmailsSent=0 paidToolsUsed=0 externalCustomerActions=0 policyException=false']
  }
];

const out = await completeTask('default', taskId, {
  summary: 'Productized website offer ladder completed: $1,250 Rapid Launch, $3,500 Full Website, $5,000 Authority Website, plus $99/$199/$299 monthly care and automated upsells.',
  result,
  loopReceipts,
  deliverables: [artifact, jsonArtifact, receipt, memoryPath],
  author: 'HermesMain'
}, {
  vaultPath: '/Users/liam/Documents/Obsidian/hivemindos-vault',
  kanbanFolder: 'Operations/Work Board'
});
console.log(JSON.stringify({ ok: true, taskId: out.task.id, status: out.task.status, completedAt: out.task.completedAt, deliverables: out.task.deliverables?.length ?? 0, loopReceipts: out.task.loopReceipts?.length ?? 0 }, null, 2));
