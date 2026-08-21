# Harmonisation UI/UX du checker de noms de rues et de l'importateur de numéros

Date : 2026-08-21
Branche : `refactor/ui-ux-improvements`
Périmètre : `src/street-name-checker/ui/`, `src/house-number-importer/ui/`, `src/ui/`

## 1. Pourquoi

Les deux features sont éprouvées fonctionnellement. Elles ont été écrites l'une après
l'autre, et leur présentation a divergé : le module partagé `src/ui/` a été extrait du
checker puis l'importateur seul l'a adopté. Résultat, deux panneaux qui font la même chose
sans se ressembler, et une fondation dupliquée qui garantit que l'écart se creuse.

Ce chantier harmonise la présentation et la rend plus soignée. **Aucun changement de
comportement**, aucune nouvelle fonction, aucun garde-fou touché.

## 2. Ce qui est décidé

| Question | Décision |
| --- | --- |
| Ordre des travaux | Fondation d'abord (invisible), finition ensuite |
| Ambition | Harmonisation, iconographie, et remise à plat de la hiérarchie |
| Typographie | Héritée de WME (Rubik). Pas d'Inter, pas de police chargée |
| Iconographie | Police d'icônes Waze déjà chargée par WME |
| Onglets | En-tête fusionné, état en une ligne, un seul bloc replié en pied |
| Filtres du checker | Libellés lisibles au lieu des noms d'enum |
| Légendes | Absorbées par les éléments qu'elles expliquent |
| Panneau d'édition | Un hôte partagé, un emplacement par feature, ordre déclaré |
| Fenêtre détachée | Inchangée, hors iconographie |

## 3. Fondations techniques

### 3.1 Iconographie

WME charge lui-même la feuille d'icônes :

```html
<link href="//web-assets.waze.com/waze-web-icons/v19.2.6/waze-web-icons.css">
```

Il n'y a donc **rien à charger**. Le dépôt s'en sert déjà : `src/reloadButton.ts:68`
(`w-icon w-icon-bus`) et `src/sidebar.ts:50`. On utilise `<i class="w-icon w-icon-NOM">`.

Contraintes vérifiées :

- **Ne pas épingler de version.** La feuille déclare ses fontes en URL relatives
  (`src: url("./waze-web-icons.woff2")`). Un `<link>` que nous poserions vers une autre
  version résoudrait ces URL contre `waze.com/editor` et afficherait des carrés vides.
  On hérite de ce que WME charge, quelle que soit la version.
- **Pas de régression de nommage.** v19.2.6 est un surensemble strict de v16.11.1
  (299 icônes contre 290, aucune suppression).
- **Dégradation.** Si WME cesse de charger la feuille, les icônes deviennent invisibles.
  Chaque icône est donc décorative : elle accompagne un texte, elle ne le remplace jamais,
  et elle porte `aria-hidden="true"`.

Nouveau helper dans `src/ui/dom.ts` :

```ts
export function icon(name: string, className = ""): HTMLElement
```

### 3.2 Typographie

Les panneaux héritent de la police de WME. `app.css` de WME déclare
`font-family: Rubik, Waze Boing, sans-serif`, et WME charge déjà Rubik 400..700 depuis
Google Fonts. Charger Inter ferait ressortir nos panneaux comme des corps étrangers, ce qui
va contre l'objectif d'harmonisation, pour une requête réseau de plus.

La CSP de WME autorise pourtant Google Fonts (`style-src 'self' http: https: 'unsafe-inline'`,
`font-src 'self' https: http: data:`) : le refus est un choix de conception, pas une
contrainte technique. Noté ici pour que la question ne soit pas rouverte à l'aveugle.

Ajout d'un token `--<p>-font: inherit` dans `src/ui/tokens.ts`, appliqué aux racines de
panneau, pour que l'héritage soit explicite plutôt que subi.

Échelle retenue, en remplacement des tailles ad hoc actuelles :

| Rôle | Taille | Graisse |
| --- | --- | --- |
| Titre de panneau | 14 px | 700 |
| Titre de section, nom de rue | 13 px | 600 |
| Corps | 12 px | 400 |
| Secondaire, compteurs, notes | 11 px | 400 / 600 |

Espacements sur une grille de 4 px (4, 8, 12, 16).

### 3.3 Le module partagé `src/ui/`

État actuel : `tokens.ts`, `components.ts`, `inject.ts`, `theme.ts`, `tab-group.ts`.

Ajouts :

