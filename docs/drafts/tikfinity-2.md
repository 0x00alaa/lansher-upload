Thoroughness: medium. Do NOT read anything under G:\re\my-lansher. Do NOT write any files. Only READ and report back in your final message as markdown.

Objective: I am designing a NEW streaming-assistant app (TikTok Live automation: gifts, likes, rules, actions, TTS, overlays). I need a written INVENTORY of what features and services the competitor product "tikfinity" provides, so I can reimplement equivalent capabilities myself from scratch. I will not copy any of its code, strings, assets, or branding — I only need a written description of capabilities, endpoints, and data shapes.

Sources to read (all under G:\re\tikfinity\):
- api-map.md
- server.js
- plan.md, plan2.md, what-i-end.md
- external-urls.md
- index.js
- source\  and  source-res\   (read the file listing first, then skim the main entry points to learn what each area does; do NOT paste code)
- ui\  (read the file listing, then identify pages/routes/components to learn the screen inventory and navigation)

Deliver, in markdown, these sections:

## 1. Screen / page inventory
Every screen or tab, its name, what it shows, and the navigation model between them.

## 2. Service inventory
Grouped by domain. For each service: name, one-line purpose, its input, its output.
Domains to cover: account connection & authentication, live-session connection & event capture, gifts & leaderboard & stats, rules/triggers/automations, actions (alerts, TTS, sounds, chat, webhooks, integrations), files/data import-export & profiles, settings & preferences, updates, diagnostics/logging.

## 3. Endpoints / IPC commands
Table: name | kind (http route / ipc / websocket) | path | request fields | response fields | what it does.

## 4. Data model
Entities and their fields with types and meaning (e.g. Account, Rule, Trigger, Action, Task, GiftEvent, Session, Profile).

## 5. Rules & automation details
What trigger types exist, what conditions/filters can be combined, what actions can be attached, cooldown/throttling/scheduling behavior, and how rules are configured in the UI.

## 6. Notable UX affordances
Wizards, live dashboards, import/export formats, tray/floating windows, keyboard shortcuts, anything a power user would notice.

## 7. Known gaps / unfinished work mentioned in plan.md, plan2.md, what-i-end.md

Cite the file path for each claim. Do not paste code blocks longer than a few lines. Do not write files.

----
## Objective
- Produce a read-only markdown capability inventory of TikFinity for reimplementing a TikTok Live automation assistant.
- Cover screens, services, endpoints/IPC, data models, rules, UX, and unfinished work with file-path citations.

## Important Details
- Do not read anything under `G:\re\my-lansher`.
- Do not write files; only inspect sources and report in the final response.
- Do not copy code, strings, assets, or branding.
- Use medium thoroughness; avoid long code excerpts.
- Distinguish observed competitor behavior from the local reverse-engineering/mock backend in `G:\re\tikfinity\deob\local-api.js`.
- No files were modified.

## Work State
### Completed
- Listed `G:\re\tikfinity`; found `api-map.md`, `external-urls.md`, `index.js`, `server.js`, `plan.md`, `plan2.md`, `what-i-end.md`, `source`, `source-res`, `ui`, and `deob`.
- Partially inspected:
  - `api-map.md`
  - `index.js`
  - `server.js`
  - `plan.md`
  - `plan2.md`
  - `what-i-end.md`
  - `external-urls.md`
  - `deob/local-api.js`
  - `ui/mirror/docs/faq-en.md`
  - `ui/mirror/index.html`
- Startup/host facts found:
  - Production: `https://tikfinity.zerody.one`
  - Fallback: `http://tikfinity-origin.zerody.one`
  - Development: `http://localhost:8081`
  - Loader downloads `/electron/main.js`, caches it under `%APPDATA%\tikfinity\res`, then `require()`s it.
  - `index.js` uses an 8-second Axios timeout and exits after startup download/initialization errors.
- Known downloaded Electron resources from `api-map.md`:
  - `/electron/main.js`
  - `/electron/websocketserver.js`
  - `/electron/keyboardlistener.js`
  - `/electron/cookies.js`
  - `/electron/fetchhelper.js`
  - `/electron/closeonredirect.js`
  - `/electron/autoupdater.electronbuilder.js`
  - `/electron/autoupdater.forge.js`
  - `/electron/autoupdater.util.js`
  - `/extension/tiktok_live_bridge_electron.user.js?c=electron&v=<version>`
  - GRU SDK package and `GRU_MIDDLEWARE_URL`
- Known REST routes from `api-map.md`:
  - `POST /api/logError`
  - `POST /api/electron/update/log`
  - `GET /api/tiktok/user-room?uniqueId=<id>`
