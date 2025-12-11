# WME Switzerland Helper

Welcome! This tool is designed to make editing the Waze Map Editor (WME) easier and more effective for everyone working on maps in Switzerland—no technical background required.

---

## 📚 Documentation in Your Language

Choose your preferred language:

- 🇬🇧 [English](./README.md)
- 🇫🇷 [French](./README.fr.md)
- 🇮🇹 [Italian](./README.it.md)
- 🇩🇪 [German](./README.de.md)

---

## 🚀 What Is This Script?

**WME Switzerland Helper** is a free add-on for the Waze Map Editor. It adds new features and official Swiss map data, making it easier to edit and improve maps in Switzerland.

You don’t need to be a programmer or have any special technical skills to use it!

---

## 🛠️ How to Install and Use

1. **Install Tampermonkey**  
   Tampermonkey is a free browser extension that lets you add helpful scripts to websites.

- [Get Tampermonkey for Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- For other browsers, search for "Tampermonkey" in your browser’s extension/add-on store.

2. **Add the WME Switzerland Helper Script**

- After installing Tampermonkey, click this link:  
  [Install WME Switzerland Helper](https://raw.githubusercontent.com/73VW/WME-Switzerland-Helper/releases/releases/main.user.js)
- Your browser will show a page asking if you want to install the script. Click the <kbd>Install</kbd> button.

3. **Start Editing!**

- Open the [Waze Map Editor](https://www.waze.com/editor?tab=userscript_tab).
- You’ll see new options and a short explanation in the `Scripts` tab.

_That’s it! The script runs automatically when you use the Waze Map Editor._

---

## 🌟 Features

With this script, you get:

- **Official Swiss Map Layers**  
  Add and view extra map layers directly in WME, including:
  - Swiss municipal boundaries (from swisstopo)
  - Swiss cantonal boundaries (from swisstopo)
  - Geographic names (swissNAMES3D)
  - Swiss national color maps
  - High-resolution Swiss aerial imagery
  - Public transport stops

- **Easy Layer Controls**  
  Turn each layer on or off with simple checkboxes in the WME interface.

All map data comes from official Swiss sources (swisstopo), so you can trust its accuracy.

### How the Public Transport Stops Layer Works

The **Public Transport Stops** layer displays official public transport stops from the Swiss Federal Railways (SBB) database. Here's what you need to know:

- **Visual Indicator**: Stops appear as **orange circular icons** on the map
- **Smart Matching**: The script automatically checks for existing venues within a **75-meter radius** to avoid duplicates
- **Deduplication**: If a venue already exists with the same name and type within **5 meters**, it won't be drawn on the map (to prevent overlapping markers)
- **Click to Add**: When you click a stop marker, you can:
  - Create a new venue if none exists nearby
  - Merge it with an existing venue with the same name
  - Update existing venue coordinates
- **Types Supported**: The layer includes stops for buses, trams, trains, boats, and cable cars across Switzerland

---

## 💡 Need Help? Have Ideas?

If you have questions, find a bug, or want to suggest a new feature:

1. Go to the [project’s issue tracker](https://github.com/73VW/WME-Switzerland-Helper/issues/new).
2. Click on **"New issue"**.
3. Fill in the title and describe your question, problem, or idea.  
   (Don’t worry if you’re new to GitHub—you may need to create a free account.)
4. Submit your issue. The maintainers will get back to you as soon as possible.

---

Thank you for helping make Waze better for everyone in Switzerland!

---

## 📝 Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### [1.2.2] - 2025-12-11

#### Fixed

- Fixed public transport stops loading all stops on script reload when checkbox was pre-checked. Layer state is now restored after `wme-ready` event to ensure venues data is available before filtering duplicate stops.

### [1.2.1] - 2025-12-10

#### Changed

- 💾 Layer checkbox states persist across reloads
- ⚡ Faster feature-layer rendering; only new/removed features update

### [1.2.0]

#### Added

- 🚏 Public Transport Stops layer with click handling

### [1.1.0]

#### Added

- 🗺️ Added swissNAMES3D overlay

### [1.0.0]

#### Added

- 🎉 Initial release with municipal and cantonal boundaries + national map tiles

---

## Copyright notice

This project is based on the awesome work of Francesco Bedini, who created a template to develop WME userscripts in Typescript. You can find the original project [here](https://github.com/bedo2991/wme-typescript).

His code is licensed under the MIT License, available [here](./LICENSE.original) as of the time this fork was created.

All code related to the Docker devcontainer, VS Code settings, use of locales, and package bundling ("Tools") is also licensed under the MIT License.

All code in `/src/` (and any file with a copyright mentioning Maël Pedretti) is licensed under the [GNU Affero General Public License v3.0 or later (AGPL)](./LICENSE).

**Summary:**

- Use of the original code remains under the MIT License.
- Use of my added code is restricted under AGPL as described in `LICENSE`.

This project is thus **dual-licensed**: portions under MIT (original and tools), portions under AGPL (all `/src/` code and new work by Maël Pedretti).
