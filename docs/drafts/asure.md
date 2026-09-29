Thoroughness: medium.

Goal: I need a precise description of the UI/UX design of the "asure" project at G:\re\asure, so it can be used as a visual/UX reference for a new app. Do NOT copy any code, assets, or branding — I only want a written structural + design description (layout, screens, panels, navigation, color scheme, spacing, interaction patterns, terminology used in the UI, in Arabic/English as it appears).

Look at (in priority order):
- G:\re\asure\mine  (the user's own attempt at asure — read its frontend source: look for apps/*/src, any React/Vue/TSX/HTML files, and any CSS/Tailwind config or design tokens)
- G:\re\asure\findings.md
- G:\re\asure\tauri-map.md
- G:\re\asure\tauri-commands-exe.txt and tauri-commands-extracted.txt (list of commands/features)
- G:\re\asure\live-capture (screenshots, DOM dumps, HAR files) — describe the screens/sections you can see in filenames and any DOM structure or class names that reveal layout
- G:\re\asure\sweep.json, api-from-js.json, invoke-calls.jsonl (feature surface)

Report back, in markdown, with:
1. Screen inventory (what screens/tabs/modals exist, and the navigation model between them).
2. For each important screen: the layout structure (sidebar? topbar? grid?), the main widgets, and the key interactions.
3. Design system: colors (hex if discoverable), typography scale, spacing, radius, component vocabulary (buttons, cards, tables, modals, toasts).
4. Feature surface: the full list of features/services you can infer, grouped by area (streaming, gifts, rules/automation, accounts, files, settings, etc.).
5. Any UX flows described in findings.md (onboarding, connect account, run rule, etc.).

Be concrete and detailed but do not dump whole files. Cite file paths for each claim.

-------------

## Asure Live — UX & Design Reference (Part 1 of delivery)

I cannot write files (read-only search role), so the report is delivered here. The i18n dictionary that was previously listed as "not found" is now fully recovered — it is embedded in the RSC flight payload of the captured dashboard HTML, not in the JS chunks.

---

# 0. Evidence base & method

| Rank | Source | Reliability |
|---|---|---|
| 1 | `mine\static\dashboard\games.html` RSC flight payload | **Authoritative** — real SSR strings, real FR+ES dictionary, real `data-tour` ids |
| 2 | `mine\static\_next\static\chunks\07agub.ca46qd.js` | Authoritative — rules engine, tour, game configs, schemas |
| 3 | `mine\static\_next\static\chunks\0rfx046qzzore.js` | Authoritative — game catalog + launcher state machine |
| 4 | `mine\static\_next\static\chunks\0mx1eq_41vqvc.js` | Authoritative — overlay registry, fonts, effects |
| 5 | `mine\static\_next\static\chunks\014dnx7zuo5wp.js` | Authoritative — locale list, news catalog validator |
| 6 | `live-capture\asure.live___next__static__chunks__16rhs.nw2689f.css__css` | Authoritative — tokens, keyframes, reduced-motion |
| 7 | `artifacts\boot.html` | Corroborating — embedded startup mirror, dark tokens |
| 8 | `findings.md`, `tauri-map.md`, `api-from-js.json`, `invoke-from-js.json` | Structural, Rust/endpoint evidence |
| 9 | `frontend-cache\f_00000f.html` (Arabic) | **Reconstructed** — terminology only, not visual truth |
| 10 | `sweep.json`, route DOM captures | Unreliable — 573 errors, duplicated hydrated content |

**Key methodological win:** the dictionary is not a separate asset. It ships inside the RSC flight payload as one object rooted at `"sidebar":{"expand":…`, ~228 KB, and `"locale":"fr"` terminates it. A sibling chunk carries `"locale":"es"`. So the app is a **client-rendered dashboard with server-injected copy**, not static strings.

**Locale list (exact, from `014dnx7zuo5wp.js`):**
```js
["es","en","pt","it","fr","id"]
```

---

# 1. Screens & routes

## 1.1 Route inventory

| Route | Nav label (FR) | Section | Evidence |
|---|---|---|---|
| `/dashboard` | Accueil | Outils | flight route tree |
| `/dashboard/novedades` | Nouveautés | Outils | `novedades` namespace |
| `/dashboard/games` | Minecraft | Outils | `juegos` + `0rfx` chunk |
| `/dashboard/roblox` | Roblox | Outils | `roblox.catalog` |
| `/dashboard/games/arcade` | Arcade | Outils | `juegos.arcade` |
| `/dashboard/alerts` | Actions et Événements | Outils | `acciones` namespace |
| `/dashboard/extensions` | Extensibles | Outils | `extensions` namespace |
| `/dashboard/tts` | Synthèse Vocale | Audio | `tts` namespace |
| `/dashboard/tts/ai-voices` | Clonage de Voix | Audio | `ttsPremium` |
| `/dashboard/sound-alerts` | Alertes Sonores | Audio | `soundAlerts` |
| `/dashboard/overlay-studio` | Studio d'overlays | Visuels | `editor` namespace |
| `/dashboard/overlays#fan-club` | Club de Fans | Visuels | `overlays.categories` |
| `/dashboard/overlays#gifts` | Cadeaux | Visuels | `overlays.gifts` |
| `/dashboard/overlays#leaderboards` | Classements | Visuels | `overlays.tops` |
| `/dashboard/overlays#goals` | Objectifs | Visuels | `overlays.goals` |
| `/dashboard/overlays#special` | Spéciaux | Visuels | `overlays.special` |
| `/dashboard/videos` | Vidéos | Visuels | `videos` namespace |
| `/dashboard/integrations/minecraft/rcon` | RCON Minecraft | Intégrations | `rcon` namespace |
| `/dashboard/integrations/vtube-studio` | VTube Studio | Intégrations | `vtubeStudio` |
| `/dashboard/integrations/tits` | T.I.T.S. | Intégrations | `tits` |
| `/dashboard/integrations/streamerbot` | Streamer.bot | Intégrations | `streamerbot` |
| `/dashboard/integrations/key-triggers` | Raccourcis clavier | Intégrations | `keyTriggers` |
| — | Stockage | Paramètres | `storage` namespace |
| `/dashboard/simulator` | Simulateur | Paramètres | `simulator` |
| `/dashboard/integrations/minecraft/users` | Minecraft | Paramètres › Utilisateurs | `mcUsers` |
| `/dashboard/integrations/roblox/users` | Roblox | Paramètres › Utilisateurs | `roblox.users` |
| `/dashboard/referrals` | Invite et gagne | Paramètres | `referrals` |
| `/dashboard/preferences?feedback=1` | Suggestions et bugs | Paramètres | `support` namespace |
| `/dashboard/preferences` | Préférences | Paramètres | `interfaz` / `configuracion` |
| — | Mon forfait | Paramètres | `suscripcion` namespace |

## 1.2 Per-screen copy (verbatim from the FR dictionary)

**Overview / dashboard** — `Tableau de bord` / `Panneau de contrôle de votre live`
- Stats: `Messages illimités`, `Caractères utilisés`, `Statut TTS`, `Statut TikTok`
- Panels: `Activité en direct` (`Aucune activité récente. Connectez votre TikTok Live pour commencer.`), `Historique TTS` (`Aucun message TTS n'a encore été reproduit`)
- Cards: `Text-to-Speech` → `Configurer TTS`; `Connectez votre TikTok Live` → `Connecter TikTok` / `TikTok connecté avec succès` / `Déconnecté`
- `Actions rapides`: `Configurer TTS` ("Choisissez la voix, la vitesse et le ton pour vos messages."), `Paramètres généraux` ("Gérez votre compte TikTok et vos préférences.")
- Activity feed verbs: `vous a suivi`, `a envoyé`, `a donné`, `likes`, `a rejoint le live`, `Cadeau`; `Utilisateur`, `Voir le profil de {name}`, `Effacer`

**Stockage** — `Stockage` / `Gérez vos vidéos, sons et images téléversés`
- Gates: `L'app de bureau est requise` (+ "La gestion de votre stockage média nécessite l'app de bureau."), `Mettez l'app à jour` ("Cette version de l'app n'inclut pas encore le stockage de médias.")
- Usage: `Espace utilisé`, `{used} sur {total}`, `Libre`
- Tabs: `Vidéos` · `Sons` · `Images` · `GIFs` · `Tous` · `Fichiers`
- Upload: `Téléverser des fichiers`, `Glissez des fichiers ici ou cliquez`, `Vidéos, sons et images sont triés automatiquement`, `Format non pris en charge`, `{n} prêts à téléverser`, `{n} ignorés`, `Téléverser {n}`
- Sort: `Nom` · `Date` · `Taille`; delete: `Supprimer {n} fichiers ? Action irréversible.`; `Aucun fichier ici pour l'instant.`

**Mon abonnement** — `Mon abonnement` / `Gérez votre forfait et votre mode de paiement`
- `Forfait actuel`; `Gérer l'accès`
- Status enum: `Actif` · `Essai gratuit` · `Pass temporaire` · `Annulé` · `Aucun abonnement`
- Payment sources: `Stripe` · `PayPal` · `Essai gratuit` · `Pass d'accès`
- `Prochain renouvellement` · `Votre accès se termine le` · `{days} jours restants` · `Accès jusqu'au {date}` · `Se renouvelle le {date}`
- Actions: `Gérer l'abonnement` · `Réactiver l'abonnement` · `Ouvrir le portail Stripe` · `Gérer dans PayPal`
- `Annulé — vous conservez l'accès jusqu'à la fin de la période payée`
- No-sub: `Aucun abonnement actif` → `S'abonner maintenant`

**Préférences › Interface** — `Interface` / `Personnalisez l'apparence de l'application`
- `Couleur de l'app` / "Choisissez la couleur principale de l'interface. Le changement est instantané."
- **Accent palette (exact 10 options):** `Aigue-marine` · `Cramoisi` · `Rouge` · `Doré` · `Lime` · `Violet` · `Ambre` · `Saphir` · `Fuchsia` · `Émeraude`
  (i.e. `neonCyan`, `tiktok`, `neonRed`, `neonYellow`, `neonGreen`, `neonPurple`, `neonOrange`, `neonBlue`, `neonPink`, `neonTeal`)
- `Échelle de l'interface` — "Ajustez la taille globale de tous les éléments. Utile sur les moniteurs 2K et 4K où 100% peut paraître trop petit."
  Hint: `100% est optimal pour 1080p · 125% recommandé pour 2K · 150% pour 4K`

**Popover / float window** — `dashboardFloat`
- `Activité en direct`; `Épingler la fenêtre au premier plan` / `Désépingler`; `Réglages de la fenêtre`
- Live readout: `EN DIRECT` · `Durée du direct` · `Spectateurs actuels` · `Personnes ayant rejoint` · `Pièces des cadeaux` · `Nouveaux abonnés` · `Likes au total`
- Empties: `Les cadeaux s'afficheront ici` / `Les messages s'afficheront ici dès que le direct commencera`
- Appearance: `Opacité du fond` · `Opacité du contenu` · `Taille du contenu`; states `Hors ligne` · `Connexion…`

**Port guard (conflict resolution UI)**
- `hubBlocked`: "{app} utilise quelque chose dont l'application a besoin pour tes overlays. Ils continuent de marcher par internet, mais plus lentement."
- `busBlocked`: same, for `tes jeux Minecraft`
- Self-aware variant: `L'émulateur Android est resté ouvert…` with `Fermer {app}` → `Fermeture…` → `C'est bon. Tout revient à la normale dans quelques secondes.` / `Impossible de fermer {app}. Ferme-le toi-même et rouvre l'application.`
- `Masquer cet avis`

**AI support assistant** — `support`
- `Assistant` / `Là dès que tu en as besoin` / `Masquer le chat`
- Suggestions: `Où sont les jeux ?` · `Comment ajouter l'overlay du Club de Fans ?` · `Comment installer Minecraft ?`
- Kind chooser: `Question` / `Suggestion` ("Raconte-nous ton idée. L'équipe la lit.") / `Signaler un problème`
- Phase telemetry (reveals agent architecture): `Réflexion…` → `Je réfléchis à la réponse…` → `Vérification…` → `Ouverture de la section…` → `Préparation du guide…` → `Alerte à l'équipe…` → `Envoi à l'équipe…`
- Human handoff: `Parler à une personne` · `Équipe Asure Live` · `En attente de l'équipe…` · `Personne de disponible pour le moment`
- Errors: `rateLimited` · `unavailable` · `invalid` · `auth` · `network` · `empty`

**Referrals** — `Tu as 20 % de réduction` / "Asure est l'application pour faire des lives TikTok avec des jeux, des alertes et la voix." · `Ton code` · `Copier le code` / `Copié !` / `Impossible de copier. Sélectionne le code et copie-le toi-même.` · `Télécharger pour Windows` · `Ensuite, écris ton code dans l'application.`

**Nouveautés (news)** — `Nouveautés` / `Tout ce qui est nouveau dans Asure Live, du plus récent au plus ancien.`
- `{count} nouveautés à voir` · `Nouveau` · `Pas encore de nouveautés.` · `Voir tous les détails` · `{current} sur {total}` · `Précédent` · `Suivant`
- Action verbs: `Essayer la nouveauté` · `Appliquer les améliorations` (+ "L'app va se recharger pour afficher les changements") · `Redémarrer et mettre à jour`
- `Cette nouveauté n'est plus disponible.` · `Nous n'avons pas trouvé cette nouveauté.`

---

# 2. Navigation & layout

## 2.1 Sidebar structure

Six labeled sections, defined once in the dictionary as `nav`:

| Key | FR | Membership |
|---|---|---|
| `sectionContent` | Outils | Accueil, Nouveautés, Minecraft, Roblox, Arcade, Actions et Événements, Extensibles |
| `sectionAudio` | Audio | Synthèse Vocale, Clonage de Voix, Alertes Sonores |
| `sectionVisuals` | Visuels | Studio d'overlays, Club de Fans, Cadeaux, Classements, Objectifs, Spéciaux, Vidéos |
| `sectionExtras` | Intégrations | RCON Minecraft, VTube Studio, T.I.T.S., Streamer.bot, Raccourcis clavier |
| `sectionSettings` | Paramètres | Stockage, Simulateur, Utilisateurs (Minecraft / Roblox), Invite et gagne, Suggestions et bugs, Préférences, Mon forfait |
| `sectionComingSoon` | Bientôt disponible | badge variant, not a section |

## 2.2 Overlays are a sub-index, not a sub-menu

`Overlays` is a single parent with hash children, distinguished by `overlaysFansclub`, `overlaysGifts`, `overlaysTops`, `overlaysGoals`, `overlaysSpecial`. This is a deliberate IA choice: the overlay page is a **category browser with deep links**, not a nested tree — matching the fact that all five share one settings surface.

## 2.3 Shell geometry

- Body: `hover-scroll` + `flex-1` on `<main>`
- Main padding: `px-4 py-6 md:px-8 md:py-8`
- Content column: `max-w-6xl`, `flex flex-col`, `gap-4` / `gap-6`
- Mobile drawer: `w-60`; collapsed desktop rail ≈ `32px`
- Sidebar actions: `expand` = `Développer la barre latérale`, `collapse` = `Réduire la barre latérale`, `downloadTitle` = `Télécharger l'app de bureau`
- Category rows use `aria-expanded` / `aria-controls`; hover flyout ~140 ms; grid expansion ~200 ms
- Active row: `bg-brand/10` + brand icon/text + optional brand dot

## 2.4 Topbar

```
connectTikTok: "Connecter TikTok LIVE"
connecting:    "Connexion..."
connected:     "Connecté"
```
Right cluster: `Compte` / `Mon compte` / `Se connecter` / `Se déconnecter` / `S'abonner` / `Débloquer les jeux`, then theme + window controls.

`themeSwitcher`: `Thème` → `Clair` / `Sombre` / `Système`
`languageSwitcher`: `Changer de langue` / `bientôt`

## 2.5 Connection error taxonomy (7 distinct states)

Each has a `Title` + `Hint` pair, which is unusually disciplined copy for a consumer app:

| Key | Title |
|---|---|
| `enginePermissionsTitle` | Add Asure Live to your allow-list, close fully, reopen |
| `engineNoSpaceTitle` | `Ton ordinateur n'a plus d'espace.` — "Libère de l'espace sur le disque où se trouve Windows… Un demi-giga suffit." |
| `engineBadPathTitle` | `Windows ne nous a pas laissés enregistrer le moteur TikTok.` |
| `engineUnavailableTitle` | `Impossible de préparer la connexion à TikTok.` — antivirus/firewall |
| `tiktokRejectedTitle` | `TikTok ne nous a pas laissés entrer dans ton live.` |
| `slotsSubscribersOnlyTitle` | `Il n'y a pas de place sur la connexion rapide en ce moment.` (subscriber-only fast lane) |
| `connectFailedTitle` | `Impossible de se connecter à @{username}.` |

All terminate in `understood: "Compris"`.

## 2.6 Two sign-in paths

`tiktokAccount` is **Bêta** and offers a choice gate:
- `optionAccount` = `Avec ton compte TikTok` — "Utilise ta session TikTok pour te connecter à n'importe quel @."
- `optionClassic` = `Classique` — "Connecte-toi à n'importe quel @."
- `remember` = `Mémoriser mon choix`; `choiceLabel` = `À la connexion :`; `choiceAsk` = `Demander à chaque fois`
- `sessionNote` = "Ta session reste sur cet ordinateur."

## 2.7 Onboarding is a 3-step wizard, not a modal

`tiktok` → `minecraft` → finish:
1. `Votre compte TikTok` — `Nom d'utilisateur TikTok`, placeholder `votre_utilisateur`. Footer: "Nous utilisons votre nom d'utilisateur pour précharger vos emotes et cadeaux…"
2. `Votre nom Minecraft Java` — validation `Entre 3 et 16 caractères : lettres, chiffres ou tiret bas.` Footer: "Votre nom d'utilisateur Minecraft Java rend votre skin visible dans les jeux interactifs Minecraft."
3. `Terminer` / `Passer pour l'instant` / `Retour`

Live-preview handles inside step 1: `@votre_utilisateur` · `Abonnements` · `Abonnés` · `J'aime`

A separate `sidecarGate` blocks the wizard: `Démarrage…` / `Impossible de démarrer les services` / `Réessayer`.

---

# 3. Interactions & patterns

## 3.1 Event/rules editor (`07agub.ca46qd.js`)

Row is a **three-column pipeline**: `Déclencheur` → `executes` → `Action`, not a flat list.

- Sort menu: `Manuel (glisser)` · `Par action` · `Alphabétique`
- Row controls: `Modifier` · `Tester` · `Supprimer` · `Dupliquer l'événement` · `Changer le déclencheur` · `Changer l'action`
- Editor modal splits into `Déclencheur` and `Action`; `Activer`/`Activé` toggle with hint "Si désactivé, l'action ne s'exécute pas."; "L'action se déclenche une fois."
- `Action à exécuter` + `Paramètres`; numeric editor is a **stepper** (`signAdd: "Ajouter"` / `signSubtract: "Soustraire"`) not a text input — `WinsField` with `-1` / `+1` buttons and `min` clamping
- Test states: `idle` → `loading` → `ok` / `error`
- Badge per trigger type: `Cadeau` · `Like` · `Follow` · `Share` · `Super Fan` · `Arrivée` · `Emote` · `Chat` · `Streamer.bot`
- Reusable primitives: `PresetChip` (with `lucide:lock` + `lockedHint`, `aria-pressed`), `NumberField` (label + description + unit), `Label`

## 3.2 Trigger copy and semantics

| Trigger | UI copy | Semantics |
|---|---|---|
| `like` | `Tous les {n} likes` / `De chaque spectateur` / `Du live (total)` | `everyNLikes` + `scope: user\|room` |
| `gift` | `De … Jusqu'à` / `pièces` / `Sans limite` / `Rechercher un cadeau...` / `Cadeau personnalisé` / `N'importe quel cadeau` | min/max, gift type |
| `follow` | `Nouveau follow`, `Follow` | `onlyFirstTime` dedup |
| `share` | `Partager le live`, `Share` | `cooldown` minutes, default 3 |
| `join` | `A rejoint le live`, `Arrivée` | 5 s startup grace + cooldown |
| `subscribe` | `Abonné / Super Fan`, `Super Fan` | dedup |
| `emote` | `Emote du Club de Fans` | giftCatalog-backed |
| `chat-command` | `Commande de chat`, placeholder `Ex. !concours` | first word, lowercased |
| `chat-keyword` | `Message du chat` | substring/phrase |
| `roblox-chat-user` | — | captures username |
| `streamerbot-event` | `Source` / `Événement` | `source` + `eventType`, `*` wildcard |

Repeat/combo: `Réagit UNE fois … t à CHAQUE envoi individuel du cadeau … sans attendre la fin du combo.`

## 3.3 Game configuration layout

Header breadcrumb: `lucide:arrow-left` → game name → optional `Badge` (`green` → `bg-green-500/10 text-green-600 dark:text-green-400`; `muted` → `bg-muted`).
Tabs: segmented control `flex gap-0.5 overflow-x-auto rounded-xl bg-muted/50 p-1`, active = `bg-background shadow-sm font-medium`, inactive = `text-muted-foreground hover:text-foreground`, `duration-150`.
**Lazy mount with visited-set:** `if (e.id!==k && !j.current.has(e.id)) return null` — tabs render once visited, then stay in the DOM with `hidden`. This is why captured DOM duplicates content across tabs.

Tab order: `general` → `events` → `overlays` → `commands` → `sounds`. Per-game sets:
- CoC: `general, events, overlays, profiles, share`
- Royale: `general, events, overlays, profiles, errors, features, mcGames, auth, bindings, testModal, repeat, billing, offer, flow, errors, manage, paypalReturn`

## 3.4 Game card states

`Disponible` · `Bientôt` · `Aperçu bientôt` · `Jouer` · configure action · `Le plus joué` · `Nouveau` · `Bêta`
Chrome messaging: "L'app installe Minecraft, les mods et la map à ta place."
Launcher: "l'application a son propre launcher Minecraft… Il n'affecte pas votre Minecraft : il fonctionne séparément."

## 3.5 Overlay editor (`editor` namespace)

- "Voici votre canevas d'overlays 🎨" — drag canvas
- `Overlay` button adds Asure overlays **or third-party by URL**
- `Bascule entre vertical (9:16) et horizontal (16:9)`
- "Vos éléments sont listés ici en **calques**" — layer list, reorder, per-scene OBS URL

## 3.6 Motion system (from `16rhs.nw2689f.css`)

| Keyframe | Behavior |
|---|---|
| `asure-welcome-glow-in` | blur + opacity entrance |
| `asure-welcome-line-in` | rule/line reveal |
| `asure-welcome-text-in` | letter-spacing collapse |
| `asure-welcome-cta-in` | delayed CTA |
| `asure-step-reveal` | per-step stagger |
| `asure-curtain-exit` | wipe away |
| `asure-onboarding-content-out` | translate + blur |
| `asure-onboarding-outro` | zoom + blur |
| `hero-rise`, `scroll-reveal-up` | landing marketing |
| `nudge-left` / `nudge-right` | onboarding pointer |
| `marquee-x` | scrolling badge strip |
| `float-y`, `overlay-pulse`, `live-ripple`, `player-pulse`, `live-dot` | live/overlay status |
| `music-indeterminate` | YouTube audio progress |
| `tos-alert` | terms alert |

All wrapped in `@media (prefers-reduced-motion: reduce)`.

---

# 4. Design system & terminology

## 4.1 Tokens (light, from captured CSS)

```css
--background:#fff            --foreground:#0a0a0a
--card:#fff                  --card-foreground:#0a0a0a
--popover:#fff               --popover-foreground:#0a0a0a
--primary:#171717            --primary-foreground:#fafafa
--secondary:#f5f5f5          --secondary-foreground:#171717
--muted:#f5f5f5              --muted-foreground:#737373
--accent:#f5f5f5             --accent-foreground:#171717
--destructive:#e40014
--border:#e5e5e5             --input:#e5e5e5       --ring:#a1a1a1
--chart-1..5:#d4d4d4 #737373 #525252 #404040 #262626
--radius:.625rem
--sidebar:#fafafa            --sidebar-foreground:#0a0a0a
--sidebar-primary:#171717    --sidebar-primary-foreground:#fafafa
--sidebar-accent:#f5f5f5     --sidebar-accent-foreground:#171717
--sidebar-border:#e5e5e5     --sidebar-ring:#a1a1a1
--brand:#ff4c79              --brand-foreground:#fcfcfc
--brand-accent:#00d3dd
```

## 4.2 Tokens (dark, from `boot.html` mirror)

```css
--background: oklch(0.135 0.008 280)   /* ≈ #08080b */
--foreground: oklch(0.985 0 0)
--primary:   oklch(0.7 0.23 10)       /* pink-red, matches --brand */
--muted:     oklch(0.24 0.01 280)
--muted-foreground: oklch(0.72 0.01 280)
--border:    oklch(1 0 0 / 10%)
--ring:      oklch(0.7 0.23 10 / 60%)
--destructive: oklch(0.704 0.191 22.216)
--radius: 0.625rem
```

## 4.3 Typography

| Role | Family |
|---|---|
| UI / body | **Instrument Sans** |
| Display / headings | **Bricolage Grotesque** |
| Mono | **Geist Mono** |

Loaded as `/fonts/sans.woff2` and `/fonts/heading.woff2` (paths confirmed in the exe strings and in `boot.html`).

## 4.4 Component vocabulary

Buttons · cards · badges · inputs · selects · `Label` · dialogs · dropdowns · icon buttons · status pills · grids · drawers · segmented tabs · `NumberField` · `PresetChip` · `WinsField`.
Radius scale: `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-full`. States: focus ring, hover elevation, disabled, locked, empty. Motion via View Transitions for theme swap, with reduced-motion fallback.

## 4.5 Terminology (FR → AR, from the reconstructed `f_00000f.html`)

| FR (authoritative) | AR (reconstructed) |
|---|---|
| Accueil / Tableau de bord | الرئيسية · لوحة التحكم |
| Nouveautés | الجديد |
| Minecraft / Arcade | الألعاب |
| Actions et Événements | الأحداث والأوامر |
| Extensibles | الإضافات |
| Synthèse Vocale | تحويل النص إلى كلام |
| Clonage de Voix | استنساخ الصوت |
| Alertes Sonores | تنبيهات صوتية |
| Studio d'overlays | ستوديو الطبقات |

Note the semantic drift: the AR build renders `Actions et Événements` as "events **and commands**" (`الأحداث والأوامر`), and `Extensibles` as "add-ons" (`الإضافات`) rather than "extensible". If you are building AR, `Extensibles` is ambiguous — "plugins/add-ons" is likely the intended sense.

## 4.6 Product positioning (from the `landing` namespace)

> "Ton chat **contrôle** Minecraft en direct" — "Des mini-jeux interactifs que ton audience fait bouger avec des cadeaux, des likes et des commentaires."

- **Free forever:** overlays + TTS. "Sans carte. Pas de période d'essai."
- **Paid:** only mini-games. `Mensuel` at **17 USD**, or `Pass 1 jour` / `Pass 15 jours` one-time.
- Cadence claim: "Un nouveau jeu toutes les 2 à 4 semaines."
- Plans: `full` · `lite`; payment: Stripe or PayPal.
- Trust stack: `Minecraft` · `OBS & TikTok Live Studio` · `Windows` · `Overlays gratuits` · `TTS Loquendo gratuit`
- Hero chips: `Roses ×25` · `+1.2k likes` · `Nouveau follower` · `Totem activé !`

---

# 5. Feature surface

## 5.1 Full dictionary namespace map (330 keys, all recovered)

Organized by the sections that consume them:

**Shell / chrome:** `sidebar` · `dashboard.nav` · `dashboard.topbar` · `themeSwitcher` · `languageSwitcher` · `signIn/signOut/account/myAccount/subscribe` · `updater` (`appUpdateWall`, `updateGate`, `campaignNotice`) · `blockedNav` · `gifts-offer` · `maintenanceGate` · `comingSoonGate` · `portGuard` · `dashboardFloat`

**Auth / account:** `connectError` · `tiktokAccount` · `sidecarGate` · `onboarding` · `magicLink` (6-digit code, `Vérifier`, `Renvoyer le lien`)

**Overview:** `overview` · `stats` · `activityFeed` · `ttsHistory` · `ttsCard` · `tiktokCard` · `quickActions`

**TTS (largest single subsystem):** `tts.health` · `tts.redesign` · `tts.omnivoice` · `tts.voicePicker` · `tts.tiktok` · `tts.edge` · `tts.azure` · `tts.general` · `tts.userFilters` · `tts.chatFilters` · `tts.voices` · `tts.status` · `tts.customizer` · `tts.editor` · `tts.voiceList` · `tts.perUser` · `tts.liveQueue` · `tts.historyCard` · `tts.history` · `tts.audioGenerator` · `tts.quota` · `ttsPremium`
Providers map 1:1 to the five endpoints: **Loquendo** (incl. IVONA), **TikTok** voices, **Microsoft Edge Neural**, **Google**, plus **OmniVoice** (AI clone).
Product claims: **150+ voices**, per-user fixed voice, length/blocked-word/followers-only filters, no quota.

**Overlays:** `overlays` (categories/gifts/tops/goals/special/gallery) · `editor` (layers, aspect) · `gifts` · `games.*.overlays` · `overlays.labels`
Per-game overlay sets recovered: `pvpArenaWins` (lastWinner, winsTop, boardJoin, boardTotem, boardHeartMe, boardArmors, boardSwords, timates) · `zombieDefense` (wins, timer, boardZombies, boardSpecial) · `spiralStairs` (versus) · `cube` (blocks, powers) · `neonHighway` · `royaleCards` · `cocCardsLook` · `royaleWins` · `highlights` · `giftText` · `leaderboard` · `marquee`

**Games (9 namespaces):** `pvp` · `pvpTeams` · `pvpWins` · `zombies` (+ `vars`) · `escalera` · `cubo` · `pfp` · `royale` · `coc` · `arcade` · `roblox` (`catalog`, `beta`, `link`) · `juegos` · `juegosWelcome` · `juegosPostInstall`
`royale` onboarding: "La seule chose que tu installes, c'est **MuMu Player avec Android 12**". Elixir/card-rate and terrain card both configurable. Event bindings ship **pre-wired** — "Ils sont déjà prêts : entre et active, désactive ou modifie ceux que tu veux."

**Events / actions:** `events` · `actions` · `giftPicker` · `emoteCategories` · `screens` · `timer` · `comandos` (+ `groups`) · `keyTriggers` (+ `bindings`, `testModal`, `repeat`)

**Integrations:** `rcon` (+ `placeholders`, `placeholdersHelp`) · `vtubeStudio` (+ `actions`, `params`, `errors`, `status`, `editor`, `transitionNames`) · `tits` · `streamerbot` · `mcUsers` (+ `linkCommand`) · `roblox.users` · `pvpJoin` · `pvpRevive` · `pvpTeamA` · `pvpTeamB`

**Media:** `storage` · `videos` (+ `colorThemes`, `textFields`, `videoTitles`) · `sounds` (+ `catalog`, `system`) · `soundAlerts` · `music` / `musica` (+ `miniPlayer`, `setup`, `queue`, `nowPlaying` overlay)

**Settings:** `interfaz` (colors + scale) · `configuracion` · `suscripcion` · `storage` · `referrals` · `extensions` (+ `sources`, `interactive`, `asure`, `kind`, `skip`, `warn`, `import`) · `actions` · `profiles` · `kiosk`

**Meta:** `billing` · `offer` · `flow` · `manage` · `paypalReturn` · `novedades` · `tutorial` · `support` · `invite` · `landing` · `errors` · `features` · `status` · `events`

## 5.2 Rust feature modules (22, from `artifacts\src-features.txt`)

`auth` · `config` · `entitlement_guard` · `float_window` · `gift_catalog` · `hotkeys` · `image_pipeline` · `keys` · `live_data` · `mappet_vars` · `overlay` · `overlay_cloud_relay` · `overlay_hub` · `rcon` · `roblox` · `store` · `tiktok_ingest` · `tiktok_py` · `tiktok_trackers` · `webhook` — plus `launcher`, `live_analytics`, `mappet_bus`, `tiktok_euler`, `diagnostics`, `android`

76 Tauri commands documented in `findings.md` §4. Loopback services: `7547` mappet-bus, `7548` overlay-hub, `50116` tiktok-ingest.

## 5.3 Known engineering landmine (worth flagging)

`findings.md` §4 records a kill-switch in the app's own logs:

```
entitlement: denied NoSession → wipe ok (mods, saves, config, resources)
```

Any local run without an active session **destroys Minecraft mods, saves, and config**. Back up `Roaming\AsureLive` before any local execution. `findings.md` §6 step 1 is unchecked for this reason.

---

# Open gaps

1. **Per-locale dictionaries** — only `fr` and `es` are present in the captured payload. `en`/`pt`/`it`/`id` were not shipped in this SSR render.
2. **Mobile / web shell** — sidebar, topbar, theme confirmed; responsive breakpoints and the web-only fallback beyond `web-release` are not.
3. **Non-FR terminology** — the AR mapping remains from a reconstructed artifact; the i18n key names (`nav.acciones`, `nav.storage`, `nav.referrals`, `nav.overlaysFansclub`, …) are the safer contract to localize against than the AR labels.
4. **Overlay visual specs** — registry, fonts (`Outfit`, `Anton`, `Bebas Neue`, `Luckiest Guy`, `Fredoka`, `Russo One`, `Bungee`, `Lilita One`, `Minecraft Ten`), effects (`metal`, `solid3d`, `flat`, `outline`, `glow`, `shadow`) and tones (white/gold/silver/bronze/steel/amber) are known, but per-kind default layouts are not.

If you want, next I can dump any single namespace in full (e.g. the complete `tts` tree, or all 67 Royale cards), or produce the equivalent ES-dictionary pass.