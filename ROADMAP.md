# HivemindOS Roadmap

Last updated: August 5, 2026.

HivemindOS gives you one place to run, watch, and guide your AI agents. You can connect agents across your computers, give them work, share memory between them, and stay in control when they want to post, spend, trade, or make another important change.

This roadmap focuses on what people will be able to do with HivemindOS. It leaves out most of the internal engineering work. The order reflects our current priorities, but release timing can move when an app review, safety test, or reliability issue takes longer than expected.

## Where things stand

- The new Socials workspace is working in development and is the next major product experience we want to finish.
- HivemindOS Mobile 1.0.2 has been submitted to Apple and is waiting for App Store approval.
- Agentic copy trading is running through paper testing. It has not proved consistent profitability and will not promote itself to live trading.
- Hivemind Content Studio is being brought together as one place to create images, video, animation, voice, music, and complete content workflows.
- The latest public desktop release is v0.4.5. A lot has been built since then, and the next big desktop milestone is V1.

## 1. Socials Command Center

Status: In progress

Socials will give you one place to plan and run social accounts with your agents.

### What you will be able to do

- Connect multiple social accounts without mixing their identity, voice, drafts, or posting history.
- Give each account its own websites, files, notes, and brand context.
- Let an agent draft a pack of posts based on that real context.
- Review, edit, approve, schedule, or discard every draft from one queue.
- See your week on a calendar and move scheduled posts around.
- Track published posts and account analytics.
- Find relevant conversations and draft replies or quote posts for review.
- Let an account automatically publish original posts when you want it to.

Manual review will stay the default. Automatic posting will be a clear choice for each account, with a visible cancellation window, posting hours, pause controls, and history. Replies and quote posts will still wait for individual approval.

### Before release

- Connecting and switching accounts must feel simple.
- Drafts and schedules must survive restarts and temporary connection problems.
- One account must never post as another account.
- Failed retries must never create duplicate posts.
- The workspace must work well on normal and narrow screens, in both light and dark mode.
- The app must clearly explain when an agent can post, what may cost money, and how to stop automation.

## 2. HivemindOS Mobile Public Release

Status: Submitted and waiting for App Store approval

HivemindOS Mobile puts your agents in your pocket. You can talk to them, call them, check your fleet, and connect back to the agents running on your Mac or server.

### What you will be able to do

- Chat with agents from your phone wherever you are.
- Pair the app with HivemindOS on your Mac and reach the same agents and shared memory.
- Use HivemindOS Cloud, connect another AI provider, use your own server, or run supported models on the phone.
- Call agents with voice and use Siri, Shortcuts, or the Action Button for quick actions.
- Check important fleet activity, approvals, wallets, companies, and Shared Brain information from mobile.
- Use free access, credits, or an Apple subscription for supported HivemindOS Cloud models.

### Before public launch

- Apple must approve the submitted build.
- The exact public build must pass real iPhone checks for chat, pairing, voice, privacy choices, purchases, and restoring purchases.
- A new user must be able to complete their first chat without developer help.
- Support and privacy pages must match what the shipped app actually does.
- We need a fast way to respond to review feedback and ship the first fixes after launch.

## 3. Agentic Copy Trading

Status: In development and paper testing

Agentic copy trading will let you follow a wallet while an AI agent researches each copied position, checks the risks, decides whether to keep or close it, and explains the decision.

### What you will be able to do

- Choose a wallet to follow and set clear limits before anything starts.
- Run the strategy with paper money first.
- Compare normal copy trading with a version reviewed by the agent while both follow the same source.
- See what the agent found about the token, liquidity, market, and wallet history.
- Read why the agent kept a position, closed it, or decided the evidence was unclear.
- See returns, costs, losses, the biggest drops in value, missed opportunities, and failed reviews without hiding the bad results.
- Stop the strategy, change its limits, or keep it in paper mode.

### Before wider release

- The version being tested must collect 200 completed paper outcomes, including a separate 50 trade test it has never seen before.
- The version reviewed by the agent must show a real advantage after costs, stay profitable on its own, and keep losses and failed reviews inside strict limits.
- The app must recover safely after restarts, bad market data, or an AI or market data service going down.
- Every position and decision must have a clear history that the user can inspect.
- Alerts, stop controls, and backups must be ready. The balances and completed trades shown in HivemindOS must also match the wallet before more people use real money.

Passing the paper test will only make the strategy eligible for another paper stage. Live trading will always require a separate user decision and a fresh safety review. There is no promise of future profit.

## 4. Hivemind Content Studio

Status: In progress

Hivemind Content Studio will give people and agents one place to create complete media projects. You can start with a prompt, an idea, or reference files and carry the work through to finished content without jumping between a pile of disconnected tools.

### What you will be able to do

- Generate images, videos, animation, voice, music, captions, and sound.
- Edit or extend existing images, audio, and video.
- Turn an idea into a script, scenes, visuals, motion, narration, music, captions, and final exports.
- Create short videos, ads, explainers, product content, social posts, and longer media workflows.
- Give the Studio reference images and files so it can follow a real product, character, style, or brand.
- Let HivemindOS choose an available model automatically or pick the model you want to use.
- Use local models, your own connected providers, or HivemindOS hosted credits where available.
- See what each generation may cost before approving paid work.
- Keep your projects, prompts, versions, and finished files together so an agent can continue the work later.

