# Managing a computer from the phone or the web: the screens

For whoever builds this on the phone (React Native) and on hivemindos.app/chat (React, glass). Both draw
from the same view models in `core/computer-manager.ts` (desktop canonical `src/shared/hive/core`, phone
`shared/hive/core`, website `src/shared/hive/core`). If both builders follow this page, a person moving between
their phone and their browser meets the same sections, the same rows, the same buttons and the same words.

## 0. Rules for both builders

1. **No wording in app code.** Every title, row line, status, button label, confirm question, notice and
   error comes from the view models or `MANAGE_COPY`. The only words an app may add are plain chrome:
   "Manage", "Refresh", "Cancel", "Done", "Back", "Send", "Try again", "Ask again", "Sign in". If a screen needs a
   new sentence, add it to `computer-manager.ts` (and its test), then sync.
2. **One loop per call.** Collect what `callDevice` yields, catch what it throws, then:
   ```ts
   const table = { scopes: DEVICE_ACCESS_SCOPES, actions: DEVICE_ACTIONS, messages: DEVICE_CALL_MESSAGES };
   let access = computerAccess(grant.scopes, table, grant.desktop.name);   // once per grant
   const outcome = readManageAnswer(access, chunks, error);                 // every call
   access = narrowAccess(access, outcome, action);                          // every call
   const view = automationsView(access, outcome, clock);                    // per section
   ```
   `narrowAccess` matters: a "not allowed" lowers that one scope (its buttons turn off with the computer's
   reason); a removal or ending locks everything and shows the lost state.
3. **Loading.** Load a section when it first comes on screen, never all eight at once: at most
   `MANAGE_PARALLEL_LOADS` (3) calls in flight per computer. The computer refuses a device's fifth call at once
   as busy. Keep the last good view while refreshing. Show a placeholder only when there is no view yet
   (`view.loading`).
4. **Refresh.** While a section is on screen and the app is in front, ask again every
   `MANAGE_REFRESH_MS[id]` (null: only on open and pull). Phone: pull to refresh. Web: a Refresh button in the
   section header. Stop timers when the screen is hidden.
5. **Buttons** are `ManageButton`s. Draw every button the view gives, in its order.
   - `enabled: false` with a `reason`: draw it visibly off. Phone: a tap shows the reason in a short line
     under the row (or a small toast). Web: the reason is the tooltip and, on click, a line under the row.
   - `enabled: false` with no reason: it is held while another call on that row runs. Draw it off.
   - `busy`: keep the label, add a small spinner, block taps.
   - `confirm`: ask first (section 4), call only after the confirm button.
   - After a row action answers, show the matching done notice (`automationDoneText`, `serviceDoneText`)
     for about 3 s under the row, then reload that section.
6. **Notices** (`ManageNotice`) sit inline at the top of the section they belong to, never as a toast. One
   button, from `next`: `retry` "Try again", `open-computer` "Try again", `sign-in` "Sign in", `relink` "Ask
   again" (starts `requestDeviceAccess` again), `wait` (no button; try again after 30 s), `settings`,
   `check-wallet` and `none` (no button; the words already say what to do).
7. **Tones.** `info` muted text, `good` success color, `warn` honey, `error` danger. A small dot or icon
   before the text is fine. Never a left accent bar, never sparkles or emoji.
