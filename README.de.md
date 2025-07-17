# WME Switzerland Helferin

Willkommen! Dieses Tool wurde entwickelt, um die Bearbeitung des Waze Map Editors (WME) einfacher und effektiver zu machen für alle, die an Karten in der Schweiz arbeiten - ohne technisches Hintergrundwissen.

---

## 📚 Dokumentation in Ihrer Sprache

Wählen Sie Ihre bevorzugte Sprache:

- 🇬🇧 [Englisch](./README.md)
- 🇫🇷 [Französisch](./README.fr.md)
- 🇮🇹 [Italienisch](./README.it.md)
- 🇩🇪 [Deutsch](./README.de.md)

---

## 🚀 Was ist dieses Skript?

**WME Switzerland Helper** ist ein kostenloses Add-on für den Waze Map Editor. Es fügt neue Funktionen und offizielle Schweizer Kartendaten hinzu, die es einfacher machen, Karten in der Schweiz zu bearbeiten und zu verbessern.

Sie müssen kein Programmierer sein oder besondere technische Fähigkeiten haben, um es zu benutzen!

---

## 🛠️ Installation und Verwendung

1. **Tampermonkey installieren**
  Tampermonkey ist eine kostenlose Browsererweiterung, mit der Sie hilfreiche Skripte zu Websites hinzufügen können.  
  - [Tampermonkey für Chrome herunterladen](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
  - Bei anderen Browsern suchen Sie im Erweiterungs-/Add-on-Store Ihres Browsers nach "Tampermonkey".

2. **Hinzufügen des WME Switzerland Helper Script**
  - Nachdem Sie Tampermonkey installiert haben, klicken Sie auf diesen Link:  
    [WME Switzerland Helper installieren](https://raw.githubusercontent.com/73VW/WME-Switzerland-Helper/releases/releases/main.user.js)
  - Ihr Browser wird eine Seite anzeigen, auf der Sie gefragt werden, ob Sie das Skript installieren möchten. Klicken Sie auf die Schaltfläche <kbd>Installieren</kbd>.

3. **Start Editing!*
  - Öffnen Sie den [Waze Map Editor](https://www.waze.com/editor?tab=userscript_tab).
  - Auf der Registerkarte "Skripte" sehen Sie neue Optionen und eine kurze Erklärung.

*Das war's! Das Skript wird automatisch ausgeführt, wenn Sie den Waze Map Editor verwenden

---

## 🌟 Merkmale

Mit diesem Skript erhalten Sie:

- **Offizielle Schweizer Kartenebenen**
  Fügen Sie zusätzliche Kartenebenen direkt in WME hinzu und zeigen Sie sie an, darunter:
  - Schweizer Gemeindegrenzen (von swisstopo)
  - Schweizer Kantonsgrenzen (von swisstopo)
  - Geografische Namen (swissNAMES3D)
  - Farbige Landeskarten der Schweiz
  - Hochauflösendes Schweizer Luftbildmaterial

- **Einfache Layer-Steuerung**
  Schalten Sie jede Ebene mit einfachen Kontrollkästchen in der WME-Oberfläche ein oder aus.

Alle Kartendaten stammen aus offiziellen Schweizer Quellen (swisstopo), so dass Sie auf ihre Genauigkeit vertrauen können.

---

## 💡 Brauchen Sie Hilfe? Haben Sie Ideen?

Wenn Sie Fragen haben, einen Fehler finden oder eine neue Funktion vorschlagen möchten:

1. Gehen Sie zum [Issue Tracker des Projekts](https://github.com/73VW/WME-Switzerland-Helper/issues/new).
2. Klicken Sie auf **"Neues Problem "**.
3. Füllen Sie den Titel aus und beschreiben Sie Ihre Frage, Ihr Problem oder Ihre Idee.  
  (Keine Sorge, wenn Sie neu auf GitHub sind - Sie müssen möglicherweise ein kostenloses Konto erstellen)
4. Reichen Sie Ihr Problem ein. Die Betreuer werden sich so schnell wie möglich bei Ihnen melden.

---

Vielen Dank, dass Sie helfen, Waze für alle in der Schweiz besser zu machen!

## Copyright-Hinweis

Dieses Projekt basiert auf der großartigen Arbeit von Francesco Bedini, der eine Vorlage zur Entwicklung von WME-Benutzerskripten in Typescript erstellt hat. Das Originalprojekt finden Sie [hier](https://github.com/bedo2991/wme-typescript).

Sein Code ist unter der MIT-Lizenz lizenziert, die zum Zeitpunkt der Erstellung dieses Forks [hier](./LICENSE.original) verfügbar war.

Der gesamte Code im Zusammenhang mit dem Docker Devcontainer, den VS-Code-Einstellungen, der Verwendung von Gebietsschemata und der Paketbündelung ("Tools") steht ebenfalls unter der MIT-Lizenz.

Der gesamte Code in `/src/` (und jede Datei mit einem Copyright-Vermerk auf Maël Pedretti) steht unter der [GNU Affero General Public License v3.0 oder später (AGPL)](./LICENSE).

**Zusammenfassung:**
- Die Verwendung des ursprünglichen Codes steht unter der MIT-Lizenz.
- Die Verwendung des von mir hinzugefügten Codes unterliegt den Einschränkungen der AGPL, wie in `LICENSE` beschrieben.

Dieses Projekt ist also **dual-licensed**: Teile unter MIT (Original und Werkzeuge), Teile unter AGPL (alle `/src/` Code und neue Arbeit von Maël Pedretti).
