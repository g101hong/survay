// src/photoFetchShared.js
//
// 엑셀 내보내기(exportExcel.js)와 사진 ZIP 다운로드(downloadPhotosZip.js)가
// 공통으로 쓰는 유틸리티 모음입니다. 사진을 서버(get-photo-url Edge Function)에서
// 받아오는 로직과, 그때 지켜야 하는 속도제한/재시도/파일명 정제 규칙이 두 기능
// 모두에 동일하게 적용되어야 해서 한 곳으로 모았습니다(로직 중복·불일치 방지).
//
// ------------------------------------------------------------------
// 웹취약점 검토 (두 기능 공통 적용)
// ------------------------------------------------------------------
// 1) 속도제한(Rate Limit) 충돌
//    get-photo-url Edge Function은 세션당 분당 30회 제한입니다. 그냥 동시
//    요청 수만 제한해서는 사진이 많을 때 금방 한도를 넘기므로,
//    SlidingWindowLimiter로 "분당 24회"를 넘지 않도록 실제 호출 속도 자체를
//    조절하고, 그래도 실패하면 잠시 대기 후 최대 3회까지 재시도합니다.
// 2) 위장 파일 방어
//    fetch 응답의 Content-Type이 image/*가 아니면(서명 URL 만료로 오류 JSON이
//    대신 온 경우 등) 방어적으로 버립니다. 업로드 시점에 이미 매직바이트로
//    실제 이미지 형식을 검증하고 있어(upload-survey-photo 함수), 이 단계는
//    추가 방어선입니다.
// 3) SSRF
//    이미지 URL은 사용자가 직접 지정하는 게 아니라, 서버가 버킷명을
//    화이트리스트로 검증해 발급한 서명 URL만 사용하므로 임의 URL을 요청할
//    위험이 없습니다.
// 4) 파일명 인젝션 / OS 비호환 문자
//    파일명에 쓸 수 없는 문자(\ / : * ? " < > |)는 sanitizeFileNamePart()에서
//    제거합니다.
// ------------------------------------------------------------------

import { resolvePhotoUrl } from "./api";

/** 동시에 처리할 사진 개수 (레이트리미터가 실제 처리량을 조절하므로, 이 값은
 *  파이프라인 병렬성 정도의 의미만 가집니다) */
export const PHOTO_FETCH_CONCURRENCY = 4;

/** get-photo-url의 서버 한도(분당 30회)보다 낮춰 안전 여유를 둔 클라이언트 자체 한도 */
export const PHOTO_RATE_LIMIT_PER_MINUTE = 24;
export const RATE_WINDOW_MS = 60_000;
export const PHOTO_FETCH_MAX_RETRIES = 3;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 최근 windowMs 동안 maxPerWindow회를 넘지 않도록 호출을 지연시키는 레이트리미터. */
export class SlidingWindowLimiter {
  constructor(maxPerWindow, windowMs) {
    this.max = maxPerWindow;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  async acquire() {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 100; // 약간의 여유
      await sleep(waitMs);
    }
  }
}

/** 동시 실행 개수를 제한하며 배열의 각 항목에 비동기 작업을 수행합니다. */
export async function mapWithConcurrency(items, limit, worker) {
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

/** 파일명에 쓸 수 없는 문자를 제거/치환합니다. */
export function sanitizeFileNamePart(str) {
  return String(str)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * survey_photo_path(ap-survey-photos 버킷 내 경로)를 실제 이미지 바이너리로 변환합니다.
 * - resolvePhotoUrl로 짧은 서명 URL(5분 유효)을 받아온 뒤, 그 URL에서 즉시 fetch합니다.
 * - Content-Type이 image/*가 아니면 방어적으로 버립니다.
 * @returns {Promise<{buffer: ArrayBuffer, extension: "png"|"jpeg"} | null>}
 */
export async function fetchSurveyPhoto(path) {
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

/**
 * fetchSurveyPhoto을 레이트리미터로 감싸고, 실패 시 잠시 기다렸다가 재시도합니다.
 * (실패 원인 대부분이 get-photo-url의 분당 요청 제한이라, 대기 후 재시도하면
 * 대체로 성공합니다. 세션 만료 등 영구적인 실패는 재시도해도 즉시 실패하므로
 * 큰 시간 손실 없이 넘어갑니다.)
 */
export async function fetchSurveyPhotoWithRetry(path, limiter) {
  for (let attempt = 0; attempt <= PHOTO_FETCH_MAX_RETRIES; attempt++) {
    await limiter.acquire();
    const image = await fetchSurveyPhoto(path);
    if (image) return image;
    if (attempt < PHOTO_FETCH_MAX_RETRIES) {
      await sleep(3000 * (attempt + 1)); // 3s, 6s, 9s ...
    }
  }
  return null;
}
