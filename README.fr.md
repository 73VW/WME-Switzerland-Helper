# WME Switzerland Helper

Bienvenue à tous ! Cet outil est conçu pour rendre l'édition du Waze Map Editor (WME) plus facile et plus efficace pour tous ceux qui travaillent sur des cartes en Suisse - aucune connaissance technique n'est requise.

---

## 📚 Documentation dans votre langue

Choisissez votre langue préférée :

- 🇬🇧 [anglais](./README.md)
- 🇫🇷 [français](./README.fr.md)
- 🇮🇹 [Italien](./README.it.md)
- 🇩🇪 [Allemand](./README.de.md)

---

## 🚀 Qu'est-ce que ce script ?

**WME Switzerland Helper** est un module complémentaire gratuit pour l'éditeur de cartes Waze. Il ajoute de nouvelles fonctionnalités et des données cartographiques officielles suisses, ce qui facilite l'édition et l'amélioration des cartes en Suisse.

Vous n'avez pas besoin d'être un programmeur ou d'avoir des compétences techniques particulières pour l'utiliser !

---

## 🛠️ Comment installer et utiliser

1. **Installer Tampermonkey**
  Tampermonkey est une extension de navigateur gratuite qui vous permet d'ajouter des scripts utiles aux sites web.  
  - [Télécharger Tampermonkey pour Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
  - Pour les autres navigateurs, recherchez "Tampermonkey" dans le magasin d'extensions de votre navigateur.

2. **Ajouter le script d'aide de WME Switzerland**
  - Après avoir installé Tampermonkey, cliquez sur ce lien :  
    [Installer WME Switzerland Helper](https://raw.githubusercontent.com/73VW/WME-Switzerland-Helper/releases/releases/main.user.js)
  - Votre navigateur affichera une page vous demandant si vous souhaitez installer le script. Cliquez sur le bouton <kbd>Install</kbd>.

3. **Commencez à éditer!**
  - Ouvrez le [Waze Map Editor](https://www.waze.com/editor?tab=userscript_tab).
  - Vous verrez de nouvelles options et une courte explication dans l'onglet `Scripts`.

*Et voilà ! Le script s'exécute automatiquement lorsque vous utilisez l'éditeur de cartes Waze.*

---

## 🌟 Caractéristiques

Avec ce script, vous obtenez :

- **Couches cartographiques officielles de la Suisse**
  Ajoutez et visualisez des couches de cartes supplémentaires directement dans WME, y compris :
  - Les limites des communes suisses (de swisstopo)
  - Limites cantonales suisses (de swisstopo)
  - Noms géographiques (swissNAMES3D)
  - Cartes nationales suisses en couleur
  - Images aériennes suisses à haute résolution

- **Contrôle facile des couches**
  Activez ou désactivez chaque couche à l'aide de simples cases à cocher dans l'interface de WME.

Toutes les données cartographiques proviennent de sources officielles suisses (swisstopo), vous pouvez donc vous fier à leur exactitude.

---

## 💡 Besoin d'aide ? Vous avez des idées ?

Si vous avez des questions, si vous trouvez un bogue ou si vous voulez suggérer une nouvelle fonctionnalité :

1. Rendez-vous sur le [système de suivi des problèmes du projet](https://github.com/73VW/WME-Switzerland-Helper/issues/new).
2. Cliquez sur **"New issue "**.
3. Remplissez le titre et décrivez votre question, problème ou idée.  
  (Ne vous inquiétez pas si vous ne connaissez pas GitHub : vous devrez peut-être créer un compte gratuit)
4. Soumettez votre problème. Les responsables vous répondront dès que possible.

---

Merci de nous aider à améliorer Waze pour tout le monde en Suisse !

## Copyright

Ce projet est basé sur l'excellent travail de Francesco Bedini, qui a créé un modèle pour développer des scripts utilisateurs WME en Typescript. Vous pouvez trouver le projet original [ici](https://github.com/bedo2991/wme-typescript).

Son code est sous licence MIT, disponible [ici](./LICENSE.original) au moment de la création de ce fork.

Tout le code relatif au devcontainer Docker, aux paramètres VS Code, à l'utilisation des locales et au regroupement de paquets ("Tools") est également sous licence MIT.

Tout le code dans `/src/` (et tout fichier avec un copyright mentionnant Maël Pedretti) est sous licence [GNU Affero General Public License v3.0 or later (AGPL)](./LICENSE).

**Résumé:**
- L'utilisation du code original reste sous la licence MIT.
- L'utilisation du code que j'ai ajouté est restreinte par la licence AGPL telle que décrite dans la `LICENSE`.

Ce projet est donc **à double licence** : des parties sous MIT (original et outils), des parties sous AGPL (tout le code `/src/` et le nouveau travail de Maël Pedretti).