- **`src/ui/dom.ts`** — `el()`, `toggleSwitch()`, `button()`, `numberInput()`,
  `buildSection()`, `buildSubsection()`, `icon()`. Les constructeurs prennent le préfixe de
  feature en paramètre, comme `componentRules(p)` le fait déjà pour le CSS.
  `el()` et `toggleSwitch()` sont aujourd'hui dupliqués à l'identique dans les deux
  features ; `button()` et `numberInput()` n'existent que côté numéros ;
  `buildSection()` et `buildSubsection()` ont divergé.
- **`src/ui/edit-panel-host.ts`** — voir §4.3.

Les `ui/dom.ts` des deux features disparaissent. Leurs particularités restent chez elles :
`dot(status)` côté numéros lit `STATUS_ICONS` de sa couche carte, il n'a rien à faire dans
un module partagé.

### 3.4 Migration du checker vers `componentRules`

`src/street-name-checker/ui/styles.ts` (218 lignes) est la copie source dont
`components.ts` a été extrait. Les noms générés correspondent déjà à ce que le checker
utilise. La migration est mécanique, à ces renommages près :

| Aujourd'hui (checker) | Après | Note |
| --- | --- | --- |
| `.chk-chips` / `.chk-chip` | `.chk-pills` / `.chk-pill` | même concept que côté numéros |
| `.chk-chip-active` | `.chk-pill-active` | à ajouter dans `components.ts` |
| `.chk-badge` | `.chk-dot` | le suffixe `-badge-<status>` suit |
| `.chk-group-toggle`, `.chk-row-select` | `.chk-plain` | le reset WME est identique |
| `.chk-banner.chk-error` | `.chk-banner-error` | aligne sur la convention numéros |

Restent propres au checker, donc gardés dans son `styles.ts` : `.chk-groups`, `.chk-group*`,
`.chk-row*`, `.chk-window*`, `.chk-helper*`, `.chk-canton*`, `.chk-locate`, `.chk-geolink`,
`.chk-busy`, `.chk-spinner`, `.chk-settings-grid`, et les règles de statut générées.

`.chk-pill-active` et le bloc `-busy/-spinner` sont les deux seuls ajouts à
`components.ts` : le reste existe déjà.

## 4. Les quatre surfaces

### 4.1 Onglet « Noms de rues »

Neuf blocs de premier niveau deviennent six.

| Aujourd'hui | Après |
| --- | --- |
| 1 marque, 2 barre d'outils, 3 bandeau, 4 alerte, 5 interrupteurs, 6 liste, 7 légende, 8 réglages, 9 pied | 1 marque **+ interrupteur principal**, 2 barre d'outils **+ Détacher**, 3 ligne d'état, 4 filtres, 5 liste, 6 « Réglages et aide » |

L'alerte (`warnLine`) ne disparaît pas : elle devient une variante de la ligne d'état,
comme côté numéros, au lieu d'occuper un bloc à elle.

Le bloc `chk-master` d'aujourd'hui (`buildMasterToggles`) porte quatre choses, qui se
répartissent ainsi :

| Contenu du bloc interrupteurs | Destination |
| --- | --- |
| « Activé » | ligne de titre, poussé à droite |
| « Scan automatique » | « Réglages et aide » |
| « Vue seule » | supprimé **ici** : il existe déjà à l'identique dans les Réglages |
| Bouton « Détacher » | barre d'outils, avec « Rescanner » et « Suivant » — c'est une action, pas un réglage |

« Vue seule » est aujourd'hui construit deux fois, une fois dans cette rangée et une fois
dans les Réglages, les deux instances étant tenues en phase par `viewportInputs`
(`tab.ts:296` et `viewportOnlyToggle`). Retirer le doublon ne laisse qu'une instance, ce qui
rend le miroir inutile. Le mécanisme peut alors disparaître ; à défaut il devient une
boucle sur un seul élément, donc inoffensif. Un test fixe l'attente.

- Le bandeau devient une **ligne d'état** discrète (icône `info` + texte). Il ne reprend un
  fond coloré que sur erreur ou sur succès complet, cas où la couleur porte du sens.
  Le bouton d'action du bandeau (« Scanner cette zone » / « Annuler ») reste, en bout de ligne.
- Légende, réglages et pied fusionnent en un seul `<details>`.
- Gain de hauteur pour la liste : environ 110 px, soit un groupe de plus sans défiler.

**Filtres lisibles.** `renderChips` (`tab.ts:509`) affiche aujourd'hui le nom brut de
l'enum : `chip.append(dot, \`${status} ${count}\`)` donne `WRONG_STREET 3`. Idem dans
`renderGroup` et dans la boîte du panneau d'édition. On introduit un libellé court par
statut, et le nom d'enum disparaît de l'interface.

