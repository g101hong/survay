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
// 사진을 서버에서 받아오는 공통 로직(속도제한/재시도/파일명 정제 등)은
// photoFetchShared.js로 분리되어 downloadPhotosZip.js(사진 전체 ZIP 다운로드)와
// 함께 공유합니다. 관련 웹취약점 검토 내용도 그 파일 상단에 정리되어 있습니다.
//
// ------------------------------------------------------------------
// 웹취약점 검토 (이 파일에서 추가로 다루는 부분)
// ------------------------------------------------------------------
// 1) CSV/Excel 수식 인젝션(Formula Injection, OWASP 등재 취약점)
//    비고 등 자유 입력 텍스트가 =, +, -, @ 로 시작하면 스프레드시트 프로그램이
//    수식으로 해석할 위험이 있어 sanitizeCell()에서 앞에 작은따옴표를 붙여
//    강제로 텍스트 처리합니다.
// 2) 클라이언트 메모리/성능 보호
//    수백 장을 한 번에 내려받아 삽입하면 브라우저가 느려질 수 있어
//    MAX_EMBEDDED_PHOTOS(300장) 상한을 두고, 초과분은 "상한 초과로 미첨부"라는
//    안내 문구만 표시합니다.
// (속도제한/위장파일방어/SSRF/파일명 정제는 photoFetchShared.js 참고)
// ------------------------------------------------------------------

import ExcelJS from "exceljs";
import {
  PHOTO_FETCH_CONCURRENCY,
  PHOTO_RATE_LIMIT_PER_MINUTE,
  RATE_WINDOW_MS,
  SlidingWindowLimiter,
  mapWithConcurrency,
  sanitizeFileNamePart,
  todayStamp,
  fetchSurveyPhotoWithRetry,
} from "./photoFetchShared";

/** 수식으로 해석될 수 있는 선행 문자 (OWASP CSV Injection 대응 목록) */
const DANGEROUS_LEADING_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** 조사이력 사진 첨부 상한 (성능 보호) */
const MAX_EMBEDDED_PHOTOS = 300;

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
    { header: "설치지점", key: "installPoint", width: 16 },
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
      installPoint: sanitizeCell(ap?.install_point ?? ""),
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
  const limiter = new SlidingWindowLimiter(PHOTO_RATE_LIMIT_PER_MINUTE, RATE_WINDOW_MS);

  await mapWithConcurrency(toEmbed, PHOTO_FETCH_CONCURRENCY, async (rowIdx) => {
    const log = rows[rowIdx];
    const image = await fetchSurveyPhotoWithRetry(log.survey_photo_path, limiter);
    const excelRow = rowIdx + 2; // 1행은 헤더이므로 데이터는 2행부터 시작

    if (image) {
      ws.getRow(excelRow).height = PHOTO_ROW_HEIGHT;
      const imageId = workbook.addImage({ buffer: image.buffer, extension: image.extension });
      ws.addImage(imageId, {
        tl: { col: 8, row: excelRow - 1 }, // ExcelJS 앵커는 0-based (9번째 열 = index 8, 설치지점 컬럼 추가로 한 칸 밀림)
        ext: PHOTO_PX,
      });
    } else {
      failed += 1;
      ws.getCell(`I${excelRow}`).value = "첨부 실패";
    }

    done += 1;
    onProgress?.(done, toEmbed.length);
  });

  overCap.forEach((rowIdx) => {
    const excelRow = rowIdx + 2;
    ws.getCell(`I${excelRow}`).value = "사진 있음(상한 초과로 미첨부)";
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
