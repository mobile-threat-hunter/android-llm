#!/usr/bin/env node
// android-llm CLI — 통합 MCP와 같은 도구를 터미널 명령으로. 웹 콘솔 터미널과 문법이 같다(core/cli.mjs).
//   node mcp/cli.mjs app.apk                    대화형 (help, exit)
//   node mcp/cli.mjs app.apk xref_summary       한 번 실행하고 종료
//   node mcp/cli.mjs app.apk -e "dex_iocs" -e "xref_native"
import readline from "node:readline";
import { createNodeBackend } from "./backend-node.mjs";
import { createSuite, renderResult } from "../core/suite.mjs";
import { parseCommand, helpText } from "../core/cli.mjs";

const argv = process.argv.slice(2);
const quiet = argv.includes("-q");
const rest = argv.filter(a => a !== "-q");
let apk = rest[0] && !rest[0].startsWith("-") && /\.(apk|dex|xml|zip|jar|apks|bin)$/i.test(rest[0]) ? rest.shift() : null;
const cmds = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "-e") cmds.push(rest[++i]);
  else { cmds.push(rest.slice(i).join(" ")); break; }
}

const be = await createNodeBackend({ log: quiet ? () => {} : (s) => process.stderr.write("\x1b[2m" + s + "\x1b[0m\n") });
const suite = createSuite(be);
await be.ready();

async function run(line) {
  line = line.trim();
  if (!line) return;
  if (line === "help" || line.startsWith("help ")) { console.log(helpText(suite.list(), line.slice(5).trim() || undefined)); return; }
  const c = parseCommand(suite.list(), line);
  const t0 = Date.now();
  try {
    console.log(renderResult(await suite.call(c.name, c.args)));
    if (!quiet) process.stderr.write(`\x1b[2m(${c.name} ${Date.now() - t0}ms)\x1b[0m\n`);
  } catch (e) { console.error("error:", e && e.message || e); process.exitCode = 1; }
}

if (apk) await run(`suite_load path=${JSON.stringify(apk)}`);
if (cmds.length) {
  for (const c of cmds) { try { await run(c); } catch (e) { console.error("error:", e.message); process.exitCode = 1; } }
  process.exit();
}

const rl = readline.createInterface({
  input: process.stdin, output: process.stdout, prompt: "android-llm> ",
  completer: (line) => {
    const names = suite.list().map(t => t.name).concat(["help", "exit"]);
    const w = line.split(/\s+/).pop();
    const hits = names.filter(n => n.startsWith(w));
    return [hits.length ? hits : names, w];
  },
});
rl.prompt();
rl.on("line", async (line) => {
  if (/^(exit|quit)$/.test(line.trim())) { rl.close(); return; }
  rl.pause();
  try { await run(line); } catch (e) { console.error("error:", e.message); }
  rl.resume(); rl.prompt();
});
rl.on("close", () => process.exit());
