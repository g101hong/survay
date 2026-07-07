// src/exportExcel.js
//
// 와이파이 현장조사 데이터를 엑셀(.xlsx) 파일로 내보내는 유틸 함수.
// SheetJS(xlsx) 라이브러리를 사용해 브라우저에서 바로 다운로드합니다(서버 불필요).
//
// 설치: npm install xlsx
//
// ------------------------------------------------------------------
// 웹취약점 검토
// ------------------------------------------------------------------
// 1) CSV/Excel 수식 인젝션(Formula Injection, OWASP 등재 취약점)
//    비고(remark) 등은 현장조사자가 자유롭게 입력하는 텍스트입니다.
//    만약 "=HYPERLINK(...)", "=cmd|'/c calc'!A1" 처럼 =, +, -, @로 시작하는
//    값이 그대로 셀에 들어가면, 파일을 여는 사람의 스프레드시트 프로그램이
//    이를 수식으로 해석해 실행할 위험이 있습니다. 이 파일은 xlsx 포맷으로
//    저장되어 문자열 타입("s")이 명시되므로 CSV보다는 위험이 낮지만,
//    이후 CSV로 재저장되거나 다른 도구로 다시 읽힐 가능성을 감안해
//    방어적으로 sanitizeCell()에서 위험 문자로 시작하는 값 앞에 작은따옴표를
//    붙여 강제로 텍스트 처리합니다.
// 2) 내부 정보 최소 노출
//    Storage 경로(photo_path 등)는 사람이 읽을 정보가 아니고 내부 구현
//    세부사항이므로 내보내기 대상에서 제외합니다.
// 3) 파일명 인젝션 / OS 비호환 문자
//    검색어·건수 등을 파일명에 넣을 때 \ / : * ? " < > | 문자가 섞이면
//    일부 운영체제에서 다운로드가 깨질 수 있어 sanitizeFileNamePart()로
//    제거합니다.
// ------------------------------------------------------------------

import * as XLSX from "xlsx";

/** 수식으로 해석될 수 있는 선행 문자 (OWASP CSV Injection 대응 목록) */
const DANGEROUS_LEADING_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * 셀 값 하나를 안전하게 정제합니다.
 * 숫자/불리언/null은 그대로 두고, 문자열만 위험한 선행 문자를 검사합니다.
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;

  const str = String(value);
  if (str.length > 0 && DANGEROUS_LEADING_CHARS.has(str[0])) {
    // 앞에 작은따옴표를 붙이면 대부분의 스프레드시트 프로그램이 이 값을
    // "텍스트"로 취급해 수식으로 해석/실행하지 않습니다.
    return `'${str}`;
  }
  return str;
}

/** 행(객체) 전체의 모든 값에 sanitizeCell을 적용합니다. */
function sanitizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = sanitizeCell(value);
  }
  return out;
}

/** 파일명에 쓸 수 없는 문자를 제거/치환합니다. */
function sanitizeFileNamePart(str) {
  return String(str)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * 위/경도가 유효한 좌표 범위인지 확인합니다.
 * (App.jsx의 isValidCoord와 동일한 기준 — 잘못된 값은 빈 값으로 처리)
 */
function isValidCoord(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * site 배열 + apDetail 배열을 받아 "상세현황" 시트용 행 데이터로 변환합니다.
 */
function buildSiteRows(sites, apDetails) {
  const apBySite = {};
  for (const ap of apDetails ?? []) {
    (apBySite[ap.site_id] ??= []).push(ap);
  }

  return sites.map((s, idx) => {
    const aps = apBySite[s.id] ?? [];
    const badCount = aps.filter(
      (a) => a.device_status === "불량" || a.network_status === "불량"
    ).length;
    const hasCoord = isValidCoord(s.latitude, s.longitude);

    return sanitizeRow({
      연번: idx + 1,
      구군: s.gugun,
      설치년도: s.install_year,
      위치: s.location,
      주소: s.address,
      "AP대수": aps.length,
      상태: badCount > 0 ? `불량 ${badCount}` : "정상",
      위도: hasCoord ? s.latitude : "",
      경도: hasCoord ? s.longitude : "",
    });
  });
}

/**
 * apDetail 배열을 "AP세부사항" 시트용 행 데이터로 변환합니다.
 */
function buildApRows(apDetails, sites) {
  const siteById = {};
  for (const s of sites ?? []) siteById[s.id] = s;

  return (apDetails ?? []).map((a, idx) =>
    sanitizeRow({
      연번: idx + 1,
      설치위치: siteById[a.site_id]?.location ?? "",
      AP: a.ap_no,
      실내외: a.in_out,
      설치지점: a.install_point,
      기기상태: a.device_status,
      통신상태: a.network_status,
      최근조사일: a.survey_date ?? "",
      "다운로드속도(Mbps)": a.download_mbps ?? "",
      "지연시간(ms)": a.latency_ms ?? "",
      측정방식: a.measurement_method === "auto" ? "자동측정" : a.measurement_method === "manual" ? "수동입력" : "",
      비고: a.remark ?? "",
    })
  );
}

/**
 * survey_log 배열을 "조사이력" 시트용 행 데이터로 변환합니다.
 */
function buildSurveyLogRows(logs, apDetails, sites) {
  const apById = {};
  for (const a of apDetails ?? []) apById[a.id] = a;
  const siteById = {};
  for (const s of sites ?? []) siteById[s.id] = s;

  return (logs ?? []).map((log, idx) => {
    const ap = apById[log.ap_id];
    const site = ap ? siteById[ap.site_id] : null;
    return sanitizeRow({
      연번: idx + 1,
      조사일: log.survey_date,
      위치: site?.location ?? "",
      AP: ap?.ap_no ?? "",
      기기상태: log.device_status,
      통신상태: log.network_status,
      비고: log.remark ?? "",
    });
  });
}

/** 시트에 열 너비를 자동으로 지정합니다(헤더/내용 중 가장 긴 문자열 기준). */
function autoFitColumns(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const maxLen = rows.reduce((max, row) => {
      const val = row[key] == null ? "" : String(row[key]);
      return Math.max(max, val.length);
    }, key.length);
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
  });
}

function sheetFromRows(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = autoFitColumns(rows);
  return ws;
}

/**
 * 와이파이 현장조사 데이터를 엑셀 파일로 내보냅니다.
 *
 * @param {Object} params
 * @param {Array}  params.sites        - site_info 목록 (필수)
 * @param {Array}  params.apDetails    - ap_detail 목록 (필수)
 * @param {Array}  [params.surveyLogs] - survey_log 목록 (있으면 "조사이력" 시트 추가)
 * @param {string} [params.fileName]   - 저장할 파일명(확장자 제외). 기본값: "와이파이_현장조사_YYYYMMDD"
 */
export function exportWifiDataToExcel({ sites, apDetails, surveyLogs, fileName }) {
  if (!sites || sites.length === 0) {
    throw new Error("내보낼 데이터가 없습니다.");
  }

  const wb = XLSX.utils.book_new();

  const siteRows = buildSiteRows(sites, apDetails);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(siteRows), "상세현황");

  const apRows = buildApRows(apDetails, sites);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(apRows), "AP세부사항");

  if (surveyLogs && surveyLogs.length > 0) {
    const logRows = buildSurveyLogRows(surveyLogs, apDetails, sites);
    XLSX.utils.book_append_sheet(wb, sheetFromRows(logRows), "조사이력");
  }

  const safeName = sanitizeFileNamePart(fileName || `와이파이_현장조사_${todayStamp()}`);
  XLSX.writeFile(wb, `${safeName}.xlsx`);
}