**Légende absorbée.** L'explication longue descend dans le groupe qu'elle concerne, sous les
noms, en texte secondaire. Elle est lue au moment où elle sert. Le bloc Légende disparaît.

### 4.2 Onglet « Numéros de maison »

Dix blocs deviennent cinq, avec la même structure que l'onglet précédent.

| Aujourd'hui | Après |
| --- | --- |
| 1 marque, 2 note, 3 bandeau, 4 interrupteur, 5 alerte, 6 sélection, 7 action, 8 actions secondaires, 9 réglages, 10 légende | 1 marque **+ interrupteur**, 2 ligne d'état, 3 sélection, 4 action, 5 « Réglages et aide » |

- La note d'aide (bloc 2) est absorbée par la ligne d'état, qui a de toute façon quelque
  chose à dire dans chaque état.
- L'alerte de données reste, mais comme variante de la ligne d'état, pas comme bloc séparé.
- Les actions secondaires (« Rafraîchir », « Vider le cache ») descendent dans le pied replié.
- **La légende disparaît en tant que bloc.** Les pills affichent déjà
  `pastille + compteur + t(LEGEND_KEYS[status])` et la légende
  `pastille + t(LEGEND_KEYS[status])` : c'est la même information au compteur près. Une
  ligne dans le pied replié rappelle la signification des statuts absents de la sélection.

### 4.3 La boîte du panneau d'édition

Les deux features injectent aujourd'hui chacune un conteneur avec `panel.prepend()`, avec
des relances à `[0, 250, 750]` ms côté checker et `[0, 120, 400, 900]` ms côté numéros.
**Leur ordre dépend donc de la course** et peut s'inverser d'une sélection à l'autre. Par
ailleurs la boîte numéros interroge `getElementById("chk-edit-helper")` pour savoir si elle
doit taire son verdict de nom : une négociation entre features par le DOM.

Nouveau module **`src/ui/edit-panel-host.ts`** :

```ts
export interface EditPanelSlot {
  id: string;         // "street-name" | "house-numbers"
  rank: number;       // ordre d'affichage, déclaré
  render: () => HTMLElement | null;   // null = rien à dire, l'emplacement se retire
}
export function registerEditPanelSlot(slot: EditPanelSlot): void
export function refreshEditPanelHost(): void
```

- Un seul conteneur bordé, un seul en-tête (`icône location` + « Suisse »), un séparateur
  fin entre emplacements. L'ordre vient de `rank`, plus de la course.
- Une seule série de relances d'injection, une seule garde `#edit-panel` absent, un seul
  avertissement au journal.
- L'hôte se retire entièrement quand tous ses emplacements rendent `null`.
- La négociation par `getElementById` disparaît : l'hôte sait quels emplacements sont
  présents et le passe à `render()`.
- Le nom de la rue n'est plus répété dans l'en-tête des boîtes : le champ WME juste dessous
  le porte déjà.

La déviation documentée dans `CLAUDE.md` ne change pas de nature : le DOM reste un simple
point de montage, et le nombre de points d'injection **diminue** (deux conteneurs → un).
La table des déviations est mise à jour pour décrire un hôte unique.

### 4.4 Fenêtre détachée

Inchangée, hors iconographie. L'émoji du titre devient une icône Waze, pour qu'elle suive le
thème sombre au lieu d'afficher un rendu figé décidé par le système d'exploitation. Le
bouton « Ancrer » **reste en toutes lettres**, conformément au commentaire du code : c'est
le seul contrôle de la fenêtre et le chemin du retour vers la sidebar. Une icône
l'accompagne, elle ne le remplace pas.

## 5. Localisation

Nouvelles clés, dans `locales/<lang>/common.json` pour **en, fr, de, it**.

**`streetCheck.label<STATUS>`** — libellé court, 1 à 3 mots, 15 clés :
`COSMETIC`, `VARIANT`, `NEAR`, `WRONG_TYPE`, `BILINGUAL`, `WRONG_STREET`, `WRONG_CITY`,
`NOT_FOUND`, `UNNAMED`, `UNNAMED_NO_MATCH`, `UNDER_LOCK`, `OVER_LOCK`, `MICRO_SEGMENT`,
`LOOP`, `NARROW_MISUSE`.

Soit 60 chaînes. Les `legend<STATUS>` existantes sont conservées : elles deviennent
l'explication affichée dans le groupe.