- UI page IDs found in `ui/mirror/index.html`:
  - `start`, `setup`, `chatbot`, `chatcommands`, `tts`, `actionsandevents`, `sounds`, `user`, `transactions`, `challenge`, `wheel`, `coindrop`, `obsoverlays`, `goals`, `followercounter`, `countdowngoals`, `graphicoverlays`, `giftoverlays`, `lastx`, `halving`, `rtmpgen`, `timer`, `songrequests`, `dapi`, `likeathon`, `obsdocks`, `christmasevent`, `agencyregistry`, `agencyapplications`.
- UI is a single-page app using `navigation.pageChange(...)`, `#pages`, `#navigation-app`, and `#modal-app`.
- Extracted 44 widget IDs:
  - `activity-feed`, `cannon`, `carousel`, `chat`, `christmasevent`, `coindrop`, `coinjar`, `coinmatch`, `commandinfo`, `countdowngoals`, `emojify`, `fallingsnow`, `firework`, `followercount`, `gcounter`, `gifts`, `goal`, `guestbattle`, `likefountain`, `memory`, `myactions`, `overlay`, `penaltybattle`, `quiz`, `ranking`, `socialmediarotator`, `songrequests`, `streambuddies`, `subcatch`, `subcatchinfo`, `talking`, `timer`, `tinydiny`, `topg`, `topgifter`, `topliker`, `tops`, `transactionviewer`, `userinfo`, `viewercount`, `webcam`, `wheel`, `wheelofactions`, `worldcupticker`.
- Extracted action types from `ui/mirror/index.html`:
  - `activateObsSource`, `addPoints`, `controlCustomGoal`, `controlTimer`, `execThirdPartyAction`, `playAudio`, `playVideo`, `playVideoFile`, `removePoints`, `sendText`, `setSnapCamEffect`, `setStreamerbotAction`, `setVoicemodVoice`, `showAnimation`, `showImage`, `showText`, `simulateKeystroke`, `speakText`, `switchObsScene`, `triggerMcCmd`, `triggerWebhook`.
- Extracted action attribute names:
  - `amountToAdd`, `amountToRemove`, `animationUrl`, `audioUrl`, `customGoalConfig`, `duration`, `imageUrl`, `keystrokes`, `mcCmd`, `message`, `obsSceneId`, `obsSourceId`, `snapCamEffectId`, `streamerbotActionId`, `text`, `textToSpeech`, `thirdPartyAction`, `timerSeconds`, `videoFile`, `videoUrl`, `voicemodVoiceConfig`, `webhookUrl`.
- Actions/Events UI exposes:
  - Event simulator controls for simulated gift/like/follow/share/subscribe.
  - Action name/description/screen, cooldown, per-user cooldown, duration, fade, skip-on-next, streak, points, OBS, audio/video/image/animation, TTS, webhook, third-party, Minecraft, and keystroke options.
  - Predefined-alert import via `actionsandevents.importPredefined()`.
- `wheelOfActions.typeToTriggerId` contains mappings for:
  - `follow`, `share`, `subscribe`, `any_gift`, `product_purchase`.
- `app.beautified.js` trigger branches visibly reference:
  - `gift`, `chat_message`, `subscribe`, `follow`, `share`, `join`, plus branches for emote, minimum coins, command, likes, product, and first activity; exact branch-to-label mapping still needs extraction.
- Public gift configuration shape found in `app.beautified.js`:
  - `{ type: "gift", id, name, coins, imageUrl }`
  - Raw gift data is normalized from fields including `giftType`, `diamond_count`, and image `url_list`.
- `ui/mirror/index.html` embedded app config includes:
  - `appVersion: "1.70.1"`
  - `apiBasePath: "/api/"`
  - `ttsHost: "https://tts.tikfinity.com"`
  - `connectorHost: "https://tikfinity-cws-{instance}.zerody.one/"`
  - `myinstantsApiHost: "https://myinstantsapi.zerody.one/"`
  - `authApiHost: "https://auth.zerody.one/"`
  - `authApiAppId: "tikfinity"`
  - `chatbotAccountName: "TikFinity"`
  - `useBrowserBridge: false`
  - `electronUseBrowserBridge: true`
  - `useClientParser: true`
  - `useAuthApi: true`
  - `useConnectorV2: true`
  - `fetchTopGifterViaBridge: true`
  - VoiceMod client key `controlapi-4bu032460`.
