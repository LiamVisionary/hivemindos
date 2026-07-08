import { completeTask } from './src/lib/services/kanban/local-kanban-store.ts';

const taskId = 't_mraoklch_rjknw';
const result = `Status: done — launch-asset link QA passed and the warm queue is cleared for immediate outreach from the actual pitch links. No customer-facing emails were sent in this QA run.

Cleared 4/4 exact warm pitch URLs with UTM parameters. For each pitch path, the offer page returned HTTP 200, linked demo returned HTTP 200, Cal booking URL returned HTTP 200, official package keys were present, and all three package checkout POSTs returned live Stripe Checkout URLs. OUTREACH_PHYSICAL_ADDRESS is set in the shared env. No revenue-blocking issues remain.

Deliverables:
https://liamvisionary.com/offer/sarasota-ginza-mr8rstmp
https://liamvisionary.com/offer/sarasota-abel-s-ice-cream-mr8rstmp
https://liamvisionary.com/offer/sarasota-aloha-hair-and-nail-spa-mr8rstmp
https://liamvisionary.com/offer/sarasota-allswell-mr8rstmp

Evidence:
- QA artifact: /Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mraoklch_rjknw-qa-warm-outreach-launch-assets/qa_warm_outreach_launch_assets.json
- Queen Bee receipt: /Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/Queen Bee/t_mraoklch_rjknw/qa_warm_outreach_launch_assets_receipt.json
- Runtime probe summary: 4/4 offer pages HTTP 200; 4/4 demos HTTP 200; 4/4 Cal booking links HTTP 200; 12/12 checkout POSTs HTTP 200 with Stripe Checkout URLs.

Outcome evidence tied to Weekly Revenue: $20,800 in offer pipeline cleared for outreach against the $2,885/week target; recognized revenue remains $0 until Stripe/webhook payment evidence.

Reusable learning: Revenue-blocking link QA should fail only unresolved offer/demo/booking URLs, missing official package options, or checkout paths that do not return Stripe Checkout. Missing UTMs on the Cal destination are attribution loss, not a revenue blocker, when the actual pitch URL carries UTMs and Cal resolves.

Governance: $0 spend, 0 customer emails sent, no price changes, no policy exception; checkout probes created QA sessions only.`;

const loopReceipts = [
  {
    id: 'lr_1o9h3jp',
    gateId: 'unit-df5c0f4a-4c12-4c5a-a923-0abb35c14e7a-crun_mraokj1b_720660a9-QA-warm-outreac-outcome',
    status: 'passed',
    summary: 'Cleared 4/4 actual warm pitch links, representing $20,800 potential pipeline; recognized Weekly Revenue remains $0 until Stripe/webhook payment evidence.',
    evidence: [
      '/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mraoklch_rjknw-qa-warm-outreach-launch-assets/qa_warm_outreach_launch_assets.json',
      'Probe summary: offer/demo/booking HTTP 200 for all 4 pitch links; 12/12 checkout POSTs returned Stripe Checkout URLs.'
    ]
  },
  {
    id: 'lr_tgkg',
    gateId: 'unit-df5c0f4a-4c12-4c5a-a923-0abb35c14e7a-crun_mraokj1b_720660a9-QA-warm-outreac-learning',
    status: 'passed',
    summary: 'Captured reusable QA rule: treat Cal destination UTM absence as attribution loss, not revenue-blocking, when the actual pitch URL has UTMs and booking resolves.',
    evidence: [
      '/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mraoklch_rjknw-qa-warm-outreach-launch-assets/RESULT.md',
      'Reusable learning section in QA artifact.'
    ]
  },
  {
    id: 'lr_1yvpm58',
    gateId: 'unit-df5c0f4a-4c12-4c5a-a923-0abb35c14e7a-crun_mraokj1b_720660a9-QA-warm-outreac-governance',
    status: 'passed',
    summary: 'No customer-facing outreach was sent by this QA run; $0 spend, no price changes, OUTREACH_PHYSICAL_ADDRESS set, no policy exception.',
    evidence: [
      'governance: spendUsd=0 customerEmailsSent=0 externalProspectActions=0 pricesChanged=false outreachPhysicalAddressSetInThisRuntime=true',
      '/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/Queen Bee/t_mraoklch_rjknw/qa_warm_outreach_launch_assets_receipt.json'
    ]
  }
];

const out = await completeTask('default', taskId, {
  summary: 'QA warm outreach launch assets passed: 4/4 actual pitch links and 12/12 checkout paths cleared; $20,800 pipeline cleared; no sends/spend.',
  result,
  loopReceipts,
  author: 'HermesMain'
}, {
  vaultPath: '/Users/liam/Documents/Obsidian/hivemindos-vault',
  kanbanFolder: 'Operations/Work Board'
});
console.log(JSON.stringify({ ok: true, taskId: out.task.id, status: out.task.status, completedAt: out.task.completedAt, deliverables: out.task.deliverables?.length ?? 0, loopReceipts: out.task.loopReceipts?.length ?? 0 }, null, 2));
