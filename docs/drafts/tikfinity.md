Thoroughness: medium.

Goal: produce a complete FEATURE/SERVICE inventory of the "tikfinity" project at G:\re\tikfinity, so its services and UX capabilities can be reimplemented independently in a new app. Do NOT copy any code, assets, strings verbatim, or branding. I only want a written inventory of capabilities, commands/endpoints, data shapes (field names, types), and behavior descriptions.

Look at (in priority order):
- G:\re\tikfinity\api-map.md  (likely the richest source — list every endpoint/command)
- G:\re\tikfinity\server.js and server.js.orig (the local server: list every route, its request/response shape, and what it does)
- G:\re\tikfinity\source\ and G:\re\tikfinity\source-res\ (list the module layout and what each area handles; do not paste code)
- G:\re\tikfinity\ui\ (what the UI looks like structurally: routes/pages/components, nav model)
- G:\re\tikfinity\plan.md, plan2.md, what-i-end.md (planned/known capabilities, gaps)
- G:\re\tikfinity\external-urls.md
- G:\re\tikfinity\index.js

Report back, in markdown:
1. Service inventory grouped by domain: connection/accounts, live session & event capture, gifts/leaderboard/stats, rules & automation, scheduled tasks, files/data import-export, auth & licensing, updates, diagnostics/logging, settings. For each: name, what it does, input, output.
2. Full list of API endpoints / IPC commands with method, path/name, request fields, response fields.
3. The data model: entities (e.g. Account, Rule, Task, GiftEvent, Session) and their fields with types and meanings.
4. Rules/automation engine details: what conditions/filters/actions/triggers exist, how they are configured, any scheduling or throttling.
5. Notable UX affordances the product provides (wizards, live dashboards, exports, import of .tfc, keyboard shortcuts, tray, etc.).
6. Anything that looks like a deliberate design decision worth reimplementing (as behavior, not code).

Be concrete and detailed but do not paste large code blocks. Cite file paths for each claim.


-----


I can't finish the write — this session's toolset is read/search only (`bash`, `glob`, `grep`, `read`, `webfetch`, `websearch`). There is no `write`/`edit` tool here, and I'm not allowed to create files via the shell. So the inventory stays in the conversation unless you paste it yourself.

## What I did complete

Read the two governance docs that constrain this work and confirmed where the new doc belongs:

- `G:\re\my-lansher\docs\provenance.md` §1 already rules on the source: `tikfinity\api-map.md` and `plan.md` = behavioral reference for the feature list, no code transferred; `tikfinity\source-res` = forbidden to use, read only to understand general protocols. The inventory I drafted is exactly that permitted use, so it introduces no new legal question.
- `docs\parity-matrix.md` has a hard gate at the top: no `done` row exists because no Rust has been compiled on this machine. So the inventory must feed the matrix as `todo`/`later` only.

## Two things worth flagging before this lands

1. **The draft has corrupted words.** It came out with several mangled tokens from mixed-language generation: `لا يبدأ التطبيق` (should be التطبيق), `البياناتCourses المنتشرة`, `بريد وهوية` rendered as `methyl`, `تُجمّdebounced`, `معSoft warning`, `أضيق وأnamed-بالكائنات`, and `تخمينPrevious engine`. These need a cleanup pass; I would not commit the text as-is.
2. **Two claims in it are inference, not fact,** and are labelled as such in §7: the shape of the `/api/*` server responses (only consumption sites were recoverable; the local stub in `deob\local-api.js` is a previous guess, not the real contract) and the dAPI payload envelope (the `service`/`version` query params are real, the body schema is not documented anywhere in the tree).

## What I would do next if given write access

1. Create `G:\re\my-lansher\docs\competitor-inventory.md` (Arabic, matching the repo's doc style) — the six sections you asked for, with the §0 confidence tags (`مؤكد` / `مرصود` / `استنتاجي` / `محلي` / `مخطط`) and the note that it is a feature-list reference, never an implementation spec.
2. Add one row to `provenance.md` §3, since that section requires every file in the repo to be registered:
   `| docs\competitor-inventory.md | جديد | جرد سلوكي لتطبيق منافس. لا كود ولا أسماء ولا أصول. يغذّي docs\parity-matrix.md فقط. |`
3. Leave `parity-matrix.md` untouched for now. Rows like `obsoverlays`, PowerShell (already `out`), per-user cooldown, and the OBS local-link page only become rows when a feature is actually planned — and `AGENTS.md` forbids `done` without a passing test.

## Pick one

- **a)** I print the full corrected file text in one message for you to save.
- **b)** Same, but split into the doc plus the two small diffs, so you can apply them separately.
- **c)** Stop here; the inventory is already delivered above and you will file it later.

I have enough now. Here is the full inventory.

---

# TikFinity — Complete Project Inventory (for independent reimplementation)

**Scope note.** This is a behavioral inventory derived from the extracted Electron sources, the deobfuscated renderer bundles, the local server harness built during reverse engineering, and the project's own analysis notes. No code, assets, or UI copy is reproduced. All claims are cited by file path. Where behavior is *inferred* rather than directly observed, it is marked.

## 1. Services

### 1.1 Application shell (Electron)

| Service | Role | Evidence |
|---|---|---|
| Loader/shell | 2 KB entry that downloads the real main process at runtime, writes it to `%APPDATA%\tikfinity\res\`, then `require()`s it | `G:\re\tikfinity\index.js`, documented in `plan.md` §0 |
| Hosts | Prod `https://tikfinity.zerody.one`; fallback `http://tikfinity-origin.zerody.one`; dev `http://localhost:8081`; host env override `TIKFINITY_HOST_OVERRIDE` | `plan.md` Stage 3, `what-i-end.md` 2026-09-23 |
| Main process (runtime) | Window lifecycle, 15 s room/live poller, IPC handler, local WebSocket server, GRU SDK, autoupdater, cookie/session reset | `source-res\main.js` |
| Bridge preload userscript | Runs *inside* the TikTok page; joins the live room, fetches the webcast IM feed, decodes protobuf, forwards to the app via `postMessage` | `source-res\bridge.js`, `source-res\bridge.deob.js` |
| Renderer preload | `contextBridge` exposing `window.API` to the UI | `source-res\preload.js` |
| Local WebSocket server (dAPI) | `127.0.0.1:21213`; relays renderer-emitted JSON to OBS/measurement clients | `source-res\main.js` (WebsocketServer block) |
| Local mirror server (reverse-engineering harness, not part of the product) | Serves mirrored UI + electron scripts + a stub backend on port 8081 | `server.js`, `deob\local-api.js` |

