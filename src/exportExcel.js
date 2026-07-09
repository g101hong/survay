// src/exportExcel.js
//
// 와이파이 현장조사 데이터를 엑셀(.xlsx) 파일로 내보내는 유틸 함수.
//
// [xlsx(SheetJS) → ExcelJS 로 교체한 이유]
// 조사이력 시트에 현장조사 사진을 "실제로" 셀에 삽입하는 기능이 필요했는데,
// SheetJS(xlsx)의 무료 버전은 셀 이미지 삽입을 지원하지 않습니다(유료 Pro 전용).
// ExcelJS는 MIT 라이선스 오픈소스이면서 이미지 삽입(workbook.addImage /
// worksheet.addImage)을 지원해 이 기능에 사용합니다.
//
// 설치: npm install exceljs   (기존 xlsx 패키지는 더 이상 사용하지 않으므로 제거해도 됩니다)
//
// ------------------------------------------------------------------
// 웹취약점 검토
// ------------------------------------------------------------------
// 1) CSV/Excel 수식 인젝션(Formula Injection, OWASP 등재 취약점)
//    비고 등 자유 입력 텍스트가 =, +, -, @ 로 시작하면 스프레드시트 프로그램이
//    수식으로 해석할 위험이 있어 sanitizeCell()에서 앞에 작은따옴표를 붙여
//    강제로 텍스트 처리합니다.
// 2) 사진 첨부로 인한 속도제한(Rate Limit) 충돌
//    사진 URL 발급용 Edge Function(get-photo-url)은 세션당 분당 30회 제한이
//    있습니다. 사진이 많을 때 한꺼번에 요청하면 이 제한에 걸려 실패하므로,
//    PHOTO_FETCH_CONCURRENCY로 동시 요청 수를 4개로 제한해 순차적으로 처리합니다.
// 3) 클라이언트 메모리/성능 보호
//    수백 장을 한 번에 내려받아 삽입하면 브라우저가 느려질 수 있어
//    MAX_EMBEDDED_PHOTOS(300장) 상한을 두고, 초과분은 "상한 초과로 미첨부"라는
//    안내 문구만 표시합니다.
// 4) 위장 파일 방어
//    fetch 응답의 Content-Type이 image/*가 아니면(예: 서명 URL 만료로 오류
//    JSON이 대신 온 경우 등) 방어적으로 첨부를 건너뜁니다. 업로드 시점에 이미
//    매직바이트로 실제 이미지 형식을 검증하고 있어(upload-survey-photo 함수),
//    이 단계는 추가 방어선입니다.
// 5) SSRF
//    이미지 URL은 사용자가 직접 지정하는 것이 아니라, 서버(Edge Function)가
//    버킷명을 화이트리스트로 검증해 발급한 서명 URL만 사용하므로 임의 URL을
//    요청할 위험이 없습니다.
// 6) 파일명 인젝션 / OS 비호환 문자
//    파일명에 쓸 수 없는 문자(\ / : * ? " < > |)는 sanitizeFileNamePart()에서
//    제거합니다.
// ------------------------------------------------------------------

import ExcelJS from "exceljs";
import { resolvePhotoUrl } from "./api";

/** 수식으로 해석될 수 있는 선행 문자 (OWASP CSV Injection 대응 목록) */
const DANGEROUS_LEADING_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** 조사이력 사진 첨부 상한 (성능 보호) */
const MAX_EMBEDDED_PHOTOS = 300;
/** 사진 URL 발급 API의 속도제한(분당 30회, 세션당) 보호를 위한 동시요청 제한 */
const PHOTO_FETCH_CONCURRENCY = 4;

// 조사이력 사진 표시 크기.
// [v1 → v2] 요청에 따라 기존 대비 2배(110x82 → 220x164)로 확대하고,
// 사진이 셀에 가려지거나 넘치지 않도록 열 너비/행 높이도 함께 키웠습니다.
// (열 너비는 픽셀/≈7, 행 높이는 픽셀/≈1.333(96dpi 기준 포인트 환산) 근사치로 계산하고
//  여백을 위해 여유를 조금 더 뒀습니다. 실제 이미지 파일 자체를 다시 인코딩해
//  키우는 게 아니라 엑셀 안에서 "표시 크기"만 키우는 것이라 파일 용량에는
//  영향이 없습니다.)
const PHOTO_COL_WIDTH = 33; // ≈ 220px
const PHOTO_ROW_HEIGHT = 130; // 포인트 단위, ≈ 164px
const PHOTO_PX = { width: 220, height: 164 };

const BRAND_COLOR = "FF2F6F62";

/**
 * 셀 값 하나를 안전하게 정제합니다.
 * 숫자/불리언/null은 그대로 두고, 문자열만 위험한 선행 문자를 검사합니다.
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;

  const str = String(value);
  if (str.length > 0 && DANGEROUS_LEADING_CHARS.has(str[0])) {
    return `'${str}`;
  }
  return str;
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

/** 위/경도가 유효한 좌표 범위인지 확인합니다 (App.jsx의 isValidCoord와 동일 기준). */
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

