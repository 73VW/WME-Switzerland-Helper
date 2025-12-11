# Aiuto WME Svizzera

Benvenuti! Questo strumento è stato progettato per rendere la modifica dell'editor di mappe Waze (WME) più semplice ed efficace per tutti coloro che lavorano sulle mappe in Svizzera - non è richiesto alcun background tecnico.

---

## 📚 Documentazione nella vostra lingua

Scegliere la lingua preferita:

- 🇬🇧 [Inglese](./README.md)
- 🇫🇷 [Francese](./README.fr.md)
- 🇮🇹 [Italiano](./README.it.md)
- 🇩🇪 [Tedesco](./README.de.md)

---

## 🚀 Cos'è questo script?

**WME Switzerland Helper** è un componente aggiuntivo gratuito per Waze Map Editor. Aggiunge nuove funzionalità e dati ufficiali sulle mappe svizzere, rendendo più facile modificare e migliorare le mappe della Svizzera.

Non è necessario essere programmatori o avere particolari competenze tecniche per utilizzarlo!

---

## 🛠️ Come installare e utilizzare

1. **Installare Tampermonkey**
   Tampermonkey è un'estensione gratuita del browser che consente di aggiungere script utili ai siti web.

- [Ottenere Tampermonkey per Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- Per altri browser, cercate "Tampermonkey" nel negozio di estensioni/add-on del vostro browser.

2. **Aggiungi il WME Switzerland Helper Script**

- Dopo aver installato Tampermonkey, fare clic su questo link:  
  [Installare WME Switzerland Helper](https://raw.githubusercontent.com/73VW/WME-Switzerland-Helper/releases/releases/main.user.js)
- Il browser mostrerà una pagina che chiede se si desidera installare lo script. Fare clic sul pulsante <kbd>Installa</kbd>.

3. \*\*Iniziare a modificare!

- Aprite il [Waze Map Editor](https://www.waze.com/editor?tab=userscript_tab).
- Vedrete nuove opzioni e una breve spiegazione nella scheda `Scripts`.

_Ecco fatto! Lo script viene eseguito automaticamente quando si utilizza l'Editor mappe di Waze._

---

## 🌟 Caratteristiche

Con questo script, otterrete:

- **Livelli di mappa ufficiali della Svizzera**
  Aggiunta e visualizzazione di livelli cartografici aggiuntivi direttamente in WME, tra cui:
  - Confini comunali svizzeri (da swisstopo)
  - Confini cantonali svizzeri (da swisstopo)
  - Nomi geografici (swissNAMES3D)
  - Carte nazionali svizzere a colori
  - Immagini aeree svizzere ad alta risoluzione
  - Fermate del trasporto pubblico

- **Controlli facili per i livelli**
  Attivate o disattivate ogni livello con semplici caselle di controllo nell'interfaccia di WME.

Tutti i dati cartografici provengono da fonti ufficiali svizzere (swisstopo), quindi potete fidarvi della loro accuratezza.

### Come funziona il livello delle fermate dei trasporti pubblici

Il livello **Fermate dei trasporti pubblici** mostra le fermate ufficiali del trasporto pubblico dal database delle Ferrovie federali svizzere (SBB). Ecco cosa dovete sapere:

- **Indicatore visivo**: Le fermate appaiono come **icone circolari arancioni** sulla mappa
- **Abbinamento intelligente**: Lo script controlla automaticamente la presenza di location all'interno di un raggio di **75 metri** per evitare duplicati
- **Deduplicazione**: Se una location già esiste con lo stesso nome e tipo entro **5 metri**, non verrà disegnata sulla mappa (per evitare marcatori sovrapposti)
- **Cliccate per aggiungere**: Quando fate clic su un marcatore di fermata, potete:
  - Creare una nuova location se non ne esiste nessuna nelle vicinanze
  - Fonderla con una location esistente con lo stesso nome
  - Aggiornare le coordinate della location esistente
- **Tipi supportati**: Il livello include fermate per autobus, tram, treni, barche e funivie in tutta la Svizzera

---

## 💡 Avete bisogno di aiuto? Avete idee?

Se avete domande, trovate un bug o volete suggerire una nuova funzionalità:

1. Andate al [issue tracker del progetto](https://github.com/73VW/WME-Switzerland-Helper/issues/new).
2. Cliccare su **"Nuovo problema "**.
3. Compilare il titolo e descrivere la domanda, il problema o l'idea.  
   (Non preoccupatevi se siete nuovi su GitHub: potrebbe essere necessario creare un account gratuito)
4. Invia il tuo problema. I manutentori vi risponderanno al più presto.

---

Grazie per aver contribuito a rendere Waze migliore per tutti in Svizzera!

---

## 📝 Changelog

### v1.2.1
- 💾 Stato delle caselle dei livelli conservato tra i reload
- ⚡ Rendering più veloce; si aggiornano solo elementi nuovi/rimossi

### v1.2.0
- 🚏 Layer Fermate trasporto pubblico con gestione del click

### v1.1.0
- 🗺️ Aggiunto overlay swissNAMES3D

### v1.0.0
- 🎉 Prima versione con confini comunali/cantonali e mappe nazionali

---

## Avviso di copyright

Questo progetto si basa sul fantastico lavoro di Francesco Bedini, che ha creato un modello per sviluppare gli userscript di WME in Typescript. Potete trovare il progetto originale [qui](https://github.com/bedo2991/wme-typescript).

Il suo codice è rilasciato sotto la Licenza MIT, disponibile [qui](./LICENSE.original) al momento della creazione di questo fork.

Tutto il codice relativo al devcontainer Docker, alle impostazioni di VS Code, all'uso dei locales e al raggruppamento dei pacchetti ("Tools") è anch'esso rilasciato sotto licenza MIT.

Tutto il codice in `/src/` (e qualsiasi file con una menzione di copyright a Maël Pedretti) è concesso in licenza secondo la [GNU Affero General Public License v3.0 o successiva (AGPL)](./LICENSE).

**Riepilogo:**

- L'uso del codice originale rimane sotto la Licenza MIT.
- L'uso del codice aggiunto è limitato sotto AGPL come descritto in `LICENSE`.

Questo progetto ha quindi una **doppia licenza**: porzioni sotto MIT (originale e strumenti), porzioni sotto AGPL (tutto il codice `/src/` e il nuovo lavoro di Maël Pedretti).
