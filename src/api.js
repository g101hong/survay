import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Supabase 환경변수가 설정되어 있지 않으면 즉시 에러를 던집니다.
 * (별도의 대체 데이터 없이, 항상 실제 Supabase 연결이 있어야 동작합니다.)
 */
function requireSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase 환경변수가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인하세요."
    );
  }
}

/**
 * 전체 지점 목록(상세현황)을 가져옵니다.
 */
export async function fetchSites() {
  requireSupabase();

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
  requireSupabase();

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
  requireSupabase();

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
  requireSupabase();

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
  if (!isSupabaseConfigured) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? null;
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
 * @returns {Promise<Object>} 갱신된 ap_detail 행
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
  requireSupabase();

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

/**
 * 공용 접속 코드(PIN)를 서버(Supabase RPC)에서 검증합니다.
 * PIN 값과 비교 로직은 클라이언트에 전혀 노출되지 않고, 전부 DB 함수 안에서 처리됩니다.
 *
 * @param {string} pin - 사용자가 입력한 코드
 * @returns {Promise<{ok: true, token: string} | {ok: false, error: "invalid"|"locked"|"not_configured", wait_seconds?: number}>}
 */
export async function verifySurveyPin(pin) {
  requireSupabase();

  const { data, error } = await supabase.rpc("verify_survey_pin", { input_pin: pin });
  if (error) throw error;
  return data;
}

/**
 * 로컬에 저장된 세션 토큰이 서버에서도 여전히 유효한지 확인합니다.
 * (localStorage 값을 그냥 믿지 않고, 매번 서버에 실제로 조회합니다.)
 *
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function checkSurveySession(token) {
  if (!token) return false;
  requireSupabase();

  const { data, error } = await supabase.rpc("check_survey_session", { input_token: token });
  if (error) return false;
  return Boolean(data);
}
