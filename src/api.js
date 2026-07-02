import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { MOCK_SITES, MOCK_AP_DETAIL } from "./mockData";

/**
 * 전체 지점 목록(상세현황)을 가져옵니다.
 * Supabase가 설정되어 있으면 site_info 테이블을 조회하고,
 * 아니면 데모용 목업 데이터를 반환합니다.
 */
export async function fetchSites() {
  if (!isSupabaseConfigured) {
    await delay(150);
    return MOCK_SITES;
  }

  const { data, error } = await supabase
    .from("site_info")
    .select("id, gugun, install_year, location, address, service_photo_path")
    .order("id", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 특정 지점(site_id)에 설치된 AP 목록(AP세부사항)을 가져옵니다.
 */
export async function fetchApDetailsBySite(siteId) {
  if (!isSupabaseConfigured) {
    await delay(150);
    return MOCK_AP_DETAIL.filter((a) => a.site_id === siteId);
  }

  const { data, error } = await supabase
    .from("ap_detail")
    .select(
      "id, site_id, ap_no, in_out, install_point, device_status, network_status, survey_date, remark, photo_path"
    )
    .eq("site_id", siteId)
    .order("ap_no", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 전체 AP 목록을 한 번에 가져옵니다 (목록 화면에서 지점별 대수·상태 요약용).
 */
export async function fetchAllApDetails() {
  if (!isSupabaseConfigured) {
    await delay(150);
    return MOCK_AP_DETAIL;
  }

  const { data, error } = await supabase
    .from("ap_detail")
    .select("id, site_id, device_status, network_status");

  if (error) throw error;
  return data;
}

/**
 * Storage 경로를 공개 URL로 변환합니다.
 * bucket 예: "service-photos", "ap-photos"
 */
export function resolvePhotoUrl(bucket, path) {
  if (!path) return null;
  if (!isSupabaseConfigured) return null; // 데모 모드에서는 실제 사진 없음
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
