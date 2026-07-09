import { supabase, isSupabaseConfigured } from "./supabaseClient";

// PinGate.jsx와 동일한 키를 사용해야 세션 토큰을 공유할 수 있습니다.
const TOKEN_KEY = "wifi-survey-pin-token";

/**
 * Supabase 환경변수가 설정되어 있지 않으면 즉시 에러를 던집니다.
 * ⚠️ 이 함수는 "연결 준비 여부"만 확인하며, 호출자의 로그인(PIN 인증) 여부와는
 * 무관합니다. 로그인이 필요한 작업(쓰기 등)에는 반드시 아래 requireSession()을
 * 함께 사용하세요. (지난 버전에서는 이 두 역할이 requireSupabase() 하나에
 * 뒤섞여 있어, 이름만 보고 "인증 확인까지 되어 있다"고 오해할 수 있었습니다.)
 */
function requireSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase 환경변수가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인하세요."
    );
  }
}

/**
 * 로컬에 저장된 세션 토큰의 "존재 여부"를 확인하고 반환합니다.
 * ⚠️ 이것은 애플리케이션 계층의 1차 방어(빠른 실패, 명확한 에러 메시지)일 뿐이며,
 * 실제 인가(authorization)는 서버의 RLS 정책과 각 RPC 함수
 * (submit_survey_result / upload-survey-photo / revoke_survey_session) 내부의
 * 세션 검증이 담당합니다. 여기서 통과했다고 해서 서버 쪽 검증이 생략되는 것은
 * 아니며, 만료되었거나 폐기된 토큰이라면 이후 서버 요청에서 걸러집니다.
 *
 * 로그인이 필요한 쓰기 작업(submitSurvey 등)에서는 함수 시작 부분에 이 함수를
 * 호출해, "이 작업은 로그인이 필요하다"는 것을 코드 상에서 명시적으로 드러냅니다.
 *
 * @returns {string} 로컬에 저장된 토큰 값 (서버 유효성은 아직 검증되지 않음)
 * @throws {Error} 토큰이 없으면 즉시 예외를 던져 네트워크 요청 자체를 막습니다.
 */
function requireSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    throw new Error("로그인 세션이 만료되었습니다. 코드를 다시 입력해주세요.");
  }
  return token;
}

/**
 * 전체 지점 목록(상세현황)을 가져옵니다.
 * ⚠️ 조회(SELECT)는 RLS 정책상 anon에게 계속 허용되어 있어야 하는 부분입니다.
 *    (site_info / ap_detail / survey_log 세 테이블 모두 "anon_select_*" 정책 적용 전제)
 *
 * [v1 → v2] 카카오맵 딥링크(위치 보기) 기능을 위해 latitude/longitude 컬럼을
 *           select 목록에 추가. 좌표는 site_info_좌표_반영.sql 마이그레이션으로
 *           반영된 값이며, 값이 없는 지점은 null로 내려오므로 화면단에서
 *           반드시 유효성(범위/타입) 검증 후 사용해야 합니다. (KakaoMapLink 참고)
 */