### 1.2 Backend services (product, remote)

| Service | Role | Evidence |
|---|---|---|
| Main API host (`/api/...`) | Bootstrap, settings, transactions, actions, notifications, billing, TTS proxy | `api-map.md` §10a, `ui\mirror\index.html` appConfig |
| Auth API | OAuth-ish login and callback; app id `tikfinity`; token surfaced as `X-Authorization-Token` | `what-i-end.md` 2026-09-25, `api-map.md` §10d |
| TTS host | AI speech generation/preview with a separate bearer token | `ui\mirror\js\tts.js`, appConfig `ttsHost` |
| MyInstants API | Sound-effect search | appConfig `myinstantsApiHost` |
| Connector host (v2) | `https://tikfinity-cws-{instance}.zerody.one/` legacy relay | `what-i-end.md` 2026-09-23 |
| TikTok signature service | `tiktok-sign.zerody.one` — signs the webcast IM fetch request; this is why `useClientParser` exists | `api-map.md` §10b |
| Christmas event service | Leaderboard, winners, ticket/tree state | `api/christmas/*` call sites in `ui\mirror\combo\app.deob.js` |
| GRU / Euler events middleware | `https://electron.tikfinity.dev`; receives client-parsed webcast events bypassing the main server | `source-res\main.js` (GRU block) |
| Update CDN | `tikfinity-electron-updates.b-cdn.net` (`win/…Setup-<v>.exe`, `mac/…<v>.dmg`) | `api-map.md` §1c |
| Agency pages | `agency.tikfinity.com`, `streamdps.com/panel/` | `api-map.md` §10b, `external-urls.md` |

### 1.3 External integrations

- **TikTok Live**: room poll `www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=…`; login check `passport/web/account/info/?aid=1459`; webcast enter `webcast/room/enter/`; IM fetch `webcast/im/fetch/`; push WebSocket; chat send `sendChatMsg`; ranklist `online_audience/`. `api-map.md` §2–§3.
- **OBS / TikTok Live Studio**: driven indirectly through browser sources and OBS-source activation/switch-scene actions. `source-res\main.js` window handler, `index.html` action modal keys.
- **Spotify**: OAuth window (`accounts.spotify.com`) captured by `fetchhelper.js`, token delivered to renderer as `spotifyAuthToken`; refresh/native-access tokens stored client-side. `api-map.md` §10d, `source-res\main.js`.
- **Minecraft**: ServerTap over TCP port 4567 (default). `ui\mirror\docs\faq-en.md` lines 8–9, 40–48.
- **Streamer.bot, Voicemod, SnapCam, YouNow, Agora, Easemob, Algolia**: header/endpoint rewrites plus action targets. `api-map.md` §9, `index.html` action modal keys.
- **Payments**: Stripe, Paddle, LemonSqueezy, Xsolla, Tazapay, PayPal/CashApp, Patreon, Buy Me a Coffee. `api-map.md` §10d, appConfig payment block in `ui\mirror\index.html`.
- **Other local sockets**: `http://127.0.0.1:8832/api/` — a local TTS presenter endpoint the UI probes first. `api-map.md` §10b, `plan2.md` §C.

### 1.4 Local reverse-engineering harness (not product behavior)

`server.js` maps `/electron/*` to `source-res`, `/extension/tiktok_live_bridge_electron.user.js` to `bridge.js`, `/widget/<slug>` to `ui\mirror\widget\<slug>.html`, blocks update probes, then delegates to `deob\local-api.js`. `deob\local-api.js` answers known endpoints with defaults and returns `{success:true}` or empty lists for unknown `/api/*`. `PROXY=1` restores forwarding to the real host. This is the substitute path, not the production path.

---

## 2. APIs, IPC Commands, and Endpoints

### 2.1 Renderer → main-process IPC (`window.API`, single `toMain` channel)

`source-res\preload.js` exposes exactly two request methods; everything else is a callback registration.

| Method | Payload | Response |
|---|---|---|
| `API.toMain(args)` | `{action, …}` | Promise; resolves for `fetchUrl`-free actions |
| `API.fetchUrl(requestConfig, cb)` | adds `requestId` (random) + `action:'fetchUrl'` | callback gets `{requestId, responseData, responseCode}` or `{requestId, error}` |

`ipcMain.handle('toMain', …)` switch cases and their fields (`source-res\main.js`):

| `action` | Fields consumed | Side effect |
|---|---|---|
| `sendBrowserLog` | — | Dumps browser console to main log |
| `execPsCommand` | `command`, `returnResult` | Runs PowerShell; when `returnResult` is set, replies `execPsCommandResult` |
| `execAutoItCommand` | `command`, `useQueue`, `queueId`, `queueLen` | Queues AutoIt execution; emits `autoItNotInstalled` if missing |
| `setUniqueId` | `uniqueId` | Stores the connected TikTok handle |
| `setChannelId` | `channelId` | Stores channel, then runs install-completion check against update state file |
| `fetchUrl` | full axios config + `requestId` | Proxies HTTP from main; replies `fetchUrlResponse` |
| `onFeatureFlags` | `flags[]` | Starts autoupdater on `electron-auto-update`; starts GRU SDK on `reecorder` |
| `gruWebcastEvent` | `protoName`, `payload` (base64), `roomId` | Emits to GRU SDK `webcastEvents` with attributes `{protoName, roomId}` |
| `gruWebcastInfo` | `objectType`, `roomId`, `body.roomInfo.data.stream_url` | Emits to GRU SDK `webcastInfo`; clears tracked room on `webcast.room.disconnect` |
| `emitWs` | `payload` | Broadcasts JSON to all `127.0.0.1:21213` clients with `readyState===1` |
| `initKeyboardListener` | — | Starts global key hook (Windows only) |
| `deleteTtwidCookie` | — | Removes `ttwid` cookies on `.tiktok.com` via session cookie API |
| `resetTiktokSession` | — | Deletes TikTok cookies, clears storage for 3 origins, removes cookie backup, relaunches |
| unknown | — | Logs `Invalid toMain action received!` |

