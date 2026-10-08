// Builds dist/vyaparboss.html: the whole app in one self-contained file (styles and scripts inlined).
// Used for the claude.ai artifact demo and for sending the demo as an attachment.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "src");
let html = fs.readFileSync(path.join(src, "index.html"), "utf8");
html = html.replace(/<link rel="stylesheet" href="styles\.css">/, () => `<style>\n${fs.readFileSync(path.join(src, "styles.css"), "utf8")}</style>`);
html = html.replace(/<script src="(js\/[\w-]+\.js)"><\/script>\n?/g, (_, f) => `<script>\n${fs.readFileSync(path.join(src, f), "utf8")}</script>\n`);
if (process.argv.includes("--fragment")) {
  // Artifact hosts wrap the page in their own document skeleton.
  html = html.replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, "").replace(/<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/i, "")
             .replace(/<\/head>\s*<body>/i, "").replace(/<\/body>\s*<\/html>\s*$/i, "");
}
fs.mkdirSync(path.join(__dirname, "..", "dist"), { recursive: true });
const out = path.join(__dirname, "..", "dist", process.argv.includes("--fragment") ? "vyaparboss-artifact.html" : "vyaparboss.html");
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
