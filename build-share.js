// Build a single-file shareable copy of the WDW Trip Planner.
// Run: node build-share.js
// Produces: wdw-trip-planner-share.html (give this to anyone, they double-click to use it).

const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const ratesJs = fs.readFileSync("rates.js", "utf8");
const diningJs = fs.readFileSync("dining.js", "utf8");
const ticketsJs = fs.readFileSync("tickets.js", "utf8");
const appJs = fs.readFileSync("app.js", "utf8");

let bundled = html;
bundled = bundled.replace(/<script\s+src="rates\.js[^"]*"><\/script>/g,
  "<script>\n" + ratesJs + "\n</script>");
bundled = bundled.replace(/<script\s+src="dining\.js[^"]*"><\/script>/g,
  "<script>\n" + diningJs + "\n</script>");
bundled = bundled.replace(/<script\s+src="tickets\.js[^"]*"><\/script>/g,
  "<script>\n" + ticketsJs + "\n</script>");
bundled = bundled.replace(/<script\s+src="app\.js[^"]*"><\/script>/g,
  "<script>\n" + appJs + "\n</script>");

const outPath = "wdw-trip-planner-share.html";
fs.writeFileSync(outPath, bundled);
console.log(`Bundle written: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
console.log("Anyone can double-click that file to open the planner — no install, no server needed.");
