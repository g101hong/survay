import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Supabase 환경변수가 없으면 null을 내보냅니다.
// 이 경우 api.js는 자동으로 데모(목업) 데이터를 사용합니다.
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;