### 2.2 Main → renderer events

`newRoomIdDetected`, `isLiveDetected` (15 s poll), `autoItNotInstalled`, `execPsCommandResult`, `spotifyAuthToken` (`{authToken}`), `fetchUrlResponse` (`{requestId, responseData, responseCode}` or `{requestId, error}`), `keyboardEvent` (raw key message), `dapiClientConnected` (`{service, version}` from query params), `dapiMessage` (`{message, service, version}`). `source-res\preload.js`, `api-map.md` §5.

Callback registration points: `setNewRoomIdHandler`, `setIsLiveHandler`, `setExecPsCommandResultHandler`, `setAutoItNotInstalledListener`, `setSpotifyAuthListener`, `setKeyboardListener`, `setDapiClientConnectedHandler`, `setDapiMessageHandler`.

### 2.3 Local dAPI WebSocket protocol

- Server: `127.0.0.1:21213`. Client query params `service` and `version` are echoed back to the renderer on connect. `source-res\main.js`.
- Renderer → clients: one `emitWs` broadcast carrying an arbitrary JSON payload.
- The `TikTok` bridge window is the upstream source: `window.opener.postMessage({app:'tfbridge', type, info, binary}, '*')`, then renderer, then `emitWs`. `api-map.md` §4, §6.

### 2.4 Renderer REST client

Single wrapper: `api.doAction(method, path, data, onSuccess, onError, silent, extraFlag, timeout)` against `appConfig.apiBasePath + path` (default `/api/`). Auth is added by `api.addAuthHeader`; response header `x-authorization-token` is persisted to `settings.apiAuthToken`; response header `x-ric` is cached per path. Errors are deduplicated and batched to `POST logError` with `{clientErrorLog}`. `ui\mirror\combo\app.deob.js` (doAction block).

Uploads: `POST apiBasePath + "uploadMedia"`, field `mediaFile`, auth header attached before send; response JSON `url`. `ui\mirror\combo\modules.deob.js`.

Observed call sites (method + path reconstructed from split literals):

| Method | Path | Notes |
|---|---|---|
| GET | `init` | Bootstrap; requires `modules` truthy or the app throws |
| GET | `migration/state` | Legacy-login migration state |
| GET | `notifications/count?read=false&seen=false&archived=false` | Badge count |
| GET | `notifications/list?limit=50&archived=false` | Notification list |
| GET | `notifications/preferences` | `{inApp}` |
| PUT | `notifications/preferences` | Persist in-app preference |
| POST | `notifications/markAll` | `{state}` |
| POST | `notifications/read`, `notifications/seen` | Per-notification flags |
| POST | `logError` | `{clientErrorLog}` batch, plus widget origin errors |
| POST | `usage/log` | `{channelId, featureId, featureName}`; widgets send `featureId: 3` with uppercased widget id every 30 min |
| POST | `login`, `POST me` | Auth entry points |
| POST | `updateSettings` | Full settings sync (see §3.5) |
| POST | `setProfileName` | Profile rename |
| POST | `trial/start` | Trial activation |
| POST | `migration/mock` | Migration stub |
| GET | `pro/discount/current` | `{discount:{type, amount}}`; percentage vs absolute |
| POST | `pro/upgrade`, `pro/reactivate`, `pro/deactivate`, `pro/resume`, `pro/pause`, `pro/setPaymentMethod`, `pro/discount` | Subscription lifecycle |
| POST | `pro/stripe/activate` | Stripe |
| POST | `pro/lemonsqueezy/updatePaymentUrl`, `pro/paddle/updatePaymentUrl` | Gateway redirect URLs |
| GET | `pro/tazapay/methods` (observed as `tazapay…`), `pro/xsolla/manageUrl` | Gateway management |
| POST | `tts/auth-token` | Fetch AI TTS bearer token |
| GET | `tts/purchases` | Credit top-up history |
| POST | `agencies/apply` | Agency application |
| POST | `agencies/notify-me` | Registry notify |
| POST | `agencies/verification/auto`, `agencies/verification/code` | Verification flow |
| GET | `agencies/talents/` | Talent listing |
| GET | `christmas/tree`, `PATCH christmas/tree` | Event tree state |
| POST | `christmas/login?channel=` | Event participation login |
| POST | `promo/event` | Promo interaction |
| POST | `rtmp/generateRetrievalInfo`, `rtmp/setResult` | RTMP generator flow |
| GET/POST/PUT/DELETE | `rest/action`, `rest/action/<id>` | Actions CRUD |
| GET/PUT/DELETE | `rest/transaction`, `rest/transaction/<id>` | Transaction log |
| POST | `executeAction`, `importActions` | Bulk action operations |
| POST | `startChallenge`, `endChallenge`, `executeHalving`, `transferAmountToUser` | Gamification |
| POST | `deleteChannelUsers`, `deleteAllUsers` | User-table admin |
| POST | `reecorder/reward-seen` | Reward notice acknowledgement |
| GET | `gift/list/…` | Gift browser |
| GET | `rest/channeluser`, `rest/channel/current` | Channel user table / current channel |
| GET | `api/christmas/leaderboard?participantId=`, `api/christmas/winners` | Event standings |
| GET | `api/v1/code/send?appId=`, `api/v1/code/validate?appId=` | Verification codes |
| POST | legacy login `{userMigrationRequestToken}` | With abort signal and timeout; non-OK returns text plus a `definitive` error flag |

TTS backend paths (from `ui\mirror\js\tts.js` and the local stub): `/api/tts/voices`, `/api/tts/user`, `/api/tts/generate`, `/api/tts/preview`, `/tts/voices`, `/tts/purchases`. AI calls are `POST` with `Authorization: Bearer <ttsAuthToken>`. Voice ids are namespaced with a `tts_api__` prefix, then `__`-separated `vendorId__sourceVoiceId`; the audio URL is resolved defensively from several possible response shapes (`audioUrl`, `url`, `data.audioUrl`, `data.result.audioUrl`, `data.audio.url`). Credits model from `/api/tts/user`: `{credits, freeMessages, freeMessagesMax, subCredits, subCreditsMax, proCredits, used}`.

