// src/downloadPhotosZip.js
//
// 현재 등록된 현장조사 사진(각 AP의 가장 최근 조사 사진)을 전부 모아
// "{위치}_{AP번호}.jpg" 형식의 파일명으로 ZIP 하나에 담아 다운로드합니다.
//
// 설치: npm install jszip
//
// [범위에 대한 참고]
// ap_detail.survey_photo_path(각 AP의 "현재" 사진)만 대상으로 합니다.
// survey_log에 쌓인 과거 조사 회차별 사진까지 전부 포함하려면 별도 요청해주세요
// (그 경우 같은 위치+AP에 여러 날짜의 사진이 있을 수 있어 파일명에 날짜를
// 덧붙이는 방식으로 바꿔야 충돌하지 않습니다).
//
// 사진을 서버에서 받아오는 공통 로직(속도제한/재시도/파일명 정제 등)은
// photoFetchShared.js를 그대로 재사용합니다. 관련 웹취약점 검토는 그 파일
// 상단에 정리되어 있으며, 이 파일에서 추가로 다루는 부분만 아래에 적습니다.
//
// ------------------------------------------------------------------
// 웹취약점 검토 (이 파일에서 추가로 다루는 부분)
// ------------------------------------------------------------------
// 1) 클라이언트 메모리 보호
//    JSZip도 압축 전 원본 이미지 바이트를 전부 메모리에 들고 있어야 하므로,
//    MAX_ZIP_PHOTOS(500장) 상한을 두고 초과분은 담지 않습니다(대신 결과
//    요약에 몇 장이 빠졌는지 알려줍니다).
// 2) 파일명 충돌 방어
//    "위치_AP번호" 조합이 스키마상 유일해야 정상이지만, 혹시 데이터 정합성이
//    깨진 경우를 대비해 같은 이름이 또 나오면 "_2", "_3" 접미사를 붙여
//    덮어쓰지 않고 모두 보존합니다.
// ------------------------------------------------------------------

import JSZip from "jszip";
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

/** ZIP에 담을 사진 개수 상한 (브라우저 메모리 보호) */
const MAX_ZIP_PHOTOS = 500;

/**
 * ap_detail 목록을 기준으로, 사진이 있는 AP들의 "현재 등록된 사진"을 모두
 * 내려받아 ZIP으로 묶어 다운로드합니다.
 *
 * 파일명 형식: {위치}_{AP번호}.{확장자}   예) 시청앞_AP01.jpg
 *
 * @param {Object} params
 * @param {Array} params.sites - site_info 목록
 * @param {Array} params.apDetails - ap_detail 목록. survey_photo_path 필드가 포함되어야 합니다.
 * @param {Function} [params.onProgress] - (완료건수, 전체건수) => void
 * @returns {Promise<{total:number, zipped:number, failed:number, overCap:number}>}
 */
export async function downloadAllSurveyPhotosZip({ sites, apDetails, onProgress }) {
  const siteById = {};
  for (const s of sites ?? []) siteById[s.id] = s;

  const withPhoto = (apDetails ?? []).filter((a) => a.survey_photo_path);
  if (withPhoto.length === 0) {
    throw new Error("다운로드할 현장조사 사진이 없습니다.");
  }

  const toZip = withPhoto.slice(0, MAX_ZIP_PHOTOS);
  const overCap = withPhoto.length - toZip.length;

  const zip = new JSZip();
  const limiter = new SlidingWindowLimiter(PHOTO_RATE_LIMIT_PER_MINUTE, RATE_WINDOW_MS);
  const usedNames = new Set();

  let done = 0;
  let failed = 0;

  await mapWithConcurrency(toZip, PHOTO_FETCH_CONCURRENCY, async (ap) => {
    const image = await fetchSurveyPhotoWithRetry(ap.survey_photo_path, limiter);
    done += 1;
    onProgress?.(done, toZip.length);

    if (!image) {
      failed += 1;
      return;
    }

    const location = sanitizeFileNamePart(siteById[ap.site_id]?.location || "위치미상");
    const apNo = sanitizeFileNamePart(ap.ap_no || "AP");
    const ext = image.extension === "png" ? "png" : "jpg";
    const baseName = `${location}_${apNo}`;

    let fileName = `${baseName}.${ext}`;
    let suffix = 2;
    while (usedNames.has(fileName)) {
      fileName = `${baseName}_${suffix}.${ext}`;
      suffix += 1;
    }
    usedNames.add(fileName);

    zip.file(fileName, image.buffer);
  });

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `와이파이_현장조사_사진_${todayStamp()}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return {
    total: withPhoto.length,
    zipped: toZip.length - failed,
    failed,
    overCap,
  };
}
