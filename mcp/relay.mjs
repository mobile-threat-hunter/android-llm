// MCP ↔ 브라우저 중계 — 로컬에서 띄운 통합 콘솔(exe 또는 serve.sh)이 이 WebSocket에 붙으면
// MCP 도구 호출을 그 브라우저 탭이 실행한다(같은 core/suite.mjs, 화면에 열린 엔진·세션 그대로).
//
// 보안: 127.0.0.1에만 열고, Host가 루프백이고 Origin이 루프백 페이지(http://127.0.0.1:* / localhost:*)일 때만 받는다.
// 다른 웹사이트는 Origin을 속일 수 없고, DNS rebinding은 Origin·Host 검사에서 걸린다.
// 오가는 것은 분석 도구 호출(core/suite.mjs의 도구)뿐 — 셸·파일 시스템 명령은 없다.
//
// 프로토콜 (JSON 텍스트 프레임)
//   browser → mcp : { type: "hello", file, tools, versions }   연결·파일 변경 때
//                   { type: "focus" }                          이 탭을 주 실행 탭으로
//                   { type: "result", id, ok, result | error }
//   mcp → browser : { type: "call", id, name, args }
import { WebSocketServer } from "ws";

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
export const DEFAULT_PORT = 47361;

export function startRelay({ port = DEFAULT_PORT, log = () => {} } = {}) {
  const tabs = [];          // 최근에 focus/hello 한 탭이 마지막
  const pending = new Map();
  let nextId = 1, listening = false, error = null;

  const wss = new WebSocketServer({
    host: "127.0.0.1", port, maxPayload: 512 * 1024 * 1024,
    verifyClient: ({ origin, req }) => LOOPBACK_ORIGIN.test(origin || "") && LOOPBACK_HOST.test(req.headers.host || ""),
  });
  wss.on("listening", () => { listening = true; log(`browser relay: ws://127.0.0.1:${port}`); });
  wss.on("error", (e) => { error = e.code === "EADDRINUSE" ? `포트 ${port} 사용 중 (다른 android-llm MCP가 중계 중?)` : String(e.message || e); log("browser relay off: " + error); });

  const promote = (t) => { const i = tabs.indexOf(t); if (i >= 0) tabs.splice(i, 1); tabs.push(t); };
  wss.on("connection", (ws, req) => {
    const tab = { ws, origin: req.headers.origin, state: null, since: new Date().toISOString() };
    promote(tab);
    log(`browser connected (${tab.origin})`);
    ws.on("message", (buf) => {
      let m; try { m = JSON.parse(buf); } catch (_) { return; }
      if (m.type === "hello") { tab.state = { file: m.file, tools: m.tools, versions: m.versions }; promote(tab); }
      else if (m.type === "focus") promote(tab);
      else if (m.type === "result" && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
      }
    });
    ws.on("close", () => {
      const i = tabs.indexOf(tab); if (i >= 0) tabs.splice(i, 1);
      for (const [id, p] of pending) if (p.tab === tab) { pending.delete(id); p.reject(new Error("브라우저 탭 연결이 끊겼습니다")); }
      log("browser disconnected");
    });
  });

  const primary = () => tabs[tabs.length - 1] || null;
  return {
    connected: () => !!primary(),
    info: () => ({
      relay: listening ? `ws://127.0.0.1:${port}` : null, ...(error ? { error } : {}),
      browsers: tabs.length,
      executor: primary() ? { origin: primary().origin, file: primary().state && primary().state.file, since: primary().since } : null,
    }),
    call(name, args, { timeout = 600000 } = {}) {
      const tab = primary();
      if (!tab) return Promise.reject(new Error("연결된 브라우저 탭이 없습니다"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`브라우저 응답 시간 초과 (${name})`)); }, timeout);
        pending.set(id, { tab, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        tab.ws.send(JSON.stringify({ type: "call", id, name, args }));
      });
    },
    close: () => wss.close(),
  };
}
