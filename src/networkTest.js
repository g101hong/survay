import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * 통신상태 실측 유틸리티
 * ------------------------------------------------------------------
 * 브라우저에서는 와이파이 신호세기(RSSI)를 직접 측정할 수 없으므로,
 * 대신 "실제로 데이터를 주고받아본 성능"을 측정합니다.
 *   1) 지연시간(latency)  : 소용량 요청을 여러 번 보내 왕복시간(ms) 측정
 *   2) 다운로드 속도       : 고정 크기 테스트 파일을 받아 처리율(Mbps) 계산
 * 두 값을 기준치와 비교해 정상/불량을 자동 제안합니다.
 * (자동 제안일 뿐, 최종 판정은 조사자가 화면에서 확인/수정합니다.)
 * ------------------------------------------------------------------
 * 사전 준비 (Supabase 콘솔에서 1회 설정):
 *   - Storage에 "network-test"라는 이름의 Public 버킷 생성
 *   - 그 안에 200~500KB 정도의 더미 파일을 "testfile.bin" 이름으로 업로드
 *     (예: 터미널에서 `head -c 300000 /dev/urandom > testfile.bin` 로 생성)
 */

const LATENCY_SAMPLES = 4;
const TEST_BUCKET = "network-test";
const TEST_FILE = "testfile.bin";

// 판정 기준치 — 필요에 맞게 조정하세요.
const THRESHOLD_MBPS = 1; // 이 값 이상이면 다운로드 속도는 "정상" 범위
const THRESHOLD_LATENCY_MS = 500; // 이 값 이하면 지연시간은 "정상" 범위

function getConnectionInfo() {
  const conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return null;
  // iOS Safari는 navigator.connection 자체가 없어 null이 됩니다 (정상적인 제약사항).
  return {
    type: conn.type || null, // 'wifi' | 'cellular' | ... (일부 브라우저만 제공)
    effectiveType: conn.effectiveType || null, // '4g' 등 대략적 등급
  };
}

function withCacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

async function measureLatency(url) {
  const samples = [];
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const start = performance.now();
    try {
      await fetch(withCacheBust(url), { method: "HEAD", cache: "no-store" });
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
  const res = await fetch(withCacheBust(url), { cache: "no-store" });
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
    const latencyMs = Math.round(40 + Math.random() * 300);
    const downloadMbps = Math.round((0.4 + Math.random() * 8) * 100) / 100;
    return buildResult({ latencyMs, downloadMbps, connection });
  }

  const { data } = supabase.storage.from(TEST_BUCKET).getPublicUrl(TEST_FILE);
  const testUrl = data?.publicUrl;
  if (!testUrl) {
    throw new Error(
      `측정용 테스트 파일을 찾을 수 없습니다. Supabase Storage의 "${TEST_BUCKET}" 버킷에 "${TEST_FILE}"을 업로드해주세요.`
    );
  }

  const latencyMs = await measureLatency(testUrl);
  const downloadMbps = await measureDownloadMbps(testUrl);

  return buildResult({ latencyMs, downloadMbps, connection });
}