### 2.5 Bridge userscript network calls

`GET /extension/tiktok_live_bridge_electron.user.js?c=electron&v=<ts>` returns the whole bridge (downloaded at every boot; failure is fatal — error dialog and quit). `source-res\main.js`.

Bridge message types and errors: `im_enter_room`, `WsActiveV2`, `WsUpgradeDone`, `WsUpgradeOffered`, `WsClosedV3`, `WsError`, `AckError`, `HBAckErrorV2`, `EnterRoomError`, `noLogin`, `sendChatMsgErrorNGV4`, `getRanklistError`, `AgencyError`. `api-map.md` §3.

### 2.6 Widget transport protocol

Widgets are static pages under `/widget/<slug>` served to OBS browser sources. `widget\socketioclient.js`, `widget\sharedio\sharedio.js`, `widget\sharedio\sharedioworker.js`.

- Widget id = third path segment. Params: `cid` (channel), `screen`, `preview=1`, `ioHost`, `disableSharedIO=1`, plus per-widget `metric`, `c` (gift counter), `x`.
- Transport: one Socket.IO connection per origin via a `SharedWorker`, `transports:["websocket"]`, `upgrade:false`, `query:{appType:"widget", shared:true}`. Per-channel connection map; `login` emitted as `{channelId, appType:"widget", receiveChat, receiveGift}` where `receiveChat` is true for chat/emojify/streambuddies and `receiveGift` for gift/firework/cannon.
- `reportWidgetState` emit: `{widgetId, screenId, state, isHidden, isPreview}`. `state.event` is `alive` every 120 s and `widgetSettingsAck` after settings arrive.
- `widgetSettings` inbound: the whole settings object; cached to `localStorage.cachedSettings`; preview mode always replays the cache instead.
- `migrationStatus` inbound: `{status:"migrated", targetUrl}` triggers full navigation to the new base, preserving path and query.
- Preview harness: parent `postMessage` of `{type:"framePreviewPing"}` calls `window.preview()`; `{type:"frameTestEvent", eventName, eventData}` is routed through a wrapped `io.on` into a fake emit.
- Widget errors POST to `/api/logError?origin=widget` with `{type:"Widget Error", channelId, screenId, path, message, file, line, column, stack}`, capped at 100 distinct entries.
- `getUserThumbnailUrlFromUserId` → `/img/user/{cid}/{userId}`, falling back to `/img/nothumb.webp`.
- `setFontSettings` reads `{widgetId}_fontType|_fontSize|_fontLineSpacing|_fontLetterSpacing|_rightToLeft`; size 50 is the neutral value; `myactions` uses zoom percent while others use `html` em. `goal`/`countdowngoals` insert the `metric` segment; `gcounter` inserts the counter id; `lastx` inserts `x`.

### 2.7 Widget event names and payload shapes (observed in page code)

| Event | Payload fields (as consumed) |
|---|---|
| `chat` | `profilePictureUrl`, `nickname`, `uniqueId`, `comment`, `isSubscriber`, `isModerator` |
| `gift` | `repeatCount`, `diamondCount`, `giftType`, `userId`, `giftId`, `repeatEnd`, `profilePictureUrl`, `giftPictureUrl`, `nickname`, `uniqueId`, `describe` |
| `giftCannon` | gift payload (cannon overlay) |
| `newTransaction` | `show`, `description`, `thumbnailUrl`, `userId`, `amount` |
| `updateFollowerCount` | `followerCount`, `progress`, `sessionStartCount`, `personalBestSessionStartBest` |
| `updateViewerCount` | `viewerCount` |
| `updateTopGifter`, `updateTopLiker`, `updateRanking` | array of `{totalAmount, username, nickname, profilePictureUrl}` |
| `goalStatus`, `testGoal` | goal state object |
| `giftGoalStatus`, `testGiftGoal` | goal state object (1/2/3 counters) |
| `countdownGoalsStatus` | countdown goal payload |
| `executeAction` | `actionInfo{id, screenId, imageUrl, audioUrl, videoUrl, animationUrl, text, textToSpeech}`, `context{thumbnailUrl, …}` |
| `actionsChanged` | none — triggers page reload |
| `controlpageConnected` | none — clears cached state |
| `coin-match:start/update/result/reset` | start → settings; update → `{countdown, entries}`; result → `{winners}` |
| `coin-jar:gift`, `coin-jar:reset` | jar payload |
| `christmas-event:gift`, `:state`, `:update` | event payload |
| `collectCoin`, `createCoins`, `timeoutCoins` | coin-drop payload |
| `showCatchItem`, `collectCatchItem` | subscriber-catch payload |
| `dockData` | relayed into the activity-feed iframe via `postMessage` |
| `timerUpdate` | timer state |
| `spinWheel`, `onSpinWheel` | wheel spin payload |
| `guestBattleState` | guest-battle state |
| `penaltyBoard`, `penaltyShot` | penalty-battle state |
| `quizState` | quiz state |
| `setMemory`, `openMemoryFields`, `clearMemory`, `setMemoryRanking` | memory widget ops |
| `onLikeReceived` | like payload |
| `topGiftData` | top-gift payload |
| `setPlaylistItems` | song-request playlist |
| `showCommandResult`, `showCommands`, `showCustomCommands` | command-info widget |
| `showCatchRanking`, `showCatchUserStats` | subscriber-catch info |

Gift value is computed **locally** as `diamondCount * repeatCount` when `repeatCount > 0`, else `diamondCount` — never read from the source. `widget\gifts.html`.

### 2.8 Bridge → app message contract

`window.opener.postMessage({app:'tfbridge', type, info, binary}, '*')`; the app fans these out to dAPI clients. `api-map.md` §4.

---

## 3. Data Entities

### 3.1 TikTok protobuf schema (client parser)

The app embeds a full `.proto` (package `TikTok`) and decodes with protobufjs. Reconstructed schema, message → fields:

