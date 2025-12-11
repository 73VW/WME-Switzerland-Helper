/**
 * Portions copyright (c) 2020 Francesco Bedini, MIT license.
 * See LICENSE.original.
 *
 * Substantial modifications copyright (c) 2025 Maël Pedretti.
 * These modifications are dual-licensed under the GNU AGPL v3.0 or later,
 * but the file as a whole remains available under the original MIT license.
 *
 * See LICENSE.original and LICENSE for more details.
 */

import { WmeSDK } from "wme-sdk-typings";
import { TileLayer } from "./src/tileLayer";
import { Layer } from "./src/layer";
import { FeatureLayer } from "./src/featureLayer";
import { PublicTransportStopsLayer } from "./src/publicTransportStopsLayer";
import i18next from "./locales/i18n";
import { SidebarSection } from "./src/sidebar";
import { saveLayerState, isLayerEnabled } from "./src/storage";

const englishScriptName = "WME Switzerland helper";
let scriptName = englishScriptName;

// the sdk initScript function will be called after the SDK is initialized
unsafeWindow.SDK_INITIALIZED.then(initScript);

function initScript() {
  // initialize the sdk, these should remain here at the top of the script
  if (!unsafeWindow.getWmeSdk) {
    // This block is required for type checking, but it is guaranteed that the function exists.
    throw new Error("SDK not available");
  }
  const wmeSDK: WmeSDK = unsafeWindow.getWmeSdk({
    scriptId: "wme-switzerland-helper", // TODO: replace with your script id and script name
    scriptName: englishScriptName, // TODO
  });

  console.debug(
    `SDK v. ${wmeSDK.getSDKVersion()} on ${wmeSDK.getWMEVersion()} initialized`,
  );
  // --- Initialisation améliorée ---
  const layers = new Map<string, Layer>();

  function activateLanguage() {
    const { localeCode } = wmeSDK.Settings.getLocale();
    i18next.changeLanguage(localeCode);
    scriptName = i18next.t("common:scriptName", englishScriptName);
  }

  function createLayers() {
    const layerList = [
      new TileLayer({
        name: i18next.t(
          "common:layers.boundaries.municipality",
          "Municipal boundaries",
        ),
        tileHeight: 256,
        tileWidth: 256,
        fileName: "${z}/${x}/${y}.png",
        servers: [
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill/default/current/3857",
        ],
        zIndex: 2039,
      }),
      new TileLayer({
        name: i18next.t(
          "common:layers.boundaries.state",
          "Cantonal boundaries",
        ),
        tileHeight: 256,
        tileWidth: 256,
        fileName: "${z}/${x}/${y}.png",
        servers: [
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/default/current/3857",
        ],
        zIndex: 2038,
      }),
      new TileLayer({
        name: i18next.t("common:layers.3d", "Geographical Names swissNAMES3D"),
        tileHeight: 256,
        tileWidth: 256,
        fileName: "${z}/${x}/${y}.png",
        servers: [
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissnames3d/default/current/3857",
        ],
        zIndex: 2037,
      }),
      new TileLayer({
        name: i18next.t(
          "common:layers.topo.national_colors",
          "National Maps (color)",
        ),
        tileHeight: 256,
        tileWidth: 256,
        fileName: "${z}/${x}/${y}.jpeg",
        servers: [
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857",
        ],
        zIndex: 2036,
      }),
      new TileLayer({
        name: i18next.t(
          "common:layers.background.swissimage",
          "SWISSIMAGE Background",
        ),
        tileHeight: 256,
        tileWidth: 256,
        fileName: "${z}/${x}/${y}.jpeg",
        servers: [
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857",
        ],
      }),
      new PublicTransportStopsLayer({
        name: i18next.t(
          "common:layers.public_transport_stops",
          "Public Transport Stops",
        ),
        styleRules: [
          {
            style: {
              fillOpacity: 1,
              cursor: "pointer",
              pointRadius: 13,
              externalGraphic:
                "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OSIgaGVpZ2h0PSI0OCIgZmlsbD0iYmxhY2siPjxjaXJjbGUgY3g9IjI0LjcyNiIgY3k9IjI0IiByPSIyMyIgZmlsbD0iI2U2N2UyMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjkuNzI2IDE0YTMgMyAwIDAgMSAyLjk5NSAyLjgyNGwuMDA1LjE3NnYxaDEuMDE3bC4xNS4wMDVjLjkzOC4wNiAxLjc2LjY4NCAxLjg0MyAxLjU5MWwuMDA3LjE1NFYyMmwtLjAwNy4xMTdhMSAxIDAgMCAxLS44NzYuODc2bC0uMTE3LjAwNy0uMTE3LS4wMDdhMSAxIDAgMCAxLS44NzYtLjg3NkwzMy43NDMgMjJ2LTJoLTEuMDE3djEwYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdoLTF2MS41YTEuNSAxLjUgMCAwIDEtMyAwVjMxaC02djEuNWExLjUgMS41IDAgMCAxLTMgMFYzMWgtMWExIDEgMCAwIDEtLjk5My0uODgzTDE2LjcyNiAzMFYyMGgtMXYyYTEgMSAwIDAgMS0uODgzLjk5M2wtLjExNy4wMDdhMSAxIDAgMCAxLS45OTMtLjg4M0wxMy43MjYgMjJ2LTIuMjVjMC0uOTkuODYtMS42ODIgMS44NS0xLjc0NWwuMTUtLjAwNWgxdi0xYTMgMyAwIDAgMSAyLjgyNC0yLjk5NWwuMTc2LS4wMDV6bS0xIDEzaC0xYTEgMSAwIDEgMCAwIDJoMWExIDEgMCAxIDAgMC0ybS03IDBoLTFhMSAxIDAgMSAwIDAgMmgxYTEgMSAwIDEgMCAwLTJtLS40MjktMTFoLTEuNTdsLS4xMTcuMDA3YTEgMSAwIDAgMC0uODc3Ljg3NmwtLjAwNy4xMTd2OGgxMnYtOGwtLjAwNy0uMTE3YTEgMSAwIDAgMC0uNzY0LS44NTdsLS4xMTItLjAyLS4xMTctLjAwNmgtMS41NzJsLS44NTQgMS40OTYtLjA2NS4xYTEgMSAwIDAgMS0uODAzLjQwNEgyMy4wMmwtLjExOS0uMDA3YTEgMSAwIDAgMS0uNzUtLjQ5N3oiLz48c2NyaXB0IHhtbG5zPSIiLz48L3N2Zz4=",
            },
          },
        ],
      }),
    ];
    for (const layer of layerList) {
      layers.set(layer.name, layer);
    }
  }

  function registerLayerCheckboxes() {
    for (const layer of layers.values()) {
      layer.addCheckBox({ wmeSDK });
    }
  }

  function restoreLayerState() {
    for (const layer of layers.values()) {
      const enabled = isLayerEnabled(layer.name);
      if (enabled === true) {
        layer.addToMap({ wmeSDK });
        wmeSDK.LayerSwitcher.setLayerCheckboxChecked({
          name: layer.name,
          isChecked: true,
        });
        if (layer instanceof FeatureLayer) {
          layer.render({ wmeSDK });
        }
      }
    }
  }

  function registerLayerEvents() {
    wmeSDK.Events.on({
      eventName: "wme-layer-checkbox-toggled",
      eventHandler: ({ name, checked }) => {
        const layer = layers.get(name);
        if (!layer) return;
        saveLayerState(name, checked);
        if (checked) {
          layer.addToMap({ wmeSDK });
        } else {
          layer.removeFromMap({ wmeSDK });
        }
      },
    });

    wmeSDK.Events.on({
      eventName: "wme-layer-feature-clicked",
      eventHandler: async ({ featureId, layerName }) => {
        const layer = layers.get(layerName);
        if (layer && layer instanceof FeatureLayer) {
          await layer.featureClicked({ wmeSDK, featureId });
        }
      },
    });

    wmeSDK.Events.on({
      eventName: "wme-map-move-end",
      eventHandler: () => {
        for (const layer of layers.values()) {
          if (layer instanceof FeatureLayer) {
            layer.render({ wmeSDK });
          }
        }
      },
    });
  }

  async function addScriptTab() {
    const { tabLabel, tabPane } = await wmeSDK.Sidebar.registerScriptTab();
    tabLabel.innerText = scriptName;
    tabPane.innerHTML = `<p>${i18next.t("common:introduction", "This script adds map layers that can be activated from the right navigation bar, at the very bottom.")}</p>`;
    tabPane.innerHTML += `<p>${i18next.t("common:readmeLink", "For more information, see the full documentation.")}</p>`;
    const noteText = `<div><p>${i18next.t("common:swissimageUpdateText", 'This <a href ="https://map.geo.admin.ch/#/map?lang=fr&center=2638909.25,1198316.5&z=1.967&topic=swisstopo&layers=ch.swisstopo.images-swissimage-dop10.metadata&bgLayer=ch.swisstopo.pixelkarte-farbe&featureInfo=default&catalogNodes=swisstopo" target="_blank" rel="noopener noreferrer">map</a> shows when the <b>{{layer}}</b> map was updated for each region.', { layer: i18next.t("common:layers.background.swissimage") })}</div></p><p>${i18next.t("common:publicTransportStopsNote", "Public transport stops appear as orange circular icons on the map.")}</p>`;
    tabPane.innerHTML += new SidebarSection({
      name: i18next.t("common:note.layers.background.swissimage", "Notes"),
      icon: "w-icon-alert-info",
    }).render({ content: noteText });
  }

  async function init() {
    activateLanguage();
    createLayers();
    registerLayerCheckboxes();
    registerLayerEvents();
    await addScriptTab();

    // Restore layer state only after WME is fully ready (data loaded, user logged in)
    wmeSDK.Events.once({ eventName: "wme-ready" }).then(() => {
      restoreLayerState();
    });
  }

  init();
}
