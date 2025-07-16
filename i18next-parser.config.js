
const parserConfig =
{
  input: [
    "src/**/*.{js,ts,jsx,tsx}", // or wherever your source lives
    "main.user.ts",
  ],
  output: "locales/$LOCALE/common.json",
  locales: ["en", "fr", "de", "it"],
  defaultNamespace: "common",
  keySeparator: ".", // Allows 'asdf' instead of 'a.b.c'
  namespaceSeparator: ":", // 'common:asdf'
  keepRemoved: true, // Don’t delete keys, just add new
  createOldCatalogs: false,
  verbose: true,
};
// eslint-disable-next-line no-undef
module.exports = parserConfig;