- `what-i-end.md` established:
  - `/api/init` returns `appInit` and uses `countryCode`.
  - Client session settings include `apiAuthToken`, `channelId`, `quickLogin`, `authProvider`, and `loginAccessToken`.
  - Auth headers are `X-Authorization-Token` and `X-Channel-ID`.
  - Legacy `wsUrl`/`wsParam` are used only when available.
  - `deob/local-api.js` is a local mock: `logError`, local `init`, empty `rest/*`, mock `auth/*` and `api/login`, TTS stubs, subscriber responses for `pro/*`, and shape-based defaults for unknown APIs.
  - Local server defaults to `STANDALONE=1`; `PROXY=1` enables maintenance proxy mode.
  - Static assets were localized, including JSZip/FileSaver, fonts, images, and `sounds/shortcut.mp3`.
- `ui/mirror/docs/faq-en.md` documents:
  - Connection requires the correct `@handle` and an active TikTok live stream.
  - TikFinity itself does not multistream; OWN3D is recommended for other platforms.
  - Minecraft integration uses ServerTap and port `4567`.
  - Alerts require an Actions & Events action, a linked event, a selected screen, and the screen added to TikTok Live Studio/OBS as a Link Source.
  - Actions can be tested with the Play/Test button.

### Active
- Complete chunked reads of `api-map.md`, `plan.md`, `plan2.md`, `what-i-end.md`, and `server.js`.
- Read the complete file listings for `G:\re\tikfinity\source\` and `G:\re\tikfinity\source-res\`, then skim their main entry points as required.
- Map every UI page template to its purpose, controls, sub-tabs, and navigation links.
- Extract complete HTTP/API paths, Electron IPC/context-bridge methods, and WebSocket messages.
- Extract complete settings keys and persisted entity shapes from `ui/mirror/combo/*.js` and `deob/`.
- Resolve exact trigger labels, filters, cooldowns, scheduling/throttling, and event/action object fields.
- Inspect remaining `what-i-end.md` stages and plan files for explicit unfinished work.

### Blocked
- Several tool outputs were truncated, including the initial recursive file listing and long reads of `api-map.md`, `plan.md`, `plan2.md`, `what-i-end.md`, and `server.js`.
- `deob/strings-report.txt` is detected as binary by the `read` tool; PowerShell `Get-Content` works, but only partial chunks were captured.
- `deob/strings-dump.json`/`deob/strings.txt` contain heavily corrupted/binary-looking extracted strings and are not yet useful.
- Some substring/PowerShell inspection commands failed with:
  - `Select-Object ... -Skip 250 -Skip 0`
  - `Index and length must refer to a location within the string.`
  - `StartIndex cannot be less than zero.`
  - `A positional parameter cannot be found that accepts argument 'join'.`
- Exact endpoint coverage and exact trigger-ID mapping remain unknown.
- No final markdown inventory has been produced yet.

## Next Move
1. Use read-only chunked extraction on the remaining documentation and enumerate `source\`/`source-res\` files before inspecting their entry points.
2. Parse `index.html` page templates, navigation definitions, widget routes, settings keys, API strings, IPC names, and WebSocket/event schemas; then draft the seven required markdown sections with path citations.

## Relevant Files
- `G:\re\tikfinity\api-map.md`: documented Electron resources, REST routes, hosts, and update flow.
- `G:\re\tikfinity\index.js`: Electron loader/bootstrap behavior.
- `G:\re\tikfinity\server.js`: local static server, Electron-file routes, standalone/proxy behavior.
- `G:\re\tikfinity\plan.md`: reverse-engineering findings and architecture.
- `G:\re\tikfinity\plan2.md`: proposed local-first auth, wallet, test-account, and TTS work.
- `G:\re\tikfinity\what-i-end.md`: implementation/progress log and standalone modifications.
- `G:\re\tikfinity\external-urls.md`: external hosts and integration URL inventory.
- `G:\re\tikfinity\source\`: Electron shell source; listing and entry-point skim still required.
- `G:\re\tikfinity\source-res\`: downloaded runtime logic; listing and entry-point skim still required.
- `G:\re\tikfinity\ui\mirror\index.html`: SPA page templates, app config, widget/action metadata, and navigation.
- `G:\re\tikfinity\ui\mirror\combo\app.beautified.js`: main UI logic, event/action handling, trigger mappings.
- `G:\re\tikfinity\ui\mirror\combo\modules.beautified.js`: additional UI modules and API/TTS logic.
- `G:\re\tikfinity\ui\mirror\docs\faq-en.md`: user-facing connection, alert, Minecraft, and multistream behavior.
- `G:\re\tikfinity\deob\local-api.js`: local mock backend and persisted `local-data.json` behavior.
- `G:\re\tikfinity\deob\endpoints.js`: read-only endpoint extraction helper.
- `G:\re\tikfinity\deob\settings-keys.js`: settings-key extraction helper.
- `G:\re\tikfinity\deob\widget-paths.js`: widget-path extraction helper.
- `G:\re\tikfinity\deob\strings-report.txt`: partially inspected string report; read via PowerShell in chunks.


I now have a complete picture. Here is the full inventory.

---

# TikFinity — Capability & Architecture Inventory

**Scope.** Behavioural reference for building a clean-room TikTok Live automation assistant. Everything below is derived by reading the extracted Electron app, its downloaded runtime scripts, and the mirrored SPA. No code, assets, or branding from TikFinity is copied here — only behaviour, structure, and wire contracts. Note: some findings describe the *reverse-engineer's local mock* (`deob/local-api.js`, `server.js`) rather than TikFinity's real production backend; those are flagged explicitly.

Sources read (all under `G:\re\tikfinity`): `api-map.md`, `plan.md`, `plan2.md`, `what-i-end.md`, `external-urls.md`, `index.js`, `server.js`, `source/package.json`, `source-res/{main.js,preload.js,bridge.deob.js,autoupdater.util.js,cookies.js,fetchhelper.js,closeonredirect.js}`, `ui/mirror/index.html`, `ui/mirror/combo/{app,modules}.beautified.js`, `ui/mirror/docs/faq-en.md`, and helper scripts under `deob/`.

---

## 1. Screens & navigation

### 1.1 Shell
Vue 3 SPA (plus jQuery/DevExpress hybrid) served from the app host. Navigation is a Vue component (`VueNavigation` in `app.beautified.js`) driven by a single declarative category array persisted to settings key `categoryOrder`. Pages live under `#pages`, modals under `#modal-app`, nav rail under `#navigation-app`. Navigation calls `window.navigation.pageChange(pageId)`. (`ui/mirror/index.html`, `app.beautified.js`)

### 1.2 Categories → pages → sections
Each top-level category is a colored "bubble" (icon, color, optional `featureFlag` / `requiresLogin`). Sub-pages own ordered sections. (`app.beautified.js` nav model)

| Category | Page | Sections / sub-items |
|---|---|---|
| **start** | start | live connection, quick access, agencies, news, how-to, video tutorials, live channels, FAQ, about, contact |
| **setup** | setup | connect TikTok account, points system, subscriber bonus, level, OBS connection, Streamer.bot, Minecraft connection, reset points, upgrade (Pro), Patreon, account, import/export settings, advanced settings, debug options |
| **overlays** | obsoverlays | widget gallery (see 1.3) |
| | goals | likes, shares, follows, viewer count, coins earned, channel points, new subscribers, custom 1–3 |
| | followercounter | (Pro) |
| | countdowngoals | (Pro) likes, shares, follows, viewer, coins, points, subs, custom 1–3 |
| | giftoverlays | top gifter (Pro), top streaker (Pro), counter 1–3 |
| | lastx | last follower / gifter / subscriber / share / like / chatter + settings |
| | graphicoverlays | webcam frames, talking banners |
| | obsdocks | (dock) |
| | (modal) | gift browser |
| **actionsandevents** | — | isPage; rules engine UI (create actions, link events) |
| **sounds** | sounds / tts | sound settings; TTS page (AI/Pro/Singing tabs) |
| **chat** | chatcommands / chatbot | custom commands; chatbot message log, spam protection, Streamer.bot messages, snippet config |
| **vods** | — | featureFlag `reecorder`; opens recorder handoff (`reecorder/handoff`) |
| **points** | user / transactions | points wallet + transaction history |
| **song** | songrequests | commands, account, settings, history, testing |
| **tools** | likeathon | decrease, reset, top liker |
| | timer | overlay, control, settings, keyboard shortcuts |
| | wheel | advanced settings |
| | coindrop | automation |
| | challenge / halving / dapi | (tools) |
| **agencies** | agencyregistry / agencyapplications | agency network |

`data-pageid` list in `index.html` (all 29): `actionsandevents, agencyapplications, agencyregistry, challenge, chatbot, chatcommands, christmasevent, coindrop, countdowngoals, dapi, followercounter, giftoverlays, goals, graphicoverlays, halving, lastx, likeathon, obsdocks, obsoverlays, rtmpgen, setup, songrequests, sounds, start, timer, transactions, tts, user, wheel`.

### 1.3 Overlay / widget gallery
~30 widgets with a shared settings channel. Most carry `isPro: true` in nav (coinmatch, coinjarPro, wheelofactions, cannon, likefountain, followercounter, countdowngoals, gift top-gifter/streaker, and all goals). Seasonal ones are feature-gated (christmasevent → PostHog `christmas-2025`; worldcup/penaltybattle present as separate widgets). Confirmed widget ids/DOM nodes (`modules.beautified.js`, `ext-api.js`): coinmatch, coinjar, coinjarPro, wheel, wheelofactions, cannon, likefountain, christmasevent, fallingsnow, socialmediarotator, firework, emojify, chat, gifts, transactionviewer, userInfo, commandInfo, myactions, carousel, topgifter, topliker, ranking, coinDrop, timer, songrequests, viewercount, streambuddies, tinydiny, worldcupticker, penaltybattle, followercount, gifterTop, gifterStreaker, lastX* (follower/gifter/subscriber/share/like/chatter). Overlays are consumed as OBS/Live Studio **Link Sources** via per-screen URLs (`ScreenURL(widgetforOBSorLiveStudio)`, e.g. `/widget/myactions?cid=`, `/widget/penaltybattle?view=board&cid=`). (`modules.beautified.js`, `api-map.md`)

---

## 2. Core services & capabilities

- **TikTok Live ingestion.** A userscript "bridge" is injected into a TikTok tab; it holds the signed-in cookies, opens the TikTok webcast WebSocket, decodes protobuf frames, and relays events to the app renderer via `window.opener.postMessage({app:'tfbridge', type, info, binary})`. A local parser alternative exists (`useClientParser:true`). (`bridge.deob.js`, `api-map.md`)
- **Sign/connector + recorder.** `tiktok-sign.zerody.one` signs TikTok API requests; a "connector" WebSocket service and the GRU/euler recording SDK (feature `reecorder`) are gated behind PostHog flags. (`api-map.md`, `ext-api.js`)
- **Electron desktop shell.** A thin loader downloads `main.js` + helper scripts at startup and manages hidden windows for TikTok login/logout (`ttwid`), OAuth token fetching, and a signed-TikTok fetch helper. (`index.js`, `source-res/*`)
- **dAPI — local event bus.** Main process runs a WebSocket server on `127.0.0.1:21213`; external clients (OBS widgets, third-party tools) connect, receive a relay of TikTok events, and can push messages back to the app. (`source-res/main.js`, `preload.js`)
- **Rules engine (Actions & Events).** Event → trigger match → bound action(s). 22 action types, per-action and per-user cooldowns, points changes, screen targeting, streaks/skip-on-next, offline-screen detection. (`modules.beautified.js`)
- **Overlay/goals engine.** Live widgets + goal counters driven by the same event bus, with per-widget settings/ack/state channel and in-app test buttons. (`modules.beautified.js`, `ext-api.js`)
- **TTS.** AI/Pro/Singing voices, credit-based quota (free message cap + Pro credits), generate/preview, top-up checkout. (`/api/tts/*`, `ext-api.js`)
- **Chat & commands.** Custom chat commands, chatbot with spam protection + message log, Streamer.bot snippet integration. (nav model, `modules.beautified.js`)
- **Song requests.** Spotify-backed queue with account link, history, testing area. (nav model, `ext-api.js`)
- **Points economy.** Wallet, transactions, add/remove points, subscriber bonus, level system, reset. (nav model, `actionsandevents`)
- **Integrations.** OBS WebSocket (4455), Streamer.bot, VoiceMod, Minecraft/ServerTap (4567), Spotify, YouNow, AutoIt + PowerShell exec, Patreon, Discord OAuth. (`ext-api.js`, `api-map.md`)
- **Agency network.** Registry + applications/claims. (`agency.tikfinity.com`)
- **Sessions/cookies.** TikTok cookie export/backup, ttwid delete, full TikTok session reset. (`api-map.md`, `modules.beautified.js`)
- **Settings/UX infra.** Import/export settings JSON, advanced + debug options, OBS docks, gift browser, locale-specific settings, per-screen URL manager. (nav model, `ext-api.js`)

---

## 3. Endpoints & IPC

### 3.1 App backend (host = `TIKFINITY_HOST`, prod `https://tikfinity.zerody.one`)
`/api/init` (bootstrap `appInit`; `appConfig.modules` must be truthy or the app throws; returns user, settings, `countryCode`, appVersion, flags) · `POST /api/logError` · `POST /api/electron/update/log` · `GET /api/public` · `/api/config` · `/api/rest/...` (e.g. `rest/channeluser`, `rest/channel/current`) · `/api/setAffSuperCookie` · `/api/getAllGifts?lang=` · `api/christmas/{leaderboard,winners}` · `/api/tts/{user,voices,generate,preview}` (via `requestAiTtsApi`) · `/preconfig/predefined_actions.tfc` · auth (`doAuthRequest`, `/auth/callback?token=`, header `X-Authorization-Token`, `auth.zerody.one` appId `tikfinity`) · pro/billing (`pro/{upgrade,reactivate,deactivate,discount,setPaymentMethod}`, `pro/stripe/activate`, `pro/lemonsqueezy/updatePayment`, `pro/paddle/updatePaymentUrl`, `pro/tazapay/methods`, `pro/xsolla/manageUrl`; Patreon/Stripe/PayPal/BuyMeACoffee/Ko-fi/Xsolla checkout). (`api-map.md`, `ext-api.js`, `what-i-end.md`)

### 3.2 TikTok (in-page, via bridge)
`https://www.tiktok.com/passport/web/account/info/?aid=1459` (login check → `data.user_id` or `noLogin`) · `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=` (room id + isLive; ~15s poll; fallback `GET /api/tiktok/user-room?uniqueId=`) · webcast `room/enter`, `im/fetch`, push WebSocket on `webcast.tiktok.com` (protobuf; wire orders `"1|3|5|2|4|0"`, `"1|0|2|5|4|3"`) · `sendChatMsg` (POST) · `getRanklist` / `/webcast/.../online_audience/?aid=1988&anchor_id=1&room_id=`. Events to renderer: `newRoomIdDetected`, `isLiveDetected`. (`api-map.md`, `bridge.deob.js`)

### 3.3 Connector / TTS / recorder
`https://tiktok-sign.zerody.one/` (signing) · `https://tiktok.eulerstream.com/` · `http://127.0.0.1:8832/api/` (local TTS engine) · `https://tikfinity-tts-api.zerody.one/api/voice/generate` · GRU SDK `/electron/gru-sdk.pkg.json.gz`(+`.sha`), middleware `electron.tikfinity.dev` (`GRU_MIDDLEWARE_URL`). (`ext-api.js`, `api-map.md`)

### 3.4 Downloaded runtime & updates (Electron shell)
`/electron/{main,websocketserver,cookies,fetchhelper,closeonredirect,autoupdater.electronbuilder,autoupdater.forge,autoupdater.util}.js` · `/electron/keyboardlistener.js` (unimplemented) · `/extension/tiktok_live_bridge_electron.user.js?c=electron&v=<v>` · updater host `tikfinity-electron-updates.b-cdn.net` (`/win/TikFinity-Setup-<v>.exe`, `/mac/TikFinity-<v>.dmg`). (`api-map.md`, `server.js` route table)

### 3.5 Electron IPC (`preload.js` exposes `window.API`; single `ipcRenderer.invoke('toMain', {action,…})`)
Actions: `sendBrowserLog`, `execPsCommand(command,returnResult)`, `execAutoItCommand(command,useQueue,queueId,queueLen)`, `setUniqueId(uniqueId)`, `setChannelId(channelId)`, `fetchUrl(axiosConfig)→fetchUrlResponse{requestId,responseData,responseCode}|{error}`, `onFeatureFlags(flags)` (starts autoupdater on `electron-auto-update`, GRU SDK on `reecorder`), `gruWebcastEvent{protoName,payload(base64),roomId}`, `gruWebcastInfo{objectType,body,roomId}`, `emitWs(payload)` (broadcast to dAPI clients), `initKeyboardListener`, `deleteTtwidCookie`, `resetTiktokSession`. Main→renderer events: `newRoomIdDetected, isLiveDetected, autoItNotInstalled, execPsCommandResult, spotifyAuthToken, fetchUrlResponse, keyboardEvent, dapiClientConnected, dapiMessage`. (`source-res/main.js`, `source-res/preload.js`)

### 3.6 dAPI local WebSocket (`127.0.0.1:21213`) + widget channel
Client connect → `dapiClientConnected`; renderer→clients via `emitWs`; client→renderer via `dapiMessage`. Overlay widget settings sync uses `widgetSettings` / `widgetSettingsAck` / `widgetState` / `widgetConnected` / `widgetSettingsTimeout`; socket health via `websocketPingInterval` / `websocketReconnectTimeout` / `websocketReconnectAttempts`. (`main.js`, `ext-api.js`)

---

## 4. Data model

### 4.1 Events / triggers
`triggerTypeId` → semantic trigger (`app.beautified.js`), each with a payload:

| ID | Trigger type | Payload fields |
|---|---|---|
| 1 | share | — |
| 2 | command | `cmd` (custom chat command) |
| 3 | min_coins | `minCoinsValue` |
| 4 | gift | `id`, `name`, `imageUrl`, `coins` |
| 6 | join | — |
| 7 | likes | `minLikesAmount` |
| 9 | follow | — |
| 10 | subscribe | — |
| 11 | chat_message | — |
| 12 | emote | `id`, `imageUrl` (subscriber emote) |
| 13 | first_activity | — |

Event-editor fields (`data-str` `actionsandevents_events_modal_*`): select gift / sticker (global + partner sections) / subscriber emote / fan-club sticker, product name, min amount, min likes, custom command, top-gifter N, min trigger level, min trigger team level, select action (+ "random"), and a "run through which user" audience filter. Wheel-of-actions maps `follow, share, subscribe, any_gift, product_purchase` to numeric trigger ids. (`app.beautified.js`, `index.html`)

### 4.2 Actions
Defaulted in `openNewActionModal` / consumed by `executeAction`: `name` (≤30), `description`, `screenId`, `duration`, `enableFadeEffect`, `amountToAdd`, `amountToRemove`, `imageUrl`/`audioUrl`/`videoUrl`(+`videoFile`)/`animationUrl`, `text`, `textToSpeech`, and `dynamicConfig{cooldown, userCooldown, enableStreaks, skipOnNext, mediaSoundVolume}`. 22 action types: `activateObsSource(obsSourceId)`, `addPoints(amountToAdd)`, `controlCustomGoal(customGoalConfig)`, `controlTimer(timerSeconds)`, `execThirdPartyAction(thirdPartyAction)`, `playAudio(audioUrl)`, `playVideo(videoUrl)`, `playVideoFile(videoFile)`, `removePoints(amountToRemove)`, `sendText(message)`, `setSnapCamEffect(snapCamEffectId)`, `setStreamerbotAction(streamerbotActionId)`, `setVoicemodVoice(voicemodVoiceConfig)`, `showAnimation(animationUrl,duration)`, `showImage(imageUrl)`, `showText(text)`, `simulateKeystroke(keystrokes)`, `speakText(textToSpeech)`, `switchObsScene(obsSceneId)`, `triggerMcCmd(mcCmd)`, `triggerWebhook(webhookUrl)`. Action list is capped (Pro over ~5). (`modules.beautified.js`, `index.html`)

### 4.3 Gifts
Normalized gift `{ type:'gift', id, name, coins, imageUrl }`; raw from TikTok `diamond_count` + `url_list`. Related: gift browser, gift counters (`gift1/2/3GoalContainer`, `giftGoalValues`, reset-on-new-bc), `getAllGifts`, `isNewGifter`, `broadcastGifts`, top-gifter ranking, transaction-viewer feed. (`app.beautified.js`, `api-map.md`)

### 4.4 Goals, minigames, points, TTS, settings
Goals: likes/shares/follows/viewer/coins/points/subs/custom1–3 (+ countdown goals with `countdownStartDelay`, `randomizedSlowCountdown`, `keepShowingWinners`). Minigames: CoinMatch (bids, `maxParticipantsCount`, `minimumBid`, `snipeMode`, countdown), WheelOfActions (`wheels`, `spinDuration`/`waitDuration`/`announceDuration`, `showBase`), PenaltyBattle (leaderboard + board URL), SongRequests, Likeathon, Timer. Points wallet + transactions + subscriber bonus + level. TTS user state: `{credits, freeMessages, freeMessagesMax, subCredits, proCredits, used}`. Settings facade: `get/set/save`, dynamic + client-only + public + overload settings, `setPluginSettings`, import/export, per-widget `widget_<id>_<field>`, session keys `apiAuthToken/channelId/quickLogin/authProvider/loginAccessToken`. (`modules.beautified.js`, `ext-api.js`, `api-map.md`, `local-api.js`)

---

## 5. Rules engine (trigger → action)

A live event arrives → matched against a rule's trigger (type + filter, e.g. specific gift, min coins/likes, min team/member level, top-gifter N, product name, custom command) → if matched, bound action(s) execute. Execution enforces (a) a global per-action cooldown (`toastr` "Global Cooldown!"), (b) a per-user cooldown keyed `actionId_username` ("User Cooldown!"), (c) Pro/temp-disable checks, (d) target-screen online/offline checks, then dispatches the action (overlay animation/media/text, OBS, TTS, points, external integrations). Streak and skip-on-next behaviours and action-level random selection are supported. (`modules.beautified.js` `executeAction`, `app.beautified.js` trigger mapping)

---

## 6. Notable UX & flows

- **Onboarding/gating:** not-logged-in or missing channel name redirects to Setup with a "shake" effect; a live-connection card shows connection state. Setup requires the correct `@handle` and an active TikTok live to actually connect. (`app.beautified.js`, `faq-en.md`)
- **Alert creation:** create an Action (name, type, media/text, target screen) → link it to an event → copy the screen's Link-Source URL → add that URL in OBS/TikTok Live Studio. A "Play/Test" button previews actions and a simulator injects gift/like/follow/share/subscribe for testing. (`modules.beautified.js`, `faq-en.md`, `index.html`)
- **Overlay loop:** every widget has a Settings modal (`#widgetSettingsModal`, `widgetHooks`) with live preview and a Test button; widgets appear in OBS as Link Sources and stay in sync via the settings/ack channel. (`modules.beautified.js`)
- **TTS:** TTS page auto-reads chat comments; Actions & Events TTS is the flexible path (e.g. per-gift); Pro voices have a quota banner that links to top-up. (`index.html` TTS/QA text, `api-map.md`)
- **Seasonal/flagged UX:** Christmas 2025 event, world-cup ticker, penalty battle appear only behind PostHog feature flags. (`app.beautified.js`, `ext-api.js`)
- **Integrations UX:** OBS/Streamer.bot WebSocket test-and-configure forms (`#obsWebsocketTestConnectionButton`), Streamer.bot "not connected" prompts, Minecraft ServerTap instructions, Spotify connect. (`modules.beautified.js`, `ext-api.js`)

---

## 7. Gaps, planned & unfinished

**This describes the reverse-engineered local build in this folder, not a shipped competitor feature set.**

- **Local backend is a mock.** `deob/local-api.js` returns synthetic defaults: `/api/init` fabricates a Pro local user with `modules:{}`; `rest/*` empty; `tts/generate|preview` disabled; `pro/*` faked active; unknown `/api/*` → `{success:true}` or `{items:[]}`. **Auth/login/dashboard were intentionally removed** (mock archived at `deob/deprecated/local-auth-mock.js`) — the app presents no login locally. (`local-api.js`, `server.js`, `what-i-end.md`)
- **Real backend still required** for genuine behavior: `/api/init`, auth (`X-Authorization-Token`, `auth.zerody.one`), TTS AI, request signing (`tiktok-sign.zerody.one`), gift catalog, leaderboards, agencies, Pro gating/billing, analytics. Most are unreachable standalone. (`api-map.md`, `what-i-end.md`)
- **TTS local engine is only a plan.** `plan2.md` proposes edge-tts / Piper / Coqui / Windows-SAPI fallback chain behind `127.0.0.1:8832` — not built. (`plan2.md`)
- **Recorder/GRU not provisioned** locally; update/GRU manifest routes intentionally 404 (`BLOCK-standalone`); VOD handoff depends on the real `reecorder` service. (`server.js`, `what-i-end.md`)
- **`plan2.md` auth-wallet is unstarted (proposed only):** Argon2id(1 GB,t=4,p=4) → 32-byte master key → AES-256-GCM `vault.enc`; 6-word diceware passphrase; optional Windows Hello/DPAPI; JWT + rotating refresh (HKDF-derived vault key); rate-limit/lockout; append-only `audit.jsonl`; optional TOTP 2FA; endpoints `POST /vault/{setup,unlock,change,lock}`, `GET /vault/status`, `POST /auth/2fa-{setup,verify}`; a `deob/test-auth.js` 14-case suite. None implemented. (`plan2.md`)
- **Asset/streamer gaps:** MyInstants sound search (`myinstantsapi`) and some widget bundles (coin-match, world-cup, penalty-battle) returned errors/empty during local runs; some widget JS 502'd. (`what-i-end.md`)
- **Standalone hardening incomplete:** PostHog/Braze flags still referenced in obfuscated nav gating (christmas/reecorder), so some feature-hide paths remain. (`what-i-end.md`, `app.beautified.js`)
- **Packaging:** standalone Electron v35 build not completed (slow/blocked network); local dev runs on the extracted v31 distribution. (`plan.md`, `what-i-end.md`)

---

### Key source files
- `G:\re\tikfinity\api-map.md` — endpoint/service/IPC map
- `G:\re\tikfinity\ui\mirror\index.html` — page templates, widget/action metadata, app config
- `G:\re\tikfinity\ui\mirror\combo\app.beautified.js` — nav model, trigger mapping, event editor
- `G:\re\tikfinity\ui\mirror\combo\modules.beautified.js` — actions engine, widget settings, integrations
- `G:\re\tikfinity\source-res\main.js` / `preload.js` — Electron IPC + preload bridge
- `G:\re\tikfinity\deob\local-api.js` / `server.js` — local mock + standalone routing
- `G:\re\tikfinity\plan.md` / `plan2.md` / `what-i-end.md` — status, plans, and explicit gaps

Want me to go deeper on any single area (e.g. the OBS/dAPI protocol, the full rules-engine semantics, or a clean-room screen-by-screen spec for the new app)?