// Loads the browser engine (src/js) into a Node sandbox so the server prices, ranks and parses
// with exactly the same code the app runs. One source of truth, no build step.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILES = ["data", "util", "engine", "parser"];
const EXPORTS = [
  "PRODUCTS", "PMAP", "CITIES", "CATS", "SAMPLE_SUPPLIERS", "STAGES", "setSuppliers", "getSuppliers", "getSMAP",
  "ruleParse", "applyParsed", "missing", "cleanParsed", "buildParsePrompt", "buildReplyPrompt",
  "discover", "negotiate", "quoteSummary", "rfqRecord", "orderRecord", "buildSampleData", "quoteMessage",
  "normalizeSupplier", "normalizeAccount", "normalizeLead", "mergeLeads", "renderOutreach", "outreachVars", "normalizeJoin", "normalizeLiveQuote", "liveMap", "parseCSV", "toCSV", "fillTemplate", "isEmail", "OUTREACH_TEMPLATES", "LEAD_STATUSES", "renderWhatsAppPitch", "renderCallScript", "mobileOf", "tierPrice", "freightCost", "km", "rfqIdFor", "poIdFor", "checkGstin", "parseTiers", "inr", "qfmt", "unitOne",
];

function loadCore() {
  const src = FILES.map(f => fs.readFileSync(path.join(__dirname, "..", "src", "js", f + ".js"), "utf8")).join("\n;\n");
  const ctx = vm.createContext({ console, Date, Math, Intl, JSON });
  vm.runInContext(
    src + "\nfunction getSuppliers(){return SUPPLIERS;}\nfunction getSMAP(){return SMAP;}\nthis.__core={" + EXPORTS.join(",") + "};",
    ctx, { filename: "vyaparboss-core.js" });
  // Values created inside the sandbox have their own prototypes; round-trip through JSON before deep-comparing.
  return ctx.__core;
}

module.exports = { loadCore };