8. **Time.** Pass `{ now: Date.now(), hour12 }`, where `hour12` follows the device's own 12/24-hour setting.
   Leave `utcOffsetMinutes` out (the device's own zone).
9. **Never show** model servers, app plumbing or ids: `host`, `providerLabel`, `sourceId`, `selection`,
   `confirmationId`, `uploadId`, `runId` and keys are for calls, not for people.

## 1. Where it lives

- **Phone:** from a computer's own screen (the place its apps are listed today), a "Manage" row opens the
  manager: one stack screen (the overview) and one screen per section. Sheets for forms and confirms.
- **Web:** hivemindos.app/chat, from the account menu: "Your computers", then a computer, then the manager.
  At 900 px and wider: the sections list on the left (260 px), the open section on the right. Narrower: the
  same stack as the phone.
- Only computers with a grant on this device appear. One computer at a time.

## 2. The overview

- **Header:** `access.desktopName` as the title. Under it, whether that computer is online (from
  `listDesktops`): `MANAGE_COPY.online` with a success dot, or the `no-device` message from `DEVICE_CALL_MESSAGES`.
- **Lost access** (`access.lost` set): the whole screen is one empty state: `MANAGE_COPY.lostTitle`, then
  `access.lost.text`, then one button for `access.lost.next` ("Ask again"). No sections.
- **Sections** (`access.sections`, in that order): one row each.
  - Title: `section.title`.
  - Second line: the section view's `summary` once loaded, else `section.line`.
  - When `section.canChange` is false: a small muted pill with `section.levelLabel` ("See").
  - A warn dot when the section's view has a `notice` with tone warn or error, or Copy trading has
    `attention` items.
- **Locked line:** `access.lockedLine` under the list, small and muted, no icon. Omit when empty.
- Phone: inset grouped list on `surface`, hairline dividers, 14 pt row padding, 44 pt touch targets.
  Web: the same rows in the left column; the selected row gets a `surfaceAlt` fill, no border.

## 3. The sections

Every section screen: title (`section.title`), `section.line` muted under it, then the `notice` if any,
then the content below, then `view.empty` as a centered muted line when the list is empty.

### 3.1 AI models (`models.list`; also `media.list` when Pictures and video is allowed)

- `modelsView(access, { text, media })`. Pass `media` only when `manageMay(access, 'media.list')`.
- One group per `view.groups` item, headed by `group.title` ("Chat models", "Picture models", "Video
  models"). Each row: `name` (primary), `where` and `note` (muted, under it), `stateText` on the right with
  a dot (success for running and ready, muted for idle, honey for not ready, none for off).
- Chat models have `row.chat`: a compact "Chat" button. It opens the app's own chat with that model; the
  turn goes through `models.chat` with `modelChatArgs(...)`, and the reply streams through
  `modelChatStep`. When `modelChatArgs` reports `dropped > 0`, show `MANAGE_COPY.modelChatDropped` once,
  muted, above the reply. When the call's loop ends, every time, pass the state (and the error it threw, if
  any) through `manageStreamEnded(access, state, error)`: a reply cut off part way keeps what arrived and ends
  in plain words instead of sitting at "answering".

### 3.2 Pictures and video (`media.list`, `media.generate`, `media.status`)

- **Form** (`mediaForm(access, outcome)`): a segmented control from `form.kinds` (Picture | Video). Under a
  kind that is not `ready`, show its `note` and disable Make.
  - Model picker (a row that opens a list): `form.models[kind]`; Automatic first. Each choice: `label`,
    `where` muted, `note` when not ready (drawn off).
  - Prompt: multiline field, placeholder `MANAGE_COPY.mediaPrompt[kind]` (the same words
    `checkMediaRequest` uses when it is empty).
  - Start pictures: an `MANAGE_COPY.addPicture` control only when `form.maxPictures[kind] > 0`, up to that many,
    PNG, JPEG or WebP, sent as data URLs. One sealed call carries under 96 KB in all, so every picture is
    scaled down before it is added: `mediaPictureRoom(form, request, count)` is the longest data URL each
    of `count` pictures may be. Re-encode as JPEG (quality 0.7) at 768 px on the long side, then 512, 384,
    256, until the data URL fits. With four pictures for a video expect about 256 px each. If even 256 px
    does not fit, show `MANAGE_COPY.pictureTooBig` and do not add it.
  - Make button: `form.make`. On tap: `checkMediaRequest(form, { kind, prompt, modelKey, pictures, runId })`
    with `runId = manageId(random, 'run_')`. A `{ ok: false, field, message }` puts the message under that
    field. Otherwise save a `MediaRun` locally, then call `media.generate` with `args`.
- **Runs** (`mediaRecentView(access, runs, clock)`), newest first, under the form. The device keeps its own
  runs (the computer does not list past ones to other devices): phone in its app storage, web in
  `host.store`. Each row: `title`, `when` muted, `line`, and while `pollMs` is set call `media.status
  { runId }` after that long and store the outcome on the run.
- **Ready results:** each `result` is a thumbnail placeholder until fetched: call `media.status` with
  `result.fetchArgs`, feed every chunk to `mediaFileStep`, show `mediaFileLine(progress)` over the
  placeholder (and end the loop with `manageStreamEnded(access, progress, error)`, as for a model reply), and
  when `progress.done`, build the file from `progress.parts.join('')` (base64) and
  `progress.mimeType`. Phone: write it to the cache and offer Save to Photos and Share. Web: a blob URL with
  Download.

### 3.3 Chats (`chats.list`, `chats.read`, `chats.continue`)

- `chatsView(access, outcome, clock)`. Rows like a messages list: `title` (one line), `agent` and `when` on
  the second line, `preview` muted (two lines at most). When `running`, a small "Working…" (`stateText`)
  instead of `when`.
- Tap a row (`row.open`): the chat screen. `chats.read { sessionId }` first, then `{ sessionId, sinceSeq:
  page.maxSeq }` every 3 s while `page.running`, else every 20 s; feed each answer to
  `chatPageStep(access, page, outcome)`. Draw `items` in order: user messages right, assistant messages as
  plain text, tool steps as one muted line (`step`, then `text`) with a dot for `stepState`. When
  `page.waiting` has lines, show each as an info line above the composer: this device cannot answer those;
  the person answers on the computer.
- **Reply** (`row.reply`): a composer at the bottom, only when enabled; otherwise its reason sits there
  instead, muted. A mode choice beside Send, from `CHAT_MODES` (`label`, with `line` under each choice),
  "Ask first" by default. Send calls `chats.continue` with `chatContinueArgs(...)`; then read again at once.
- **Who started it.** Every listed row carries `origin` (`"person"`, `"phone"` or `"automation"`), plus
  `originKind` (`queen-bee`, `work-board`, `company`, `swarm`, `capability`, `script`, `subagent`, `cron`,
  `import`) and `groupId` (one fan-out of the same prompt to several agents) when known. `chats.list
  { origin: ["person", "phone"] }` leaves automations out on the computer; without `origin` every chat is
  listed, as before. A desktop from before this sends no `origin`: treat a missing one as a person's.
- **The computer's app chats** (Claude Code, Codex, Hermes), read only: `chats.list { source: "apps",
  runtime?, limit?, cursor?, origin? }` and `chats.read { source: "apps", runtime, sessionId, sinceSeq?,
  before?, limit? }`. The answer carries `source: "apps"`; one without it came from a desktop that predates
  this and listed its own chats instead. Rows carry `origin` (`"person"` or `"automation"`) and `originKind`.
  A refusal with code `chat-history-not-shared:ask` or `chat-history-not-shared:deny` is the computer's chat
  history setting. Continuing an app chat this way answers `not-available` for now.

### 3.4 Files (HiveDrop to the computer: `files.send`)

- `hiveDropView(access, sends)`. A drop area (web: drag and drop plus a picker; phone: Photos, Files and
  paste) labelled `MANAGE_COPY.fileDrop` (phone: a "Send files" button, `view.send.label`), with
  `view.destination` under it ("Downloads on Studio Mac"). `view.send` gates it.
- Per file: `hiveDropStart(file, manageId(random, 'upload_'))`. A failure shows its message in the queue
  without sending. Send one file at a time and one piece at a time: `hiveDropNext(send)` says which bytes to
  read, base64 them, call `files.send` with `hiveDropArgs(send, data)`, then `hiveDropStep(send, outcome)`;
  repeat until `hiveDropNext` returns null. The step retries a lost answer and resumes where the computer
  says, so the loop needs no logic of its own.
- Rows: `name`, `size` muted, a thin progress bar from `percent`, `line` under it (success when done, danger
  when failed). Summary line above the queue: `view.line`.

### 3.5 Automations (`automations.list`, `.run`, `.pause`, `.resume`, `.delete`)

- `automationsView(access, outcome, clock, pending)`, where `pending` maps a row id to the action whose
  call is running.
- Row: `name` (primary); second line `next` (with `stateText` when it is not "On" and differs from
  `next`); third line, muted: `last`, and `agent` and `where` when present. A `failed` row gets the warn
  dot. The buttons sit in a row under it on the phone (compact, secondary style), and on the right on the
  web.
- Tap the row: a detail sheet from `automations.list { id }` through `automationDetailView`: `schedule`,
  `next`, the `prompt` as plain text, and the recent `runs` (`line`, `summary` muted).
- Remove asks first (section 4), with the row's own `confirm.body`: for a job an agent runs on its own timer
  and that cannot be paused from here, it says removing may not stop it. After any action:
  `automationDoneText(...)`, then reload.
- Making a new automation is not offered from other devices yet (see section 6).

### 3.6 Copy trading (`copytrader.status`, `.pause`, `.resume`)

- `copytraderView(access, outcome, clock, pending)`.
- When `view.elsewhere`: one info notice with it at the top; every button is off with that reason.
- Top: `view.headline` as a short line. Then, when `view.attention` is not empty, a group headed
  `MANAGE_COPY.copyAttentionTitle`: each item `label` and `text`.
- Rows (already sorted, attention first): `label` (primary) and a mode pill `modeText` (Live: neutral fill;
  Paper: outline) with `modeLine` as its accessible description; second line `stateText` · `network` ·
  `target`; third line `results` in `resultsTone` color and `activity` muted. When `attention`: show it
  under the row, then `detail` muted and smaller (the computer's own words).
- One button per row: Pause or Resume. Resuming a Live copy asks first (section 4).

### 3.7 Background apps (`services.list`, `.start`, `.stop`, `.restart`)

- `servicesView(access, outcome, pending)`. Rows: `name` and `version` muted; `stateText` on the right with
  a dot (success when running); buttons Restart and Stop when running, Start when stopped. `note` (the
  computer's own detail) only in an expanded row (tap to expand), muted.
- `view.more` as a muted line under the list. Installing is done on the computer.
- After an action answers: `servicesAfter(list, outcome)` to update the row at once, then
  `serviceDoneText(...)`.

### 3.8 Wallets (`wallets.balances`, `wallets.send`)

- `walletsView(access, outcome)`. Top: `view.totalLine` large. Rows: `name`, `network` pill, `shortAddress`
  muted (tap to copy the full `address`), `total` on the right, then up to five `assets` (`symbol`,
  `amount`, `value`). `note` muted when set. Each row has `row.send`.
- **Send sheet** (from `row.send`):
  1. Form: From (the wallet, fixed), To (address field with paste), Amount with a "$ | asset" switch (the
     asset choices are the row's `assets`; pass the chosen one's `symbol` as `asset` and its `tokenAddress`,
     so two tokens with one symbol are never mixed up). Check with
     `checkWalletSend(access, balances, input)`; a failure puts its message under `field`. "$" and "," are
     read only as dollar writing ("$1,000"); "1,5" is asked about, never guessed.
  2. Review: `review.title` large, `review.lines` as label and value rows (the To line shows the whole
     address, never shortened), `review.footnote` muted. Primary button "Send" (chrome word), Cancel.
  3. Status: `state = walletSendStart(Date.now())`, call `wallets.send` with `args`, then
     `walletSendAsked(state, outcome)`. While `walletSendView(...).pollMs` is set, call `wallets.send`
     with `walletSendCheckArgs(state)` after that long and apply `walletSendChecked(state, outcome,
     Date.now())`. Draw `title`, `line`, and `timeLeft` while waiting. The sheet cannot cancel a send: the
     line already says to tap No on the computer.
  4. When `final`: one button. `next` "retry": "Try again" (back to the form). `check-wallet` and `none`:
     "Done" (and reload balances). "unknown" means it may have gone out: never offer to send it again from
     here.
- Keep a waiting send alive while the sheet is closed (it lives with the section, not the sheet); reopening
  shows it.

## 4. Confirm sheets and dialogs

A `ManageConfirm` is drawn the same everywhere: `title` as the heading, `body` under it, two buttons:
Cancel (secondary) and `confirm` (primary; the danger color when `danger` is true). Phone: a bottom sheet
sized to its content. Web: a centered dialog on `.glass` (`dom/tokens.module.css`), focus starts on Cancel,
Escape cancels.

## 5. Look and feel

- Phone: the app's palette (`constants/palette.ts`), cards only where the design guidelines allow, hairline
  dividers, accent at most once per screen. Sheets via the app's sheet presence hook.
- Web: section content on the solid surface tokens (`--hive-surface`, `--hive-surface-2`). Floating things
  (dialogs, popovers, the send sheet, tooltips) use the liquid glass class. Light and dark from the host
  theme. Respect `reducedMotion`.
- Numbers right-aligned with tabular figures. Money is already formatted; never format it again.

## 6. Not offered from other devices yet (draw nothing for these)

- Making an automation: the computer offers `automations.create`, but no device action lists the agents
  to pick from.
- Swapping, installing an app, changing a copy's settings, the terminal: the computer answers these as not
  available yet.
- Answering a chat's waiting question: only on the computer for now (`page.waiting` says so).
- Brain search: it has its own sealed path, not this manager.

## 7. What both builders check before calling it done

- The same fixtures as `tests/computer-manager.test.ts` drawn on screen, light and dark, phone width and
  1280 px wide, with: everything allowed, "Standard" (buttons off with reasons), "Look only" (locked line),
  and a removed device (lost state).
- A send walked through every phase, including "unknown" (the confirmation answered on the computer and then
  gone).
- A 150 KB file sent with one answer lost on the way: it still arrives once. When the lost answer is the last
  piece's, the row says to check Downloads (`MANAGE_COPY.fileUnconfirmed`) and nothing is sent again.
- A busy computer: open the overview with all sections allowed and confirm no "busy" notice appears.