### Before release

- Creating, editing, animating, and building full workflows must feel like one product.
- Long running jobs must survive a closed tab, restart, or temporary provider problem.
- Paid generations must show the price and wait for the right approval.
- The Studio must clearly show which model created each result and where the file is saved.
- Finished media must pass basic checks for broken files, missing audio, blank frames, bad dimensions, and incomplete renders.
- Publishing must remain a separate, visible choice.

## 5. V1 Desktop App Release

Status: Preparing for release

V1 is the point where HivemindOS should feel dependable for someone installing it for the first time. The basic loop needs to work without hand holding: install the app, connect an agent, give it work, review what it wants to do, and understand what happened.

### What V1 should deliver

- A clear setup for one computer or a private group of connected computers.
- Reliable Chat, Work, approvals, alerts, schedules, and agent history.
- A Shared Brain where agents can remember useful context and hand work to each other.
- A simple way to connect hosted models, subscription access, your own API keys, and local models.
- App Builder projects that stay attached to the conversation and can be previewed, edited, exported, or deployed when you choose.
- Clear controls and receipts for wallets, payments, and other important actions.
- Updates that install safely and explain how to recover when something goes wrong.

### Before release

- Fresh installs and upgrades from the current public version must work on supported Mac, Windows, and Linux systems.
- Mac and Windows downloads must be properly signed and pass the platform's security checks.
- A new user must be able to install HivemindOS, connect an agent, send a chat, complete a task, save a memory, approve an action, and recover an interrupted session.
- Privacy, security, existing user data, and update checks must pass against the exact release build.
- The download page, setup guide, known limitations, support information, and rollback instructions must be current.

Socials, Trade, and Zero Human Companies may appear as beta features in V1 if they are ready. They will not hold back the stable core app just to make the feature list longer.

## 6. Marketing Season Begins

Status: Planned after V1

Once V1 is stable, we start showing HivemindOS properly. The product has reached the point where more people need to see what it can do, try it, and tell us where it still falls short.

### What this means

- Launch V1 with a clear story, a strong website, working downloads, and demos that show the real product.
- Publish useful walkthroughs for Socials, Mobile, Content Studio, Shared Brain, App Builder, trading, and agent run companies.
- Use Socials and Content Studio to produce a steady mix of posts, images, videos, demos, and release updates.
- Share real examples of agents completing work across different machines and tools.
- Make it easy for new users to install HivemindOS, understand the first useful thing to do, and get help when they are stuck.
- Work with creators, builders, open source contributors, and early users who can put the product through real use.
- Track downloads, successful setups, first completed tasks, returning users, and the problems that make people leave.
- Turn repeated feedback into product fixes, better onboarding, and clearer documentation.

Marketing will show what the product actually does. It will not rely on fake demos, hidden automation, profit promises, or spam.

## 7. Control HivemindOS From Anywhere

Status: In progress

The same request should follow the same rules whether it starts on desktop, mobile, X, or inside an agent tool.

- Ask for work from the surface that is most convenient at the moment.
- Turn an X request into a draft, research task, or trade plan without skipping its normal review steps.
- See the same plan, approval, limits, history, and receipt everywhere.
- Review blocked work, urgent alerts, and safe approvals from mobile.
- Stop an agent or revoke access without hunting through several settings pages.
- See who requested an action, why the agent took it, what changed, and how to undo it when possible.

## 8. Agent Run Companies

Status: In progress

Zero Human Companies will let someone set a goal, assign a group of agents, talk to the company lead, track the budget, and review the work the company produces.

### What we are building toward

- Plans where agents can work on different parts at the same time and bring the results back together.
- A permanent company lead you can chat with and redirect.
- Clear budgets, spending controls, tasks, issues, and requests for human attention.
- Deliverables that must be reviewed and accepted before they count as finished.
- A Frontier Lab where a company can test ideas without gaining permission to spend, deploy, publish, or sell anything.
- One history connecting the company's goals, decisions, work, revenue, spending, and results.

More autonomy will come after the stop controls, spending freeze, recovery, and audit history work reliably.

## Work that supports every release

Some work matters across the whole product even when it is not a headline feature.

- Make setup, updates, recovery, and troubleshooting easier.
- Keep HivemindOS private by default and useful on a single computer.
- Protect secrets and make permissions easy to understand and revoke.
- Keep research, paper actions, and real world actions clearly separated.
- Give users control over posts, deployments, spending, trades, and destructive actions.
- Make agent memory easier to review, correct, delete, and move between the agent tools people already use.
- Build a searchable history of what every agent did and why.
- Keep official prices, credits, subscriptions, and financial rules controlled by the official service instead of a setting that can be edited inside the app.

## Later

- Android release after the iOS launch settles into a clear support rhythm.
- Deeper agent work that can run fully on a phone without a server.
- Separate workspaces for different projects, clients, models, memories, wallets, and rules.
- Blind model comparisons so people can choose based on results instead of model names.
- Better recommendations for which model should handle each job.
- Easier self hosting and repair tools for people running HivemindOS on their own infrastructure.
