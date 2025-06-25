import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "main.user.ts",
  output: {
    file: ".out/main.user.js",
    format: "iife",
    name: "WmeScript",
    sourcemap: "inline",
  },
  plugins: [nodeResolve(), commonjs(), json(), typescript()],
};
