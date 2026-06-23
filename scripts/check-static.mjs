import { access, readFile } from "node:fs/promises";

const required = [
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "public/manifest.webmanifest",
  "public/image/forge-logo.png",
  "supabase/schema.sql",
  "api/[...path].js",
  "api/data.js",
  "vercel.json",
];

await Promise.all(required.map((file) => access(file)));

const html = await readFile("public/index.html", "utf8");
for (const asset of ["/styles.css", "/app.js", "/image/forge-logo.png"]) {
  if (!html.includes(asset)) {
    throw new Error(`index.html does not reference ${asset}`);
  }
}

console.log("Static files are present and linked.");