export async function fetchSites() {
  requireSupabase();

  const { data, error } = await supabase
    .from("site_info")
    .select(
      "id, gugun, install_year, location, address, service_photo_path, latitude, longitude"
    )
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
 * 전체 AP 목록을 한 번에 가져옵니다 (목록/대시보드 화면에서 지점별 대수·상태 요약,
 * 그리고 엑셀 내보내기의 AP세부사항 시트에 사용).
 *
 * ⚠️ photo_path/survey_photo_path(Storage 내부 경로)는 의도적으로 select하지 않습니다.
 *    화면 요약이나 엑셀 내보내기 어디에도 내부 파일 키를 노출할 이유가 없고,
 *    사진이 필요한 화면(DetailScreen)은 fetchApDetailsBySite로 별도 조회합니다.
 */
export async function fetchAllApDetails() {
  requireSupabase();

  const { data, error } = await supabase
    .from("ap_detail")
    .select(
      "id, site_id, ap_no, in_out, install_point, device_status, network_status, survey_date, remark, download_mbps, latency_ms, measurement_method, wifi_confirmed"
    );

  if (error) throw error;
  return data;
}

/**
 * 전체 조사이력(survey_log)을 가져옵니다.
 * 대시보드의 "반복 불량 / 상태 악화" 분석, 그리고 엑셀 내보내기의
 * "조사이력" 시트(사진 첨부 포함)에 사용됩니다.
 *
 * survey_photo_path: 내부 Storage 경로. 화면에는 직접 노출하지 않고,
 * 엑셀 내보내기 시 resolvePhotoUrl()로 서명 URL을 받아 이미지를
 * 내려받아 파일에 삽입하는 용도로만 사용합니다.
 */
export async function fetchAllSurveyLogs() {
  requireSupabase();

  const { data, error } = await supabase
    .from("survey_log")
    .select("id, ap_id, device_status, network_status, survey_date, remark, survey_photo_path")
    .order("survey_date", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Storage 경로를 짧은 유효시간(5분)의 서명 URL로 변환합니다. (v2 — Private 버킷 전환)
 * ------------------------------------------------------------------
 * [v1 → v2 변경 사항]
 * v1에서는 service-photos/ap-photos/ap-survey-photos 버킷이 Public이라
 * supabase.storage.getPublicUrl()로 얻은 고정 URL을 PIN 로그인 여부와
 * 무관하게 누구나 직접 열람할 수 있었습니다.
 *
 * v2에서는 세 버킷 모두 Private로 전환하고, 이 함수가 get-photo-url
 * Edge Function을 호출해 (1) 세션 유효성 (2) 세션별 요청 빈도(1분당 30회)를
 * 검사받은 뒤에만 5분짜리 서명 URL을 발급받습니다.
 * (서버 측 정의는 supabase_photo_buckets_private.sql / get-photo-url 참고)
 *
 * ⚠️ getPublicUrl()과 달리 네트워크 요청이 필요해 **비동기 함수로 바뀌었습니다.**
 * 호출부(App.jsx의 PhotoTile 등)는 반드시 await/Promise 처리를 해야 합니다.
 * ------------------------------------------------------------------
 *
 * @param {string} bucket - "service-photos" | "ap-photos" | "ap-survey-photos" 중 하나만 허용됩니다.
 * @param {string|null|undefined} path - Storage 객체 경로. 비어있으면 "사진 없음"으로 간주해 조용히 null을 반환합니다.
 * @returns {Promise<string|null>} 서명 URL. 사진이 없거나 세션이 없으면 null.
 */
export async function resolvePhotoUrl(bucket, path) {
  if (!path) return null;
  if (!isSupabaseConfigured) return null;

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null; // 로그인 세션이 없으면 사진을 요청하지 않고 조용히 "없음" 처리

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-photo-url`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, bucket, path }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (result?.error === "invalid_session") {
        localStorage.removeItem(TOKEN_KEY);
      }
      // 사진 조회 실패는 화면 전체를 막을 만한 오류가 아니므로(단순 "사진 없음"으로
      // 처리 가능), 여기서는 예외를 던지지 않고 null을 반환해 호출부가
      // PhotoTile의 기본 placeholder를 보여주도록 합니다. 자세한 사유는
      // 콘솔에만 남깁니다.
      console.warn(`[wifi-survey] 사진 URL 발급 실패 (${bucket}/${path}):`, result?.error);
      return null;
    }

    return result.url ?? null;
  } catch (err) {
    console.warn(`[wifi-survey] 사진 URL 요청 중 오류 (${bucket}/${path}):`, err);
    return null;
  }
}

/**
 * 현장조사 결과를 저장합니다. (v3 — RLS 우회 + 사진 업로드 취약점 수정)
 * ------------------------------------------------------------------
 * [v1 → v2] 저장(UPDATE/INSERT)을 supabase.from(...).update()/.insert() 직접 호출에서
 *           submit_survey_result RPC(서버측 세션 토큰 검증)로 변경.
 * [v2 → v3] 사진 업로드를 supabase.storage.upload() 직접 호출에서
 *           Edge Function(upload-survey-photo) 호출로 변경.
 *           - anon key로는 ap-survey-photos 버킷에 직접 업로드할 수 없도록
 *             Storage RLS 정책에서 anon INSERT 권한을 회수했으므로, 이 함수를
 *             거치지 않으면 사진 업로드 자체가 애초에 불가능합니다.
 *           - Edge Function 내부에서 (1) 세션 토큰 검증 (2) 파일 크기 제한
 *             (3) 매직바이트로 실제 이미지 형식 검증을 거친 뒤 서비스 롤 키로
 *             대신 업로드하므로, 확장자/Content-Type을 위조한 파일은 차단됩니다.
 * ------------------------------------------------------------------
 *
 * 1) 사진이 있으면 Edge Function(upload-survey-photo)을 통해 업로드
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
  //  최종 방어선은 어디까지나 서버의 submit_survey_result / upload-survey-photo 함수입니다.)
  const token = requireSession();

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

  // 사진이 있으면 Storage에 직접 업로드하는 대신, 세션 검증 + 파일 시그니처 검증을
  // 수행하는 Edge Function을 거쳐 업로드합니다.
  //
  // ⚠️ Supabase Edge Function은 기본적으로 verify_jwt=true 설정이 켜져 있어,
  // 게이트웨이가 함수 코드 실행 전에 Authorization 헤더(유효한 JWT)를 먼저 검사합니다.
  // supabase.rpc()/supabase.from()과 달리 순수 fetch()는 이 헤더를 자동으로
  // 붙여주지 않으므로, anon key를 apikey/Authorization 헤더에 직접 실어 보내야
  // 401(Unauthorized)을 피할 수 있습니다. (이 anon key는 게이트웨이 통과용일 뿐,
  // 실제 로그인 인증은 위에서 검사한 PIN 세션 토큰이 담당합니다.)
  let surveyPhotoPath = null;
  if (photoFile) {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const form = new FormData();
    form.append("token", token);
    form.append("apId", String(apId));
    form.append("file", photoFile);

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-survey-photo`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: form,
      }
    );
    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (result?.error?.includes("유효하지 않은 세션")) {
        localStorage.removeItem(TOKEN_KEY);
      }
      throw new Error(result?.error ?? "사진 업로드에 실패했습니다.");
    }
    surveyPhotoPath = result.path;
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
 * 특정 AP의 조사이력(survey_log) 전체를 최신순으로 가져옵니다.
 * ⚠️ 조회(SELECT)는 다른 fetch* 함수들과 동일하게 requireSupabase()만 검사합니다
 *    (anon_select_survey_log 정책 전제, 로그인 없이도 조회 가능).
 */
export async function fetchSurveyLogsByAp(apId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("survey_log")
    .select("id, ap_id, device_status, network_status, survey_date, remark, survey_photo_path, created_at")
    .eq("ap_id", apId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * 조사이력(survey_log)의 특정 회차를 실제로 수정합니다. (submitSurvey와 동일한 v3 보안 모델)
 * ------------------------------------------------------------------
 * `submitSurvey`(현장조사 입력)는 새 이력을 추가(INSERT)하지만, 이 함수는
 * 지정한 회차(logId)를 그대로 고칩니다(UPDATE). anon에게는 survey_log의
 * UPDATE 권한을 부여하지 않고(=RLS로 직접 차단), 세션 토큰을 서버에서
 * 검증하는 update_survey_log_entry RPC(SECURITY DEFINER)를 통해서만
 * 수정이 가능하도록 설계했습니다 (submit_survey_result와 동일한 패턴).
 *
 * 서버 함수는 수정한 회차가 해당 AP의 "가장 최근 조사"인지 확인해,
 * 맞다면 ap_detail(목록/상세 화면의 최신 상태)도 함께 갱신합니다.
 * (서버 측 정의는 supabase_update_survey_log.sql 참고)
 * ------------------------------------------------------------------
 *
 * @param {Object} params
 * @param {number} params.logId - 수정할 survey_log 행의 id
 * @param {number} params.apId
 * @param {string} params.surveyDate
 * @param {"정상"|"불량"} params.deviceStatus
 * @param {"정상"|"불량"} params.networkStatus
 * @param {string} params.remark
 * @param {File|null} [params.photoFile] - 사진을 교체할 경우에만 전달 (upload-survey-photo Edge Function 재사용)
 * @returns {Promise<{ log: Object, syncedLatest: boolean }>}
 */
export async function updateSurveyLog({ logId, apId, surveyDate, deviceStatus, networkStatus, remark, photoFile }) {
  requireSupabase();
  const token = requireSession();

  // 사진 교체도 submitSurvey와 동일하게 Edge Function(upload-survey-photo)을 거칩니다.
  // (anon은 ap-survey-photos 버킷에 직접 업로드할 수 없도록 이미 권한이 회수되어 있음)
  let surveyPhotoPath = null;
  if (photoFile) {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const form = new FormData();
    form.append("token", token);
    form.append("apId", String(apId));
    form.append("file", photoFile);

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-survey-photo`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: form,
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (result?.error?.includes("유효하지 않은 세션")) {
        localStorage.removeItem(TOKEN_KEY);
      }
      throw new Error(result?.error ?? "사진 업로드에 실패했습니다.");
    }
    surveyPhotoPath = result.path;
  }

  const { data, error } = await supabase.rpc("update_survey_log_entry", {
    input_token: token,
    input_log_id: logId,
    input_ap_id: apId,
    input_survey_date: surveyDate,
    input_device_status: deviceStatus,
    input_network_status: networkStatus,
    input_remark: remark,
    input_survey_photo_path: surveyPhotoPath,
  });

  if (error) {
    if (error.message?.includes("유효하지 않은 세션")) {
      localStorage.removeItem(TOKEN_KEY);
    }
    throw error;
  }

  return { log: data.log, syncedLatest: data.synced_latest };
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

/**
 * 로그아웃(잠금) 시 서버에 발급된 세션 토큰 자체를 폐기합니다.
 * ------------------------------------------------------------------
 * [기존 문제] LockButton의 로그아웃 처리가 localStorage.removeItem()만 수행해,
 * 브라우저에서는 로그아웃된 것처럼 보여도 서버의 app_pin_sessions 행은
 * 만료일(기본 30일)까지 그대로 남아 유효했습니다. 만약 이 토큰이 유출되었다면
 * 사용자가 "로그아웃"을 눌러도 실제로는 아무 방어 효과가 없었습니다.
 *
 * [개선] 로그아웃 시 이 함수를 먼저 호출해 서버의 세션 행 자체를 삭제합니다.
 * 서버 함수(revoke_survey_session)는 "자신이 들고 있는 토큰"만 삭제할 수 있도록
 * 설계되어 있어(토큰 값 자체가 곧 본인 확인 수단), 다른 사용자의 세션에는
 * 영향을 주지 않습니다.
 * (서버 측 정의는 supabase_pin_login.sql / revoke_survey_session 함수 참고)
 * ------------------------------------------------------------------
 *
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function revokeSurveySession(token) {
  if (!token) return;
  requireSupabase();

  // 네트워크 오류 등으로 서버 요청이 실패해도, 로그아웃 자체는 계속 진행되어야
  // 하므로 이 함수를 호출하는 쪽(PinGate.jsx)에서 실패를 무시하고 로컬 정리를
  // 이어가도록 설계했습니다. 여기서는 에러를 그대로 던져 호출부가 판단하게 합니다.
  const { error } = await supabase.rpc("revoke_survey_session", { input_token: token });
  if (error) throw error;
}