| Message | Fields |
|---|---|
| `WebcastResponse` | `messages[]` (`{type, binary}`), `cursor`, `fetchInterval`, `serverTimestamp`, `internalExt`, `fetchType` (1=ws, 2=polling), `wsParam`, `heartbeatDuration`, `needAck`, `wsUrl` |
| `WebcastWebsocketMessage` | `id`, `type`, `binary` |
| `WebcastWebsocketAck` | `id`, `type` |
| `WebcastRoomUserSeqMessage` | `topViewers[]{coinCount, user}`, `viewerCount` |
| `WebcastChatMessage` | `event`, `user`, `comment`, `visibleToSender`, `emotes[]{placeInComment, emote}`, `userIdentity` |
| `WebcastMemberMessage` | `event`, `user`, `actionId` |
| `WebcastGiftMessage` | `event`, `giftId`, `repeatCount`, `user`, `repeatEnd`, `groupId`, `giftDetails`, `monitorExtra`, `giftExtra`, `userIdentity` |
| `WebcastGiftMessageGiftDetails` | `giftImage{giftPictureUrl}`, `giftName`, `describe`, `giftType`, `diamondCount` |
| `WebcastGiftMessageGiftExtra` | `timestamp`, `receiverUserId` |
| `WebcastSocialMessage` | `event`, `user`, `followerCount` |
| `WebcastLikeMessage` | `event`, `user`, `likeCount`, `totalLikeCount` |
| `WebcastSubNotifyMessage` | `event`, `user`, `exhibitionType`, `subMonth`, `subscribeType`, `oldSubscribeStatus`, `subscribingStatus` |
| `WebcastQuestionNewMessage` | `questionDetails{questionText, user}` |
| `WebcastEmoteChatMessage` | `user`, `emote{emoteId, image{imageUrl}}` |
| `WebcastEnvelopeMessage` | `treasureBoxData{coins, canOpen, timestamp}`, `treasureBoxUser` |
| `WebcastRoomMessage` | `roomMessageContainer{messageType, msgId, roomId, createTime, roomMessageDetails{notifType, wrapper{userContainers{user}}}}`, `type` |
| `WebcastControlMessage` | `action` |
| `WebcastLinkMicBattle` / `…Armies` | battle users, `battleStatus`, host ids, points |
| `WebcastMessageEvent` | `msgId`, `createTime`, `eventDetails{displayType, label}` |
| `WebcastLiveIntroMessage` | `id`, `description`, `user` |
| `WebcastHourlyRankMessage` | `data{rankings{type, label, rank{colour, id}}}` |
| `User` | `userId`, `nickname`, `profilePicture{urls[]}`, `uniqueId`, `secUid`, `badges[]`, `createTime`, `bioDescription`, `followInfo` |
| `FollowInfo` | `followingCount`, `followerCount`, `followStatus`, `pushStatus` |
| `UserBadgesAttributes` | `badgeSceneType`, `imageBadges[]`, `badges[]`, `privilegeLogExtra{privilegeId, level}` |
| `UserIdentity` | `isGiftGiverOfAnchor`, `isSubscriberOfAnchor`, `isMutualFollowingWithAnchor`, `isFollowerOfAnchor`, `isModeratorOfAnchor`, `isAnchor` |

Message types decoded (the `case` list): `WebcastControlMessage`, `WebcastRoomUserSeqMessage`, `WebcastChatMessage`, `WebcastMemberMessage`, `WebcastGiftMessage`, `WebcastSocialMessage`, `WebcastLikeMessage`, `WebcastQuestionNewMessage`, `WebcastLinkMicBattle`, `WebcastLinkMicArmies`, `WebcastLiveIntroMessage`, `WebcastEmoteChatMessage`, `WebcastEnvelopeMessage`, `WebcastSubNotifyMessage`, `WebcastRoomMessage`. Config exposes `skipMessageTypes`. `ui\mirror\combo\app.deob.js` (client-parser module).

### 3.2 Normalized user shape built by the app

`{userId, nickname, profilePictureUrl, followRole, userBadges, userSceneTypes, userDetails{createTime, bioDescription, profilePicture…}}`, plus derived helpers `getUserThumbnailUrlFromUserId`, `generateUsernameCell`, `openTiktokProfile`, and a `usernameCache` + `userNicknameMappings` layer. `ui\mirror\combo\app.deob.js`.

### 3.3 Session shape

Bootstrapped on the client before any request: `window.session = {channelId, isCrawler, affId, agencyId, agencyAffiliateId, isElectron, isWindows, originalUrlParams, fromGAds, me, channel, agencyAffiliateId}`. `affId` resolution order: `settings.affId` → `localStorage.affId` → `?aff=` → `?ref=`. `agencyId`: `?agency=` → `localStorage.agencyId`. `agencyAffiliateId`: `?agency-affiliate=` → `settings` → `localStorage`, and it is nulled if the same id is in `localStorage.dismissedAgencyAffiliateId`. `ui\mirror\combo\app.deob.js`.

`/api/init` response consumed: `countryCode`, `appVersion`, `serverTime`, `siteNoticeHtml`, `maintenance`, `modules` (must be truthy), `flags`, `sent`, plus nested `user` and `config`. `/api/public` / `/api/config`: `{modules, settings, publicSettings, payment:{enabled}, discounts}`.

### 3.4 Action entity (Actions & Events)

Fields present in the action form schema and modal: name, screen, animation, audio, image, video, duration, enabled. Modal options: `activate_obs_source`, `switch_obs_scene` (with `obsSceneId`, `obsSourceId`, behavior 1/2), `play_audio` (+ sound volume), `play_video_file` (`videoFile`), `play_video_youtube` / `play_video` (`videoUrl`), `show_animation` (`animationUrl`), `show_image` (`imageUrl`), `show_text` (`text`), `play_text` overlay settings, `speak_text` (`textToSpeech`, TTS hints), `send_text` (`message`), `keystroke` (`keystrokes`), `trigger_mccmd` (`mcCmd`, editor + hint), `trigger_webhook` (`webhookUrl`), `exectpaction` (PowerShell), `streamerbotaction` (`streamerbotActionId`), `voicemodvoice` (`voicemodVoiceConfig`), `set_snapcam_effect` (`snapCamEffectId`), `controltimer` (`timerSeconds`), `controlcustomgoal` (`customGoalConfig`), `points_add`/`points_remove` (`amountToAdd`, `amountToRemove`), `thirdPartyAction`. Behaviour flags: `cooldown`, `cooldown_user` (per-user cooldown), `enable_fade`, `enable_skip_on_next`, `enable_streak` (gift-combo repeat). `ui\mirror\index.html` (`data-attribute` set + `actionsandevents_actions_modal_*` keys).

