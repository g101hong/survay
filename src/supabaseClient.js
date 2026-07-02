import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Supabase 환경변수가 없으면 null을 내보냅니다.
// 이 경우 api.js는 자동으로 데모(목업) 데이터를 사용합니다.
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;

// 개발/배포 후 "환경변수를 넣었는데 왜 계속 데모 데이터가 보이지?" 를 빠르게
// 진단하기 위한 콘솔 로그입니다. 브라우저 개발자도구(F12) > Console에서 확인하세요.
if (typeof window !== "undefined") {
  if (isSupabaseConfigured) {
    console.info(
      `[wifi-survey] Supabase 연동됨 → ${url.replace(/(https:\/\/)([^.]{4}).*/, "$1$2***")}`
    );
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
