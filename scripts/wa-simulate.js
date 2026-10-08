// Send a test WhatsApp message to a running VyaparBoss server, as if a buyer texted it.
// Usage: node scripts/wa-simulate.js "5000 3-ply boxes Pune 7 din"  [--from 919800000002] [--url http://localhost:5173]
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i > -1 ? args.splice(i, 2)[1] : null; };
const from = opt("--from") || "919800000002";
const base = opt("--url") || `http://localhost:${process.env.PORT || 5173}`;
const text = args.join(" ");
if (!text) { console.log('Usage: npm run wa -- "5000 3-ply boxes Pune 7 din"'); process.exit(1); }
fetch(`${base}/api/whatsapp/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, text }) })
  .then(r => r.json()).then(j => console.log(j.reply || j.error))
  .catch(e => { console.error(`Couldn't reach ${base}. Is the server running (npm start)?`, e.message); process.exit(1); });