/** 동시 실행 개수를 제한하며 배열의 각 항목에 비동기 작업을 수행합니다. */
async function mapWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(runners);
}

/**
 * survey_photo_path를 실제 이미지 바이너리로 변환합니다.
 * - resolvePhotoUrl로 짧은 서명 URL(5분 유효)을 받아온 뒤, 그 URL에서 즉시 fetch합니다.
 * - Content-Type이 image/*가 아니면 방어적으로 버립니다.
 */
async function fetchImageForEmbed(path) {
  if (!path) return null;
  try {
    const url = await resolvePhotoUrl("ap-survey-photos", path);
    if (!url) return null;

    const res = await fetch(url);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;

    const buffer = await res.arrayBuffer();
    const extension = contentType.includes("png") ? "png" : "jpeg";
    return { buffer, extension };
  } catch {
    return null;
  }
}

function styleHeader(ws) {
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLOR } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  headerRow.height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addSiteSheet(workbook, sites, apDetails) {
  const ws = workbook.addWorksheet("상세현황");
  ws.columns = [
    { header: "연번", key: "no", width: 6 },
    { header: "구군", key: "gugun", width: 10 },
    { header: "설치년도", key: "year", width: 10 },
    { header: "위치", key: "location", width: 20 },
    { header: "주소", key: "address", width: 32 },
    { header: "AP대수", key: "apCount", width: 8 },
    { header: "상태", key: "status", width: 10 },
    { header: "위도", key: "lat", width: 12 },
    { header: "경도", key: "lng", width: 12 },
  ];

  const apBySite = {};
  for (const ap of apDetails ?? []) {
    (apBySite[ap.site_id] ??= []).push(ap);
  }

  sites.forEach((s, idx) => {
    const aps = apBySite[s.id] ?? [];
    const badCount = aps.filter(
      (a) => a.device_status === "불량" || a.network_status === "불량"
    ).length;
    const hasCoord = isValidCoord(s.latitude, s.longitude);

    ws.addRow({
      no: idx + 1,
      gugun: sanitizeCell(s.gugun),
      year: s.install_year,
      location: sanitizeCell(s.location),
      address: sanitizeCell(s.address),
      apCount: aps.length,
      status: badCount > 0 ? `불량 ${badCount}` : "정상",
      lat: hasCoord ? s.latitude : "",
      lng: hasCoord ? s.longitude : "",
    });
  });

  styleHeader(ws);
}

function addApSheet(workbook, apDetails, sites) {
  const ws = workbook.addWorksheet("AP세부사항");
  ws.columns = [
    { header: "연번", key: "no", width: 6 },
    { header: "설치위치", key: "location", width: 18 },
    { header: "AP", key: "apNo", width: 10 },
    { header: "실내외", key: "inOut", width: 8 },
    { header: "설치지점", key: "installPoint", width: 16 },
    { header: "기기상태", key: "deviceStatus", width: 10 },
    { header: "통신상태", key: "networkStatus", width: 10 },
    { header: "최근조사일", key: "surveyDate", width: 12 },
    { header: "다운로드속도(Mbps)", key: "downloadMbps", width: 18 },
    { header: "지연시간(ms)", key: "latencyMs", width: 12 },
    { header: "측정방식", key: "method", width: 10 },
    { header: "비고", key: "remark", width: 26 },
  ];

  const siteById = {};
  for (const s of sites ?? []) siteById[s.id] = s;

  (apDetails ?? []).forEach((a, idx) => {
    ws.addRow({
      no: idx + 1,
      location: sanitizeCell(siteById[a.site_id]?.location ?? ""),
      apNo: sanitizeCell(a.ap_no),
      inOut: sanitizeCell(a.in_out),
      installPoint: sanitizeCell(a.install_point),
      deviceStatus: a.device_status,
      networkStatus: a.network_status,
      surveyDate: a.survey_date ?? "",
      downloadMbps: a.download_mbps ?? "",
      latencyMs: a.latency_ms ?? "",
      method:
        a.measurement_method === "auto"
          ? "자동측정"
          : a.measurement_method === "manual"
          ? "수동입력"
          : "",
      remark: sanitizeCell(a.remark ?? ""),
    });
  });

  styleHeader(ws);
}

/**
 * "조사이력" 시트를 만들고, survey_photo_path가 있는 행에는 실제 사진을 삽입합니다.
 * @param {Function} [onProgress] - (완료건수, 전체건수) => void. 첨부 진행률 콜백.
 * @returns {Promise<{total:number, embedded:number, failed:number, overCap:number}>}
 */