Runtime execution payload seen in `myactions.html`: `{id, screenId, imageUrl, audioUrl, videoUrl, animationUrl, text, textToSpeech}` plus a `context` object.

### 3.5 Event/trigger entity

Trigger types: `trigger_chat`, `trigger_command`, `trigger_gift_specific`, `trigger_gift_min` (+ `min_amount`), `trigger_gift_likes_min` (+ `min_likes_amount`), `trigger_follow`, `trigger_join`, `trigger_raid`, `trigger_subscribe`, `trigger_invite`, `trigger_shop_purchase` (+ `product_name`), `trigger_emote_specific`, `trigger_fanclub_sticker_specific`, `trigger_sticker_specific` (global + partner sections), `trigger_first_activity`. Audience filters (`which_*`): `any`, `followers`, `moderators`, `specific_user`, `subscribers`, `topgifter` (+ `topgifter_n`). Additional gates: `mintriggerlevel`, `mintriggerteamlevel`, `cmd`/`command` + `customcommand` with sub-commands, `emote`, `fan_club_sticker`, `subscriber_emote`, `through_which`. Action binding: `select_action` or `select_action_random`. `ui\mirror\index.html`.

Timer events: interval + bound action (`actionsandevents_timerevents_interval`, `..._action`).

Screens: name, queue size, online/offline status (`actionsandevents_screens_list_*`), plus `queue size` gating per screen.

### 3.6 Transaction entity

`{userId, username, amount, description, isReward, isManual, createdAt}`, with `show` gating for the widget, and reward/penalty actions (`goal_action_increase|_double|_reset|_hide|_unchanged`, `memory_action`, `subtraction`, `mintriggerlevel`). REST paths `rest/transaction` and `rest/transaction/<id>`. `ui\mirror\index.html`, `ui\mirror\combo\app.deob.js`.

### 3.7 Goal / counter entities

Goal metrics: `coins`, `likes`, `follows`, `shares`, `subs`, `points`, `viewer`, `custom1..custom3`. Gift counters 1/2/3 (`data-giftcounterid`), with `giftGoalValues` reset behavior on new broadcast. Graphic overlay types: `pure`, `blackwhite`, `pixelart`, `pixelworld`, `military`, `kawaiicats`, `sakura`, `champion`, `chroma`, `breakpoint`, `unique`. `ui\mirror\index.html`, `api-map.md` §10d.

### 3.8 Notification entity

`{id, category, payload, data, isSeen, isChristmasGift}`; list/count/markAll/read/seen all operate on it. `isChristmasGift` can appear at top level, in `payload`, or in `data`, with `category === "christmas"` as an equivalent signal. `ui\mirror\combo\app.deob.js`.

### 3.9 Agency entities

Agency, talent, application, verification (3-step, with code send/validate and `verification/auto`), affiliate, discount modal, registry search with filters and region. `ui\mirror\index.html`, `ui\mirror\combo\app.deob.js`.

### 3.10 Settings model (the largest entity)

- Key prefix `setting_`, keys lowercased, stored in `localStorage`.
- `clientOnlySettings` never leave the device. Confirmed list: `lastXData`, `cachedMetrics`, `pendingLogin`, `loginAccessToken`, `loginAccessTokenProvider`, `channelId`, `channelname`, `channelSignature`, `apiAuthToken`, `extensionSecret`, `lang`, `langLastUpdate`, `cachedSettings`, `quickLogin`, `authProvider`, `disabledControls`, `pusherTransportTLS`, `spotify_accessToken`, `spotify_refreshToken`, `spotify_nativeAccessToken`, `spotify_nativeUpgradeDone`, `chestLikeOffset`, `browserId`, `subcatchsettingsintervalslider`, `debug`, `quizRankUsers`, `__paypal_storage__`, `timerState`, `electronWelcome`, `switchedToNewProfile`, `settingsImportDone`, `patreonUserId`, `patreonPageOpened`, `broadcastGifts`, `broadcastEmotes`, `dcoauthstate`, `coinstatsMonthly`, `gifterstatsMonthly`, `gameCompatibilityModeLastState`, `customGoalValues`, `countdownGoalCustomValues`, `proVoiceUsageDay`, `proVoiceUsageCount`, `emoteUpdatePopup`, `remoteAuthCallbackId`, `agencyId`, `affId`, `agencyAffiliateId`, `agencyDiscountInitialShown`, `agenciesIntroShown`, `likeathonUpdateNotice`, `fireworkUpdateNotice`, `newOverlayUpdateNotice`, `proExpireUpgradeRemindedAt`, `topLikerCache`, `topGiftStatus`, `giftGoalValues`, `promoWidgetBannerLastClose`, `mobilevouchercodeinput`, `followercounter_lastCount`, `followercounter_lastDisplayName`, `followercounter_lastProfilePictureUrl`, `followercounter_personalBestSession`, `widget_penaltybattle_leaderboard`.
- Prefix rules: `ph_*` and `_g*` are always local. `chatbotsnippet*` keys are local by prefix.
- Save: debounced; on any non-local change it POSTs the whole non-local map to `updateSettings` plus `destinationProfileId` (from `session.me.profile.profileId`) and, when present, `agencyAffiliateId`.
- Restore: clears stale `chatbotsnippet*` keys, writes incoming values, reloads the page if anything changed unless a callback was supplied, then re-inits chatbot snippets and the snippet grid.
- `set()` dispatches a `storage-update` CustomEvent `{field, value}`.
- `ui\mirror\combo\app.deob.js` (settings block).

### 3.11 Wrapper fields

