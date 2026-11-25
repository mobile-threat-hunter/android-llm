// 시작 전 점검 — 엔진 3개(서브모듈)와 node 패키지가 없으면 알아보기 힘든 import 오류 대신 원인과 해결 명령을 알린다.
// 이 파일은 node 내장 모듈만 쓴다(패키지·서브모듈이 없어도 실행돼야 하므로). server.mjs·cli.mjs는 이걸 먼저 부르고 나머지를 dynamic import한다.
// 흔한 원인: GitHub의 "Source code (zip)"(서브모듈 없음), --recurse-submodules 없는 clone, npm ci 생략.
import fs from "node:fs";
import path from "node:path";

import { ROOT, MCP_DIR as MCP, ENGINE_FILES, axmlBuild } from "./engines/assets.mjs";   // 내장 모듈만 쓰는 파일

const PACKAGES = ["@modelcontextprotocol/sdk", "ws"];

export function preflight({ packages = true } = {}) {
  const missing = [];
  for (const [dir, files] of Object.entries(ENGINE_FILES))
    if (files.some(f => !fs.existsSync(path.join(ROOT, dir, f)))) missing.push(dir);
  if (!missing.includes("axmlllm-web")) {
    let wheel = null; try { wheel = axmlBuild().wheel; } catch (_) { /* 핀 없음 = 엔진 없음 */ }
    if (!wheel || !fs.existsSync(path.join(ROOT, "axmlllm-web", wheel))) missing.push("axmlllm-web");
  }
  const pkgs = packages ? PACKAGES.filter(p => !fs.existsSync(path.join(MCP, "node_modules", p, "package.json"))) : [];
  if (!missing.length && !pkgs.length) return;

  const git = fs.existsSync(path.join(ROOT, ".git"));
  const lines = ["android-llm MCP: 실행에 필요한 파일이 없습니다."];
  if (missing.length) {
    lines.push(`  엔진 없음: ${missing.join(", ")}  (서브모듈 폴더가 비어 있음)`);
    lines.push(git ? `  해결: cd "${ROOT}" && git submodule update --init`
                   : "  해결: GitHub \"Source code (zip)\"에는 엔진이 들어 있지 않습니다 — Release의 android-llm-<ver>-mcp.zip(엔진·패키지 포함)을 받으세요.");
  }
  if (pkgs.length) {
    lines.push(`  node 패키지 없음: ${pkgs.join(", ")}`);
    lines.push(`  해결: cd "${MCP}" && npm ci   (또는 Release의 android-llm-<ver>-mcp.zip)`);
  }
  lines.push("  https://github.com/mobile-threat-hunter/android-llm/releases");
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(1);
}
