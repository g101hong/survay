import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * 통신상태 실측 유틸리티 (v2)
 * ------------------------------------------------------------------
 * [v1 → v2 수정 사항]
 * v1에서는 매 요청마다 캐시버스팅 쿼리스트링(`?_=timestamp`)을 붙였습니다.
 * 이로 인해 Supabase의 CDN 엣지 캐시를 매번 건너뛰고 원본 서버(프로젝트
 * 리전)까지 왕복하게 되어, 지연시간이 비정상적으로 높게 측정되고
 * 다운로드 속도는 "연결 오버헤드"가 지배적이 되어 실제보다 훨씬 낮게
 * 나오는 문제가 있었습니다.
 *
 * v2에서는:
 *   1) 첫 요청으로 CDN 엣지 캐시를 "예열(warm-up)"한 뒤, 그다음 요청부터
 *      실제 측정을 시작합니다 (캐시버스팅 쿼리스트링 제거, 브라우저
 *      캐시만 cache:"no-store"로 우회).
 *   2) 판정 기준치를 국내 공공와이파이 평균 통계에 맞춰 현실적으로 조정
 *      (기존 1Mbps/500ms → 10Mbps/200ms).
 * ------------------------------------------------------------------
 * 사전 준비 (Supabase 콘솔에서 1회 설정):
 *   - Storage에 "network-test"라는 이름의 Public 버킷 생성
 *   - 그 안에 약 1.5MB 정도의 더미 파일을 "testfile.bin" 이름으로 업로드
 *     (300KB처럼 너무 작으면 연결 오버헤드 비중이 커져 속도가 실제보다
 *      낮게 측정됩니다. 1~2MB 권장)
 *     예: `head -c 1500000 /dev/urandom > testfile.bin`
 */

const LATENCY_SAMPLES = 4;
const TEST_BUCKET = "network-test";
const TEST_FILE = "testfile.bin";

// 판정 기준치 — 국내 공공와이파이 평균 통계(과기정통부 조사, 정상 구간 대부분
// 수십~수백 Mbps) 대비 "이보다 느리면 점검이 필요하다"는 현실적인 하한선입니다.
// 필요에 맞게 조정하세요.
const THRESHOLD_MBPS = 10; // 이 값 이상이면 다운로드 속도는 "정상" 범위
const THRESHOLD_LATENCY_MS = 200; // 이 값 이하면 지연시간은 "정상" 범위

function getConnectionInfo() {
  const conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return null;
  // iOS Safari는 navigator.connection 자체가 없어 null이 됩니다 (정상적인 제약사항).
  return {
    type: conn.type || null,
    effectiveType: conn.effectiveType || null,
  };
}

/**
 * CDN 엣지 캐시를 예열합니다. 이 요청의 결과/시간은 측정에 반영하지 않습니다.
 * (해당 리전 엣지에 파일이 처음 요청되는 경우 원본까지 왕복하는 콜드 미스가
 *  발생하므로, 이 요청에서 그 비용을 미리 소모시킵니다.)
 */
async function warmUp(url) {
  try {
    await fetch(url, { method: "GET", cache: "no-store" });
  } catch {
    // 예열 실패는 무시하고 본 측정에서 다시 시도합니다.
  }
}

async function measureLatency(url) {
  const samples = [];
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const start = performance.now();
    try {
      // 쿼리스트링을 붙이지 않아 CDN 엣지 캐시를 그대로 활용합니다.
      // cache:"no-store"는 브라우저 자체 캐시만 우회할 뿐, CDN 엣지 캐시와는 무관합니다.
      await fetch(url, { method: "HEAD", cache: "no-store" });
      samples.push(performance.now() - start);
    } catch {
      // 실패한 샘플은 무시하고 계속 진행
    }
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  // 중앙값을 사용해 순간적인 튐(outlier)의 영향을 줄임
  return Math.round(samples[Math.floor(samples.length / 2)]);
}

async function measureDownloadMbps(url) {
  const start = performance.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("테스트 파일을 받아오지 못했습니다.");
  const blob = await res.blob();
  const seconds = (performance.now() - start) / 1000;
  if (seconds <= 0 || blob.size === 0) return 0;
  const mbps = (blob.size * 8) / seconds / 1_000_000;
  return Math.round(mbps * 100) / 100;
}

function buildResult({ latencyMs, downloadMbps, connection }) {
  const latencyOk = latencyMs == null || latencyMs <= THRESHOLD_LATENCY_MS;
  const speedOk = downloadMbps != null && downloadMbps >= THRESHOLD_MBPS;
  return {
    latencyMs,
    downloadMbps,
    connectionType: connection?.type ?? connection?.effectiveType ?? null,
    suggestedStatus: speedOk && latencyOk ? "정상" : "불량",
    measuredAt: new Date().toISOString(),
  };
}

/**
 * 통신상태를 측정합니다.
 * @returns {Promise<{latencyMs:number|null, downloadMbps:number, connectionType:string|null, suggestedStatus:"정상"|"불량", measuredAt:string}>}
 */
export async function runNetworkTest() {
  const connection = getConnectionInfo();

  if (!isSupabaseConfigured) {
    // 데모 모드: 실제 네트워크 요청 없이 모의 측정값을 생성합니다.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const latencyMs = Math.round(15 + Math.random() * 80);
    const downloadMbps = Math.round((5 + Math.random() * 150) * 100) / 100;
    return buildResult({ latencyMs, downloadMbps, connection });
  }

  const { data } = supabase.storage.from(TEST_BUCKET).getPublicUrl(TEST_FILE);
  const testUrl = data?.publicUrl;
  if (!testUrl) {
    throw new Error(
      `측정용 테스트 파일을 찾을 수 없습니다. Supabase Storage의 "${TEST_BUCKET}" 버킷에 "${TEST_FILE}"을 업로드해주세요.`
    );
  }

  // 1) CDN 엣지 예열 (이 요청의 시간은 측정에 포함하지 않음)
  await warmUp(testUrl);

  // 2) 예열된 상태에서 실제 측정
  const latencyMs = await measureLatency(testUrl);
  const downloadMbps = await measureDownloadMbps(testUrl);

  return buildResult({ latencyMs, downloadMbps, connection });
}
