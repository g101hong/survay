import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { MOCK_SITES, MOCK_AP_DETAIL, MOCK_SURVEY_LOG } from "./mockData";

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
      "id, site_id, ap_no, in_out, install_point, device_status, network_status, survey_date, remark, photo_path, survey_photo_path, download_mbps, latency_ms, measured_at, measurement_method, wifi_confirmed"
    )
    .eq("site_id", siteId)
    .order("ap_no", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 전체 AP 목록을 한 번에 가져옵니다 (목록/대시보드 화면에서 지점별 대수·상태 요약용).
 */
export async function fetchAllApDetails() {
  if (!isSupabaseConfigured) {
    await delay(150);
    return MOCK_AP_DETAIL;
  }

  const { data, error } = await supabase
    .from("ap_detail")
    .select("id, site_id, ap_no, in_out, install_point, device_status, network_status, survey_date");

  if (error) throw error;
  return data;
}

/**
 * 전체 조사이력(survey_log)을 가져옵니다.
 * 대시보드의 "반복 불량 / 상태 악화" 분석에 사용됩니다.
 */
export async function fetchAllSurveyLogs() {
  if (!isSupabaseConfigured) {
    await delay(150);
    return MOCK_SURVEY_LOG;
  }

  const { data, error } = await supabase
    .from("survey_log")
    .select("id, ap_id, device_status, network_status, survey_date, remark")
    .order("survey_date", { ascending: true });

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

/**
 * 현장조사 결과를 저장합니다.
 * 1) 사진이 있으면 ap-survey-photos 버킷에 업로드
 * 2) ap_detail을 최신 상태로 UPDATE
 * 3) survey_log에 이번 조사 결과를 새 행으로 INSERT (이력 보존, 삭제/수정 없음)
 *
 * @param {Object} params
 * @param {number} params.apId - Storage 파일 경로 생성에도 사용 (ASCII-safe해야 함)
 * @param {string} params.apNo
 * @param {string} [params.location] - 참고용(현재 파일 경로에는 미사용, 한글이 포함될 수 있어 Storage key 생성에서 제외됨)
 * @param {"정상"|"불량"} params.deviceStatus
 * @param {"정상"|"불량"} params.networkStatus
 * @param {string} params.remark
 * @param {File|null} params.photoFile
 * @param {{downloadMbps:number, latencyMs:number|null, measuredAt:string}|null} [params.networkTest] - 통신상태 실측 결과 (networkTest.js의 runNetworkTest 반환값). 없으면 수동 입력으로 간주.
 * @param {boolean|null} [params.wifiConfirmed] - 측정 전 "와이파이 연결 확인" 체크 여부
 * @returns {Promise<Object>} 갱신된 ap_detail 행 (데모 모드 포함)
 */
export async function submitSurvey({
  apId,
  apNo,
  location,
  deviceStatus,
  networkStatus,
  remark,
  photoFile,
  networkTest = null,
  wifiConfirmed = null,
}) {
  const surveyDate = new Date().toISOString().slice(0, 10);

  // 실측 결과가 있으면 auto, 없으면(수동 선택만 한 경우) manual로 기록합니다.
  const measurementFields = networkTest
    ? {
        download_mbps: networkTest.downloadMbps,
        latency_ms: networkTest.latencyMs,
        measured_at: networkTest.measuredAt,
        measurement_method: "auto",
        wifi_confirmed: wifiConfirmed,
      }
    : {
        download_mbps: null,
        latency_ms: null,
        measured_at: null,
        measurement_method: "manual",
        wifi_confirmed: wifiConfirmed,
      };

  if (!isSupabaseConfigured) {
    await delay(400);
    // 데모 모드: 메모리 상의 목업 데이터를 갱신해 화면에 즉시 반영합니다.
    // (새로고침하면 초기 목업으로 되돌아갑니다 — 실제 저장소가 아니기 때문)
    const target = MOCK_AP_DETAIL.find((a) => a.id === apId);
    const surveyPhotoPath = photoFile ? `ap${apId}_${surveyDate}(demo)` : target?.survey_photo_path ?? null;
    if (target) {
      target.device_status = deviceStatus;
      target.network_status = networkStatus;
      target.survey_date = surveyDate;
      target.remark = remark;
      target.survey_photo_path = surveyPhotoPath;
      Object.assign(target, measurementFields);
    }
    return { ...target };
  }

  let surveyPhotoPath = null;
  if (photoFile) {
    const ext = photoFile.name?.split(".").pop() || "jpg";
    // ⚠️ Supabase Storage는 파일 경로(key)에 한글 등 비ASCII 문자를 허용하지 않아
    // "Invalid key" 오류가 발생합니다. 따라서 한글이 포함될 수 있는 location 대신
    // ASCII-safe한 apId(연번)만 사용해 경로를 만듭니다.
    const path = `ap${apId}_${surveyDate}_${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("ap-survey-photos")
      .upload(path, photoFile, { upsert: true, contentType: photoFile.type });
    if (uploadError) throw uploadError;
    surveyPhotoPath = path;
  }

  const { data: updated, error: updateError } = await supabase
    .from("ap_detail")
    .update({
      device_status: deviceStatus,
      network_status: networkStatus,
      survey_date: surveyDate,
      remark,
      ...(surveyPhotoPath ? { survey_photo_path: surveyPhotoPath } : {}),
      ...measurementFields,
    })
    .eq("id", apId)
    .select()
    .single();
  if (updateError) throw updateError;

  const { error: logError } = await supabase.from("survey_log").insert({
    ap_id: apId,
    device_status: deviceStatus,
    network_status: networkStatus,
    survey_date: surveyDate,
    survey_photo_path: surveyPhotoPath,
    remark,
    ...measurementFields,
  });
  if (logError) throw logError;

  return updated;
}