`cachedMetrics`, `widgetStats`, `widgetStates`, `activeWidgets`, `lastServerPingTs`, `channelId`, `auth`, `proToken`, `instanceId`, `appType`, `onServerPing`, `onProUpgrade`, `onProUnlock`, `onTtsTopUp`, `onWidgetState`, `overloadSettings`/`setOverloadSettings`, `setPluginSettings`. `ui\mirror\combo\app.deob.js`.

### 3.12 Local harness session shape (substitute, not product)

`{token, user:{id, email, displayName, username, role, apiKey, isProUser, proExpireDate, countryCode, channelId}}`, with `channels: []` and `settings: {}` in `local-data.json`. `deob\local-api.js`.

---

## 4. Rules, Automation, and Scheduling

### 4.1 Event → Action engine

An event (trigger + audience filters + thresholds) is bound to one action or to a random pick from a set. On match, the app emits `executeAction` to widgets, keyed by `screenId`. Widgets that are not the target screen ignore it; widgets with no media payload (`imageUrl`, `audioUrl`, `videoUrl`, `animationUrl`, `text`, `textToSpeech` all absent) ignore it. `ui\mirror\widget\myactions.html`.

### 4.2 Throttling and rate control

Per-action `cooldown` (global) and `cooldown_user` (per user). Queue size is a screen-level property. Execution-queue overflow is surfaced as `actionsandevents_action_exec_queue_limit_warning`, and a screen that is not online produces `actionsandevents_action_exec_screen-offline_error`. Client-side widget queue guard: `actionIdQueue.length > 1000` drops work; `preloadImageQueue` is capped at 30. `ui\mirror\index.html`, `ui\mirror\widget\myactions.html`.

### 4.3 Scheduling

- **Timer events**: fixed interval bound to an action.
- **Halving**: percentage-based halving of a pool, with last-execute timestamp and before/after examples in the help text.
- **Likeathon**: like counter with optional `decreaseSpeed`.
- **Challenges**: `startChallenge` / `endChallenge`; transactions are blocked during an active challenge (`transactions_list_no_data_during_challenge`).
- **Coin drop**: coin amount, coin value, command, timeout, single-collect-per-user, and an automation mode with its own interval. `ui\mirror\index.html`.
- **Wheel**: cost, delay, max normal win, chat-gamble max amount, main-win action; `spinWheel` broadcast with an announce duration.
- **Song requests**: play/skip costs, queue length, per-user queue length, explicit-content flag, commands-enabled-for list, and a "permanently enabled" mode. `ui\mirror\index.html`.
- **Gift browser**: bulk download of selected/all gift images, progress events, ZIP packaging, sorting by value or newest, pagination.
- **Quiz**: `quizState` broadcast, ranking users cached client-side.
- **Penalty battle**: board + shot events, per-widget leaderboard setting.
- **Guest battle**: `guestBattleState` broadcast.

### 4.4 Live-state rules (observed)

- Gift streaks: a streak key is `streak_{userId}_{giftType}_{giftId}`; `giftType === 1` reuses and updates the existing row; `repeatEnd` closes the streak. `ui\mirror\widget\gifts.html`.
- Chat widget caps at 100 rows, trimming the oldest 50.
- `last_seen_*` and `followercounter_personalBestSession` track session-relative and best-ever counts.
- `resetGiftGoalsOnNewBcCheckbox` resets gift goals on a new broadcast.
- Widget self-health: `alive` heartbeat every 120 s; state reported every 2 s by `myactions`; `lastStateObj` cleared on `controlpageConnected` and after 20 s; page reload every 3 hours.
- Widgets restart-resilient: the server answers fresh loads with a 302 to a new base URL, and `migrationStatus` pushes the same migration to already-open sources. `ui\mirror\widget\socketioclient.js`.

### 4.5 Automation targets the engine drives

Screen/OBS control (activate source, switch scene, two behavior modes), keyboard strokes, Minecraft command, webhook, PowerShell, AutoIt, Streamer.bot, Voicemod, SnapCam effect, TTS, points add/remove, timer control, custom-goal control, third-party action.

### 4.6 Chat commands

Built-in: `help`, `score`, `send`, `spin`, `coindrop`. Custom commands with sub-commands and a user-level tier. `ui\mirror\index.html`.

---

## 5. UX Affordances

**Navigation pages** (from `data-pageid`): `start`, `setup`, `user`, `actionsandevents`, `chatbot`, `chatcommands`, `goals`, `countdowngoals`, `lastx`, `timer`, `transactions`, `giftoverlays`, `graphicoverlays`, `obsoverlays`, `obsdocks`, `coindrop`, `wheel`, `songrequests`, `challenge`, `halving`, `likeathon`, `dapi`, `rtmpgen`, `christmasevent`, `sounds`, `tts`, `agencyregistry`, `agencyapplications`.

**44 widget surfaces** (`data-widgetid`): activity-feed, cannon, carousel, chat, christmasevent, coindrop, coinjar, coinmatch, commandinfo, countdowngoals, emojify, fallingsnow, firework, followercount, gcounter, gifts, goal, guestbattle, likefountain, memory, myactions, overlay, penaltybattle, quiz, ranking, socialmediarotator, songrequests, streambuddies, subcatch, subcatchinfo, talking, timer, tinydiny, topg, topgifter, topliker, tops, transactionviewer, userinfo, viewercount, webcam, wheel, wheelofactions, worldcupticker.

**Setup page sections**: account, channel name, currency name, level system (level + points + multiplier), subscriber bonus percentage, coin reset, points system, OBS connection, Streamer.bot connection, Minecraft connection, mobile voucher, upgrade/discount. `ui\mirror\index.html`.

