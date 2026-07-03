// src/PinGate.jsx
//
// 현장조사자용 "공용 접속 코드(PIN)" 게이트 — 서버 검증(Supabase RPC) 방식.
//
// 이전 버전과의 차이:
// - PIN 값과 비교 로직이 클라이언트(JS 번들)에 전혀 없습니다. 전부 Supabase
//   DB 함수(verify_survey_pin / check_survey_session)에서 처리됩니다.
//   (자세한 내용은 함께 전달드린 supabase_pin_login.sql 참고)
// - 로그인 성공 시 서버가 발급한 세션 토큰만 localStorage에 저장합니다.
//   재방문 시 이 토큰이 실제로 서버에 유효한지 매번 다시 확인하므로,
//   localStorage 값을 임의로 조작해서 통과하는 것이 불가능합니다.
// - 실패 횟수/잠금시간도 서버가 관리하므로, 클라이언트 코드를 고쳐도
//   무작정 반복 시도를 막는 로직 자체를 우회할 수 없습니다.
//
// ⚠️ 그래도 남아있는 한계
// 이 게이트는 "앱 진입" 단계를 보호하는 것이며, Supabase 테이블 자체의
// 쓰기 권한(RLS)을 대체하지 않습니다. 데이터 자체를 더 엄격히 보호하려면
// site_info / ap_detail / survey_log 테이블의 RLS 정책도 함께 점검하세요.

import React, { useEffect, useState } from "react";
import { Lock, Wifi, Loader2 } from "lucide-react";
import { verifySurveyPin, checkSurveySession } from "./api";

const TOKEN_KEY = "wifi-survey-pin-token";

export default function PinGate({ children }) {
  const [checking, setChecking] = useState(true); // 저장된 토큰이 아직 유효한지 서버에 확인 중
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0); // 서버가 알려준 잠금 해제 시각(ms)
  const [now, setNow] = useState(Date.now());

  // 앱 진입 시: localStorage에 토큰이 있으면 서버에 유효성을 재확인합니다.
  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setChecking(false);
      return;
    }
    checkSurveySession(token)
      .then((valid) => {
        if (cancelled) return;
        if (valid) {
          setUnlocked(true);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => {
        /* 네트워크 오류 등은 무시하고 코드 입력 화면을 보여줍니다 */
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 잠금 카운트다운 표시용 타이머
  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [waitUntil]);

  const remainingLockSec = waitUntil ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || remainingLockSec > 0 || !input) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await verifySurveyPin(input.trim());

      if (result?.ok) {
        localStorage.setItem(TOKEN_KEY, result.token);
        setUnlocked(true);
        return;
      }

      if (result?.error === "not_configured") {
        setError("접속 코드가 아직 설정되지 않았습니다. 관리자에게 문의하세요.");
      } else if (result?.error === "locked") {
        setError("시도 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.");
      } else {
        setError("코드가 올바르지 않습니다.");
      }

      if (result?.wait_seconds > 0) {
        setWaitUntil(Date.now() + result.wait_seconds * 1000);
      }
    } catch (err) {
      setError(err.message ?? "확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
      setInput("");
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#F3F5F4] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#7A8886]" />
      </div>
    );
  }

  if (unlocked) {
    return children;
  }

  return (
    <div className="min-h-screen bg-[#F3F5F4] flex items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-[#D8DEDC] bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-2 text-[#2F6F62] mb-1">
          <Wifi size={16} strokeWidth={2.5} />
          <span className="text-[11px] font-mono tracking-[0.18em] uppercase">공공 와이파이 현장조사</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight mb-1 font-display">접속 코드 입력</h1>
        <p className="text-[13px] text-[#7A8886] mb-5">현장조사자에게 배포된 코드를 입력해주세요.</p>

        <div className="relative mb-3">
          <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A8886]" />
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={submitting || remainingLockSec > 0}
            placeholder="코드 입력"
            className="w-full pl-9 pr-3 py-2.5 rounded-md border border-[#D8DEDC] text-[15px] tracking-[0.2em] focus:outline-none focus:border-[#2F6F62] disabled:bg-[#F3F5F4] disabled:text-[#B9C2C0]"
          />
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-[#F4DEDB] bg-[#FBF0EE] text-[#8C2F27] text-[13px] px-3 py-2">
            {error}
          </div>
        )}

        {remainingLockSec > 0 && (
          <div className="mb-3 text-[12px] text-[#7A8886]">
            {remainingLockSec}초 후 다시 시도할 수 있습니다.
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || remainingLockSec > 0 || !input}
          className="w-full rounded-md bg-[#2F6F62] text-white text-[14px] font-medium py-2.5 inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? "확인 중..." : "입장하기"}
        </button>
      </form>
    </div>
  );
}

/**
 * 헤더/푸터 어디든 배치할 수 있는 "잠금" 버튼.
 * 로컬에 저장된 세션 토큰만 지우고 새로고침합니다(로컬 로그아웃).
 * 서버의 세션 토큰 자체는 만료일(기본 30일)까지 유효하게 남아있습니다 —
 * 즉시 무효화가 필요하다면 Supabase에서 해당 토큰 행을 직접 삭제하거나,
 * app_pin_sessions 테이블을 전체 비우면 됩니다.
 */
export function LockButton({ className }) {
  function handleLock() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={handleLock}
      className={
        className ||
        "fixed bottom-2 left-2 z-[999] inline-flex items-center gap-1 text-[10px] font-mono text-[#B9C2C0] bg-white/70 px-1.5 py-0.5 rounded hover:text-[#4A5A5C] select-none"
      }
    >
      <Lock size={10} />
      잠금
    </button>
  );
}
