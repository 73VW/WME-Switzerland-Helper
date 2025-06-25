import i18next from "i18next";
import * as enCommon from "./en/common.json";
import * as frCommon from "./fr/common.json";
import * as itCommon from "./it/common.json";
import * as deCommon from "./de/common.json";

export const defaultNS = "common"; // Default name space

i18next.init({
  lng: "en", // Default language
  fallbackLng: "en", // Fallback language
  resources: {
    en: {
      common: enCommon,
    },
    fr: {
      common: frCommon,
    },
    it: {
      common: itCommon,
    },
    de: {
      common: deCommon,
    },
  },
});

export default i18next;
