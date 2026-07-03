import { supabase, isSupabaseConfigured } from "./supabaseClient";

// PinGate.jsx와 동일한 키를 사용해야 세션 토큰을 공유할 수 있습니다.
const TOKEN_KEY = "wifi-survey-pin-token";

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
 * ⚠️ 조회(SELECT)는 RLS 정책상 anon에게 계속 허용되어 있어야 하는 부분입니다.
 *    (site_info / ap_detail / survey_log 세 테이블 모두 "anon_select_*" 정책 적용 전제)
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
 * 현장조사 결과를 저장합니다. (v2 — RLS 우회 취약점 수정)
 * ------------------------------------------------------------------
 * [v1 → v2 변경 사항]
 * v1에서는 이 함수가 supabase.from("ap_detail").update(...) / .insert(...)를
 * 직접 호출했습니다. 이는 PIN 로그인 여부와 무관하게, anon key만 있으면
 * (브라우저 개발자도구에서도) 누구나 테이블을 직접 쓸 수 있는 구조였습니다.
 * RLS 정책이 "allow all"로 되어 있던 개발 단계에서는 물론이고, 정책을
 * SELECT 전용으로 좁혀도 이 함수 자체가 동작을 멈추는 문제가 있었습니다.
 *
 * v2에서는 실제 저장을 Supabase의 SECURITY DEFINER RPC 함수
 * `submit_survey_result`에 위임합니다. 이 함수는 서버(DB)에서 PIN 로그인
 * 세션 토큰(`app_pin_sessions`)의 유효성을 먼저 검증한 뒤에만 UPDATE/INSERT를
 * 수행하므로, anon key만으로는 더 이상 저장이 불가능하고 반드시 유효한
 * 로그인 세션이 있어야 합니다.
 * (서버 측 정의는 supabase_pin_login.sql / submit_survey_result 함수 참고)
 * ------------------------------------------------------------------
 *
 * 1) 사진이 있으면 ap-survey-photos 버킷에 업로드
 * 2) submit_survey_result RPC 호출 → 서버에서 세션 검증 후
 *    ap_detail UPDATE + survey_log INSERT를 원자적으로 처리
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

  // 로그인 세션 토큰이 없으면 서버에 요청을 보내기 전에 즉시 차단합니다.
  // (PinGate를 우회해서 이 함수만 직접 호출하는 경우에 대한 방어이며,
  //  최종 방어선은 어디까지나 서버의 submit_survey_result 함수입니다.)
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    throw new Error("로그인 세션이 만료되었습니다. 코드를 다시 입력해주세요.");
  }

  // 실측 결과가 있으면 auto, 없으면(수동 선택만 한 경우) manual로 기록합니다.
  const measurementFields = networkTest
    ? {
        download_mbps: networkTest.downloadMbps,
        latency_ms: networkTest.latencyMs,
        measured_at: networkTest.measuredAt,
        measurement_method: "auto",
      }
    : {
        download_mbps: null,
        latency_ms: null,
        measured_at: null,
        measurement_method: "manual",
      };

  let surveyPhotoPath = null;
  if (photoFile) {
    const ext = photoFile.name?.split(".").pop() || "jpg";
    // ⚠️ Supabase Storage는 파일 경로(key)에 한글 등 비ASCII 문자를 허용하지 않아
    // "Invalid key" 오류가 발생합니다. 따라서 한글이 포함될 수 있는 location 대신
    // ASCII-safe한 apId(연번)만 사용해 경로를 만듭니다.
    const path = `ap${apId}_${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("ap-survey-photos")
      .upload(path, photoFile, { upsert: true, contentType: photoFile.type });
    if (uploadError) throw uploadError;
    surveyPhotoPath = path;
  }

  const { data: updated, error } = await supabase.rpc("submit_survey_result", {
    input_token: token,
    input_ap_id: apId,
    input_device_status: deviceStatus,
    input_network_status: networkStatus,
    input_remark: remark,
    input_survey_photo_path: surveyPhotoPath,
    input_wifi_confirmed: wifiConfirmed,
    input_download_mbps: measurementFields.download_mbps,
    input_latency_ms: measurementFields.latency_ms,
    input_measured_at: measurementFields.measured_at,
    input_measurement_method: measurementFields.measurement_method,
  });

  if (error) {
    // 세션이 서버에서 이미 만료/무효화된 경우, 로컬 토큰도 함께 정리해
    // 다음 진입 시 PinGate가 재로그인 화면을 보여주도록 합니다.
    if (error.message?.includes("유효하지 않은 세션")) {
      localStorage.removeItem(TOKEN_KEY);
    }
    throw error;
  }

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
