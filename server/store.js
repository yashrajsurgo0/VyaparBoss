// Tiny JSON-file database. Good for the pilot (one server, low volume).
// Swap for Postgres/SQLite when you have more than a handful of concurrent users.
const fs = require("fs");
const path = require("path");

class Store {
  constructor(file, seed) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      this.data = seed();
      this.save();
    }
    this.data.suppliers ||= [];
    this.data.useSamples ??= true;
    this.data.whatsapp ||= { sessions: {}, log: [] };
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file); // atomic replace so a crash never leaves half a file
  }
  publicState() {
    const { orders, rfqs, seq, suppliers, useSamples } = this.data;
    return { orders, rfqs, seq, suppliers, useSamples };
  }
}

module.exports = { Store };