Autres clés : un intitulé de section fusionnée par feature
(`streetCheck.settingsAndHelp`, `houseNumbers.settingsAndHelp`), le rappel de légende du
pied côté numéros, et l'en-tête de l'hôte du panneau d'édition.

`npm run makemessages` après coup.

## 6. Ce qui ne change pas

Contrat explicite de ce chantier :

- Aucune modification de `fix.ts`, `import.ts`, `status.ts`, `scan.ts`, `matching/`,
  `gwr/`, `geoadmin/`.
- Les garde-fous restent tels quels : `GROUP_FIX_MIN_RANK`, `LOCK_DEFAULT_MIN_RANK`,
  `IMPORT_CAP`, `MAX_SNAP_DISTANCE_M`, la double application des seuils dans l'interface
  **et** dans la couche qui écrit, le masquage plutôt que le grisage des actions de groupe,
  la confirmation systématique de `WRONG_STREET`, et le fait que rien n'est jamais
  enregistré automatiquement.
- Les cinq déviations de `CLAUDE.md` restent des déviations. Aucune sixième n'est ouverte.
- La couleur n'est jamais le seul porteur d'un statut : chaque pastille reste accolée à un
  libellé.
- Les instances SDK, `scriptId` et i18next séparés restent séparés.

## 7. Tests

Les tests existants de `ui/` (`tab.test.ts`, `edit-panel.test.ts`, `tab-viewport.test.ts`,
`window-geometry.test.ts`, `canton-link.test.ts`, `format.test.ts`) doivent passer, adaptés
aux renommages de classes.

Nouveaux tests :

- `src/ui/dom.test.ts` — les constructeurs produisent le balisage attendu pour un préfixe
  donné ; l'interrupteur garde bien la case à cocher en frère précédent de la piste, ce dont
  dépend le CSS.
- `src/ui/edit-panel-host.test.ts` — ordre par `rank` indépendant de l'ordre
  d'enregistrement ; un emplacement qui rend `null` se retire ; l'hôte disparaît quand tous
  rendent `null` ; absence de `#edit-panel` avertie une seule fois.
- `format.test.ts` (checker) — chaque statut a un libellé court, dans les quatre langues.

Commandes : `npx vitest run src/ui src/house-number-importer src/street-name-checker`,
`npx tsc --noEmit`, `npx eslint src`, `npx rollup -c`.

## 8. Découpage

**Phase 1 — fondation, sans effet visible**

1. `src/ui/dom.ts` : constructeurs partagés paramétrés par préfixe, plus `icon()`.
   Les deux features basculent dessus, leurs `ui/dom.ts` disparaissent.
2. `.chk-pill-active` et le bloc occupé/rotatif ajoutés à `components.ts` ; le checker
   passe sur `componentRules("chk")`, son `styles.ts` réduit à ce qui lui est propre.
3. Token `--<p>-font: inherit` et application de l'échelle typographique.

**Phase 2 — iconographie**

4. Les émojis (`🛣️ 🏠 ⚙️ 🎨 ⚠️ 📍 ✓` et les chevrons `▸`) remplacés par des icônes Waze,
   décoratives et `aria-hidden`, dans les deux features et la fenêtre détachée.

**Phase 3 — hiérarchie**

5. Libellés courts par statut, 15 clés × 4 langues ; le nom d'enum quitte l'interface ;
   l'explication descend dans le groupe ; le bloc Légende du checker disparaît.
6. Onglet checker réordonné en six blocs.
7. Onglet numéros réordonné en cinq blocs ; son bloc Légende disparaît.

**Phase 4 — panneau d'édition**

8. `src/ui/edit-panel-host.ts` et bascule des deux features ; `CLAUDE.md` mis à jour.

**Phase 5 — livraison**

9. Entrée de changelog dans `README.md` (Changed), les trois autres READMEs étant générés.
10. Vérifications, puis PR vers `main` avec 73VW en relecture.

Chaque phase est vérifiable seule et laisse le script fonctionnel.

## 9. Risques

| Risque | Traitement |
| --- | --- |
| WME cesse de charger la feuille d'icônes | Icônes décoratives uniquement ; le texte reste lisible |
| Un renommage de classe manqué | `styles.ts` réduit à ce qui lui est propre ; toute classe orpheline saute au lint et aux tests |
| Les 15 libellés courts perdent en précision | L'explication longue est conservée et affichée dans le groupe |
| La fusion des blocs de pied cache un réglage utilisé | Aucun réglage supprimé ; un seul niveau de repli en plus |
| Régression visuelle non détectée par les tests | Test manuel en WME au bout de chaque phase, sur les deux thèmes |
