// axmlllm 매니페스트 트리 → apkllm 설치 게이트 입력. 웹 브리지(suite-bridge.js)와 통합 MCP가 같이 쓴다.
//
// 미선언 값은 플랫폼 기본값을 쓴다 (추측이 아니라 파서 동작):
//   extractNativeLibs 미선언 → true (ParsingPackageUtils: bool(true, …extractNativeLibs))
//   targetSdkVersion 미선언 → minSdkVersion, 그것도 없으면 1
// 리소스 참조·코드네임처럼 정적으로 확정할 수 없는 값은 unknown(v: null)으로 둔다.
// <manifest split="…">가 없으면 base APK. split이면 extractNativeLibs·targetSdk·isolatedSplits는
// base 매니페스트 값이라(apkllm docs/usage.md) 이 매니페스트만으로는 모른다 → unknown.
export function manifestFacts(tree) {
  const root = tree && tree.root;
  if (!root) return null;
  const attr = (n, k) => n && (n.attributes || []).find(a => a.key === k);
  const kid = (n, tag) => n && (n.children || []).find(c => c.tag === tag);
  const app = kid(root, 'application'), sdk = kid(root, 'uses-sdk');
  const f = {};
  const bool = (a, dflt) => !a ? { v: dflt, why: `미선언 → 기본 ${dflt}` }
    : (a.value === true || a.value === false || a.value === 'true' || a.value === 'false')
      ? { v: String(a.value) === 'true', why: '선언값' }
      : { v: null, why: `정적 확정 불가 (${a.value})` };

  const split = attr(root, 'split');
  if (split) {
    const BASE = { v: null, why: 'split — base 매니페스트 값' };
    f.role = { v: 'split', why: `split="${split.value}"` };
    f.enl = BASE; f.tsdk = BASE; f.iso = BASE;
    f.feat = bool(attr(root, 'isFeatureSplit'), false);
    const cfg = attr(root, 'configForSplit');
    f.cfg = { v: !!cfg, why: cfg ? `configForSplit="${cfg.value}"` : '미선언' };
    return f;
  }
  f.role = { v: 'base', why: 'split 속성 없음' };
  f.iso = bool(attr(root, 'isolatedSplits'), false);
  f.feat = { v: false, why: 'base' };
  f.cfg = { v: false, why: 'base' };

  f.enl = bool(attr(app, 'extractNativeLibs'), true);
  if (!attr(app, 'extractNativeLibs')) f.enl.why = '미선언 → 플랫폼 기본 true';

  const isInt = a => a && Number.isInteger(Number(a.value)) && String(a.value).trim() !== '';
  const t = attr(sdk, 'targetSdkVersion'), m = attr(sdk, 'minSdkVersion');
  if (isInt(t)) f.tsdk = { v: Number(t.value), why: '선언값' };
  else if (t) f.tsdk = { v: null, why: `정적 확정 불가 (${t.value})` };
  else if (isInt(m)) f.tsdk = { v: Number(m.value), why: '미선언 → minSdkVersion' };
  else if (m) f.tsdk = { v: null, why: `정적 확정 불가 (min ${m.value})` };
  else f.tsdk = { v: 1, why: '미선언 → 기본 1' };
  return f;
}

// 사실 → apkllm worker "gate" 메시지 인자 (apkllm index.html gateParams()와 같은 모양)
export function gateParams(f, pageSize = 4096) {
  return {
    extractNativeLibs: f.enl.v, targetSdk: f.tsdk.v, pageSize,
    apkRole: f.role.v, isolatedSplits: f.iso.v, featureSplit: f.feat.v, configForSplit: f.cfg.v,
  };
}

export const FACT_LABELS = {
  enl: 'extractNativeLibs', tsdk: 'targetSdk', role: 'apk_role',
  iso: 'isolatedSplits', feat: 'feature split', cfg: 'configForSplit',
};