async function addSurveyLogSheetWithPhotos(workbook, logs, apDetails, sites, onProgress) {
  const ws = workbook.addWorksheet("조사이력");
  ws.columns = [
    { header: "연번", key: "no", width: 6 },
    { header: "조사일", key: "date", width: 12 },
    { header: "위치", key: "location", width: 16 },
    { header: "AP", key: "apNo", width: 10 },
    { header: "기기상태", key: "deviceStatus", width: 10 },
    { header: "통신상태", key: "networkStatus", width: 10 },
    { header: "비고", key: "remark", width: 24 },
    { header: "사진", key: "photo", width: PHOTO_COL_WIDTH },
  ];

  const apById = {};
  for (const a of apDetails ?? []) apById[a.id] = a;
  const siteById = {};
  for (const s of sites ?? []) siteById[s.id] = s;

  const rows = logs ?? [];

  rows.forEach((log, idx) => {
    const ap = apById[log.ap_id];
    const site = ap ? siteById[ap.site_id] : null;
    ws.addRow({
      no: idx + 1,
      date: log.survey_date,
      location: sanitizeCell(site?.location ?? ""),
      apNo: sanitizeCell(ap?.ap_no ?? ""),
      deviceStatus: log.device_status,
      networkStatus: log.network_status,
      remark: sanitizeCell(log.remark ?? ""),
      photo: "",
    });
  });

  styleHeader(ws);

  // 사진이 있는 행만 첨부 대상으로 삼되, 상한(MAX_EMBEDDED_PHOTOS)을 넘지 않게 합니다.
  const withPhotoIdx = [];
  rows.forEach((log, idx) => {
    if (log.survey_photo_path) withPhotoIdx.push(idx);
  });
  const toEmbed = withPhotoIdx.slice(0, MAX_EMBEDDED_PHOTOS);
  const overCap = withPhotoIdx.slice(MAX_EMBEDDED_PHOTOS);

  let done = 0;
  let failed = 0;

  await mapWithConcurrency(toEmbed, PHOTO_FETCH_CONCURRENCY, async (rowIdx) => {
    const log = rows[rowIdx];
    const image = await fetchImageForEmbed(log.survey_photo_path);
    const excelRow = rowIdx + 2; // 1행은 헤더이므로 데이터는 2행부터 시작

    if (image) {
      ws.getRow(excelRow).height = PHOTO_ROW_HEIGHT;
      const imageId = workbook.addImage({ buffer: image.buffer, extension: image.extension });
      ws.addImage(imageId, {
        tl: { col: 7, row: excelRow - 1 }, // ExcelJS 앵커는 0-based (8번째 열 = index 7)
        ext: PHOTO_PX,
      });
    } else {
      failed += 1;
      ws.getCell(`H${excelRow}`).value = "첨부 실패";
    }

    done += 1;
    onProgress?.(done, toEmbed.length);
  });

  overCap.forEach((rowIdx) => {
    const excelRow = rowIdx + 2;
    ws.getCell(`H${excelRow}`).value = "사진 있음(상한 초과로 미첨부)";
  });

  return {
    total: withPhotoIdx.length,
    embedded: toEmbed.length - failed,
    failed,
    overCap: overCap.length,
  };
}

/**
 * 와이파이 현장조사 데이터를 엑셀 파일로 내보냅니다.
 *
 * @param {Object} params
 * @param {Array}    params.sites          - site_info 목록 (필수)
 * @param {Array}    params.apDetails      - ap_detail 목록 (필수)
 * @param {Array}    [params.surveyLogs]   - survey_log 목록 (있으면 "조사이력" 시트 + 사진 첨부)
 * @param {string}   [params.fileName]     - 저장할 파일명(확장자 제외)
 * @param {Function} [params.onProgress]   - (완료건수, 전체건수) => void. 사진 첨부 진행률 콜백.
 * @returns {Promise<{total:number, embedded:number, failed:number, overCap:number}|null>}
 *          조사이력 시트를 만들지 않았다면 null.
 */
export async function exportWifiDataToExcel({ sites, apDetails, surveyLogs, fileName, onProgress }) {
  if (!sites || sites.length === 0) {
    throw new Error("내보낼 데이터가 없습니다.");
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "와이파이 현장조사 웹프로그램";
  workbook.created = new Date();

  addSiteSheet(workbook, sites, apDetails);
  addApSheet(workbook, apDetails, sites);

  let photoSummary = null;
  if (surveyLogs && surveyLogs.length > 0) {
    photoSummary = await addSurveyLogSheetWithPhotos(workbook, surveyLogs, apDetails, sites, onProgress);
  }

  const safeName = sanitizeFileNamePart(fileName || `와이파이_현장조사_${todayStamp()}`);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // ExcelJS에는 SheetJS의 writeFile() 같은 브라우저 저장 헬퍼가 없어 직접 다운로드를 트리거합니다.
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return photoSummary;
}
