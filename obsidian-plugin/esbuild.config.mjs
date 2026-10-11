import esbuild from "esbuild";

// One CommonJS bundle, as Obsidian loads plugins; `obsidian` itself is provided by the app.
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: "main.js",
  logLevel: "info",
});