**Cross-cutting UX patterns**
- Live preview for every widget (`preview=1` plus a `window.preview()` function and a `framePreviewPing` driver); `myactions` additionally accepts `onStartPage=1`.
- Per-widget "Test" event next to every state event (`testGoal`, `testGiftGoal`) and a "Play/Test" button on every action — the documented troubleshooting path. `ui\mirror\docs\faq-en.md` lines 11–15.
- Inline error surfacing with a deduplication log, batched to the server, plus a global toast for unexpected API failures.
- Screen online/offline status in the UI, tied to whether the browser source is actually loaded in OBS/Live Studio. `faq-en.md` line 15.
- Settings import/export with a completion flag; a "duplicate name" guard on actions and events; unsaved-changes prompts.
- Multi-account detection with a relogin prompt, and a legacy-login migration path with a request token. `api-map.md` §10d.
- Pro-gated surfaces are visibly locked rather than hidden (`showProUpgrade`, `ACTIONS_DOWNGRADE_LOCKED`, `userFeatures`).
- Trials: banner, countdown, offer variants, upgrade-reminder timestamps.
- TTS UX: free daily messages, AI-voice credits, top-up modal with pack selection, subscription refresh, purchase history with invoice download, and a daily-limit modal.
- Widget typography controls: family, size, line spacing, letter spacing, and RTL direction.
- Loading robustness: a staged loader (`appInitStage` 1→4), 7 s soft warning, 30 s hard timeout, one automatic `reload=1` retry with cache-busting, and per-script load counters surfaced in the UI. `ui\mirror\js\init.js`.
- SEO/SSR shell: server-rendered page content is shown to crawlers, stripped and hidden for humans to improve page-speed metrics. `ui\mirror\js\init.js`.
- Mobile: a fixed 1200 px viewport, audio unlock on touch, a mobile promo, and phone-usable sound alerts (app must stay open). `ui\mirror\js\init.js`, `faq-en.md` line 24.

---

## 6. Deliberate Behavior Worth Reimplementing

1. **Runtime-downloaded main process.** The shipped binary is a loader. This makes the app patchable, but it means the app is unrunnable without its host. If you reimplement, prefer bundling the main process and treat remote logic as an update channel with a pinned fallback.
2. **Every error path fails closed and loudly at boot.** A failed bridge or main-process download shows an error dialog and quits rather than starting degraded. Correct for security; worth copying.
3. **Gift value is computed locally** as `diamondCount * repeatCount`, never read from the platform. This is the single most important rule for a stream-alert product: trust no upstream price.
4. **One request wrapper for the whole app.** A single `doAction` with auth injection, token refresh from the response header, and deduplicated batched error reporting keeps failure modes uniform.
5. **Settings live in `localStorage` and sync opportunistically.** A debounced full-map `POST` on any non-local change, with an explicit client-only allowlist, gives instant UI with eventual consistency. The allowlist is the security boundary — treat it as such.
6. **Widgets are unprivileged.** Each is a static page with a `SharedWorker`-shared single socket, receiving a broadcast settings object and reporting a liveness heartbeat. No per-widget auth, no secrets in the page. This is a good isolation model for OBS browser sources.
7. **Two independent liveness channels for overlays.** The server issues a 302 on fresh loads, *and* pushes a migration to already-open sources. The comment in `socketioclient.js` explains why: a browser source can sit for days without reloading and the streamer would never notice a dead overlay. Copy this reasoning.
8. **Single socket connection per origin.** The `SharedWorker` map keyed by channel avoids N sockets for N overlays, and re-emits `login` on reuse so settings flow again.
9. **Conditional event subscriptions.** `receiveChat` and `receiveGift` are derived from the widget path, so most overlays never receive chat or gift traffic.
10. **Preview mode reuses the production event path.** The preview harness wraps `io.on` and routes synthetic events through the same dispatch, so previews exercise real handlers. In preview, `widgetSettings` is deliberately replaced by the local cache to keep previews stable.
11. **Debounced, deduplicated, self-limiting error reporting.** Both app and widget cap and dedupe before sending; widget errors are tagged with widget id, screen id, and path so a broken overlay is identifiable from the server log.
12. **The dAPI is a local socket, not a cloud dependency.** OBS and external tools talk to `127.0.0.1:21213`. If you reimplement, keep the event bus local and make cloud optional.
13. **Feature flags gate capability, not correctness.** The GRU middleware and autoupdater both hang off flag delivery via one IPC action, so a missing service never blocks startup.
14. **Definitive failure signaling on auth.** The legacy-login path marks errors `definitive` and carries response text, distinguishing "wrong credentials" from "network broke" — the UI can then offer the right next step.
15. **Session reset is a hard reset.** `resetTiktokSession` clears cookies and storage for all TikTok origins, deletes the cookie backup, then relaunches. One escape hatch that genuinely returns to a clean state.
16. **TTS voice ids are namespaced and parsed defensively.** `tts_api__<vendor>__<voice>` keeps local and AI voices in one list while staying routable; the audio URL is probed across several response shapes because the backend contract is not fixed.
17. **Loud, honest failure in the local substitute.** `deob\local-api.js` returns real-shaped empty responses rather than fake data, and the TTS endpoints answer with an explicit "disabled" error. Absence of data is never disguised as data.
18. **Planned but unimplemented direction (from `plan2.md`, not shipped behavior):** local-first auth with an Argon2id-derived key wrapping an AES-256-GCM vault, rotating refresh tokens, Windows Hello/DPAPI device binding, append-only audit log, and a TTS fallback chain (local model → edge → OS speech). This is a reasonable target architecture for a stage-2 cloud migration, and it is consistent with the repo's existing "secrets stay local" stance.

### Known gaps (fail gracefully, do not block)

Cloud TTS, TikTok signature service, user-name lookups, and the payment gateways fail silently. Login and the dashboard-account surface are stubs in the local harness by design. `what-i-end.md` 2026-09-25, `plan.md` Stage 5.

---

## Where I stopped and what is not covered

Two areas are documented from config keys and call sites rather than from traced runtime logic, so treat them as structural outlines rather than verified behavior:

- **Server-side implementation of `/api/*`.** Only the client contract is recoverable from these artifacts. Response shapes are inferred from consumption sites; the standalone stubs in `deob\local-api.js` are the previous engineer's guesses, not the real server's shapes.
- **dAPI payload schema.** The public event surface is real (it is the widget event table), but the exact dAPI envelope and the per-service versioning implied by the `service`/`version` query params are not documented anywhere in the tree. `G:\re\tikfinity\deob\strings-report.txt` has the string fragments; nothing has been reconstructed from them.

Also note: `rg` is unavailable in this environment, and `G:\re\tikfinity\deob\strings-report.txt` reads as binary through the file tool, so searches there need `Get-Content -Encoding UTF8`.