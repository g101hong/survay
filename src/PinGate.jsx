// src/PinGate.jsx
//
// 현장조사자용 "공용 접속 코드(PIN)" 게이트.
// - 코드가 맞으면 localStorage에 플래그를 남기고 children(앱 본문)을 렌더링합니다.
// - 코드는 .env의 VITE_SURVEY_PIN 값과 브라우저에서 비교합니다.
//
// ⚠️ 보안 수준에 대한 안내
// Vite는 빌드 시점에 VITE_ 접두사 환경변수를 정적 자산(JS 번들)에 그대로 굳혀 넣습니다.
// 즉 이 PIN은 "제대로 된 인증"이 아니라, 링크를 모르는 외부인의 우발적 접근을 막는
// 가벼운 문 잠금 수준입니다. 데이터 자체를 지키려면 Supabase 테이블의 RLS(행 수준 보안)
// 정책을 별도로 점검하세요. 더 강한 보호가 필요하면 서버(Supabase RPC/Edge Function)에서
// PIN을 검증하는 방식으로 업그레이드할 수 있습니다.

import React, { useEffect, useState } from "react";
import { Lock, Wifi } from "lucide-react";

const STORAGE_KEY = "wifi-survey-pin-ok";
const ATTEMPT_KEY = "wifi-survey-pin-attempts";
const LOCK_UNTIL_KEY = "wifi-survey-pin-lock-until";

// 연속 실패 횟수에 따른 대기시간(초). 인덱스 = 누적 실패 횟수.
const LOCKOUT_STEPS = [0, 0, 5, 15, 30, 60, 120];

function readLockUntil() {
  try {
    const v = Number(localStorage.getItem(LOCK_UNTIL_KEY) || 0);
    return v > Date.now() ? v : 0;
  } catch {
    return 0;
  }
}

export default function PinGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [lockUntil, setLockUntil] = useState(readLockUntil);
  const [now, setNow] = useState(Date.now());

  // 잠금 카운트다운 표시용 타이머
  useEffect(() => {
    if (!lockUntil) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockUntil]);

  const remainingLockSec = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const envPin = import.meta.env.VITE_SURVEY_PIN;

  function handleSubmit(e) {
    e.preventDefault();
    if (remainingLockSec > 0) return;

    if (!envPin) {
      setError("접속 코드가 설정되어 있지 않습니다. 관리자에게 문의하세요.");
      return;
    }

    if (input.trim() === String(envPin).trim()) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
        localStorage.removeItem(ATTEMPT_KEY);
        localStorage.removeItem(LOCK_UNTIL_KEY);
      } catch {
        /* localStorage 사용 불가 환경이면 이번 세션 동안만 잠금 해제 상태 유지 */
      }
      setUnlocked(true);
      setError(null);
      return;
    }

    let attempts = 1;
    try {
      attempts = Number(localStorage.getItem(ATTEMPT_KEY) || 0) + 1;
      localStorage.setItem(ATTEMPT_KEY, String(attempts));
    } catch {
      /* ignore */
    }

    const waitSec = LOCKOUT_STEPS[Math.min(attempts, LOCKOUT_STEPS.length - 1)];
    if (waitSec > 0) {
      const until = Date.now() + waitSec * 1000;
      try {
        localStorage.setItem(LOCK_UNTIL_KEY, String(until));
      } catch {
        /* ignore */
      }
      setLockUntil(until);
    }
    setError("코드가 올바르지 않습니다.");
    setInput("");
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
            disabled={remainingLockSec > 0}
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
          disabled={remainingLockSec > 0 || !input}
          className="w-full rounded-md bg-[#2F6F62] text-white text-[14px] font-medium py-2.5 disabled:opacity-50"
        >
          입장하기
        </button>
      </form>
    </div>
  );
}

/**
 * 헤더/푸터 어디든 배치할 수 있는 "잠금" 버튼.
 * 누르면 localStorage 플래그를 지우고 새로고침하여 PinGate를 다시 띄웁니다.
 * (공용 기기를 여러 사람이 돌려쓸 때 사용)
 */
export function LockButton({ className }) {
  function handleLock() {
    try {
      localStorage.removeItem(STORAGE_KEY);
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
