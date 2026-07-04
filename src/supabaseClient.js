import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Supabase 환경변수가 없으면 null을 내보냅니다.
// 이 경우 api.js는 자동으로 데모(목업) 데이터를 사용합니다.
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;

// 개발 환경(로컬 npm run dev)에서만 진단 로그를 출력합니다.
// Vite의 import.meta.env.DEV는 빌드 시점에 상수로 확정되므로, 프로덕션
// 빌드(Render 배포본)에는 이 블록 자체가 데드코드로 제거되어 포함되지
// 않습니다("환경변수를 넣었는데 왜 계속 데모 데이터가 보이지?"를 진단하는
// 용도는 로컬 개발 중에만 필요하고, 배포 후에는 브라우저 콘솔에 남길
// 이유가 없습니다).
//
// ⚠️ 기존 코드는 프로덕션에서도 항상 실행되며, URL을 정규식으로 일부만
// 마스킹(`https://hkug***`)해 노출을 줄이려 했습니다. 하지만 Supabase URL은
// anon key와 마찬가지로 프론트엔드 JS 번들 자체에 이미 평문으로 포함되어
// 있어(개발자도구 소스/Network 탭에서 그대로 보임), 일부 마스킹은 실질적인
// 보호 효과 없이 "가려졌으니 안전하다"는 잘못된 인상만 줄 뿐이었습니다.
// 그래서 마스킹 로직은 제거하고, 로그 자체를 개발 환경으로만 한정했습니다.
if (import.meta.env.DEV) {
  if (isSupabaseConfigured) {
    console.info(`[wifi-survey] Supabase 연동됨 → ${url}`);
  } else {
    console.warn(
      "[wifi-survey] Supabase 환경변수가 감지되지 않아 데모(목업) 데이터로 동작 중입니다.\n" +
        `  VITE_SUPABASE_URL: ${url ? "설정됨" : "❌ 없음"}\n` +
        `  VITE_SUPABASE_ANON_KEY: ${anonKey ? "설정됨" : "❌ 없음"}\n` +
        "  → 로컬: .env 파일 위치/이름/재시작 확인. 배포(Render): 환경변수 저장 후 반드시 재배포(Rebuild) 필요 " +
        "(Vite는 빌드 시점에 값을 코드에 굳혀 넣기 때문에, 배포된 정적 파일은 재빌드 전까지 예전 값을 그대로 씁니다)."
    );
  }
}
