import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  MapPin,
  Camera,
  Wifi,
  Home,
  TreePine,
  Loader2,
  AlertTriangle,
  ClipboardCheck,
  RotateCcw,
  Check,
  X,
  LayoutDashboard,
  History,
  Clock,
} from "lucide-react";
import {
  fetchSites,
  fetchApDetailsBySite,
  fetchAllApDetails,
  fetchAllSurveyLogs,
  resolvePhotoUrl,
  submitSurvey,
} from "./api";
import { isSupabaseConfigured } from "./supabaseClient";

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

function SignalBars({ ok }) {
  const bars = [4, 8, 12, 16];
  return (
    <span className="inline-flex items-end gap-[2px] h-4" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          style={{ height: `${h}px` }}
          className={`w-[3px] rounded-sm ${
            ok ? "bg-[#2F6F62]" : i < 2 ? "bg-[#C1443B]" : "bg-[#C1443B]/25"
          }`}
        />
      ))}
    </span>
  );
}

function StatusChip({ label, ok }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono tracking-wide whitespace-nowrap shrink-0 ${
        ok ? "bg-[#DCE9E6] text-[#1E4F45]" : "bg-[#F4DEDB] text-[#8C2F27]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-[#2F6F62]" : "bg-[#C1443B]"}`} />
      {label}
    </span>
  );
}

function PhotoTile({ label, url, tall }) {
  const [open, setOpen] = useState(false);

  if (url) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`relative overflow-hidden rounded-md border border-[#D8DEDC] bg-[#EEF2F1] flex items-center justify-center w-full cursor-zoom-in ${
            tall ? "h-56" : "h-40"
          }`}
        >
          <img src={url} alt={label} className="w-full h-full object-contain" />
        </button>

        {open && (
          <div
            className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-white/80 hover:text-white p-1"
              aria-label="닫기"
            >
              <X size={22} />
            </button>
            <img
              src={url}
              alt={label}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-md"
            />
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/70 text-[11px] font-mono">
              {label}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-[#D8DEDC] bg-gradient-to-br from-[#EEF2F1] to-[#DCE4E2] flex items-end ${
        tall ? "h-56" : "h-40"
      }`}
    >
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, #C7D2CF 0px, #C7D2CF 1px, transparent 1px, transparent 14px)",
        }}
      />
      <div className="relative z-10 flex items-center gap-1.5 px-2.5 py-2 text-[#4A5A5C]">
        <Camera size={14} strokeWidth={2} />
        <span className="text-[11px] font-mono truncate min-w-0">{label}</span>
      </div>
    </div>
  );
}

function DemoBanner() {
  if (isSupabaseConfigured) return null;
  return (
    <div className="bg-[#FBF2D9] border-b border-[#EBD9A0] text-[#6B5313] text-[12px]">
      <div className="max-w-5xl mx-auto px-6 py-2 flex items-center gap-2">
        <AlertTriangle size={13} />
        데모 모드입니다. Supabase 환경변수가 설정되면 실제 DB 데이터로 자동 전환됩니다.
        환경변수를 이미 넣었는데도 이 배너가 보인다면 개발자도구(F12) Console에서 원인을 확인하세요.
      </div>
    </div>
  );
}

function CenteredLoader() {
  return (
    <div className="flex items-center justify-center py-24 text-[#7A8886]">
      <Loader2 size={18} className="animate-spin mr-2" />
      불러오는 중...
    </div>
  );
}

function ErrorMessage({ message }) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="rounded-lg border border-[#F4DEDB] bg-[#FBF0EE] text-[#8C2F27] text-sm p-4">
        데이터를 불러오지 못했습니다: {message}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List screen (화면 A)                                                */
/* ------------------------------------------------------------------ */

function ListScreen({ onSelect, onDashboard }) {
  const [sites, setSites] = useState(null);
  const [apSummary, setApSummary] = useState([]);
  const [error, setError] = useState(null);

  const [gugun, setGugun] = useState("전체");
  const [year, setYear] = useState("전체");
  const [status, setStatus] = useState("전체");
  const [sortBy, setSortBy] = useState("id");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");

  // 검색어 디바운스 (타이핑 중 매 입력마다 재계산하지 않도록 250ms 지연)
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 250);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSites(), fetchAllApDetails()])
      .then(([siteData, apData]) => {
        if (cancelled) return;
        setSites(siteData);
        setApSummary(apData);
      })
      .catch((err) => !cancelled && setError(err.message ?? String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const guguns = useMemo(
    () => ["전체", ...Array.from(new Set((sites ?? []).map((s) => s.gugun)))],
    [sites]
  );
  const years = useMemo(
    () => ["전체", ...Array.from(new Set((sites ?? []).map((s) => s.install_year))).sort()],
    [sites]
  );

  const SORT_OPTIONS = [
    { value: "id", label: "관리번호순" },
    { value: "yearDesc", label: "설치년도 최신순" },
    { value: "yearAsc", label: "설치년도 오래된순" },
    { value: "badDesc", label: "불량 많은순" },
    { value: "location", label: "위치명순" },
  ];

  const rows = useMemo(() => {
    if (!sites) return [];
    const q = query.toLowerCase();

    const withAps = sites.map((s) => {
      const aps = apSummary.filter((a) => a.site_id === s.id);
      const badCount = aps.filter((a) => a.device_status === "불량" || a.network_status === "불량").length;
      return { ...s, aps, apCount: aps.length, badCount };
    });

    const filtered = withAps.filter((s) => {
      if (gugun !== "전체" && s.gugun !== gugun) return false;
      if (year !== "전체" && s.install_year !== Number(year)) return false;
      if (status === "정상" && s.badCount > 0) return false;
      if (status === "점검필요" && s.badCount === 0) return false;
      if (q) {
        const inSite = `${s.location} ${s.address} ${s.gugun}`.toLowerCase().includes(q);
        const inAp = s.aps.some((a) =>
          `${a.ap_no} ${a.install_point}`.toLowerCase().includes(q)
        );
        if (!inSite && !inAp) return false;
      }
      return true;
    });

    const sorted = filtered.slice().sort((a, b) => {
      switch (sortBy) {
        case "yearDesc":
          return b.install_year - a.install_year;
        case "yearAsc":
          return a.install_year - b.install_year;
        case "badDesc":
          return b.badCount - a.badCount || a.id - b.id;
        case "location":
          return a.location.localeCompare(b.location, "ko");
        default:
          return a.id - b.id;
      }
    });

    return sorted;
  }, [sites, apSummary, gugun, year, status, sortBy, query]);

  const activeFilters = useMemo(() => {
    const chips = [];
    if (query) chips.push({ key: "query", label: `"${query}"`, clear: () => setQueryInput("") });
    if (gugun !== "전체") chips.push({ key: "gugun", label: gugun, clear: () => setGugun("전체") });
    if (year !== "전체") chips.push({ key: "year", label: `${year}년`, clear: () => setYear("전체") });
    if (status !== "전체") chips.push({ key: "status", label: status, clear: () => setStatus("전체") });
    return chips;
  }, [query, gugun, year, status]);

  function resetFilters() {
    setQueryInput("");
    setGugun("전체");
    setYear("전체");
    setStatus("전체");
    setSortBy("id");
  }

  return (
    <div className="min-h-full bg-[#F3F5F4] text-[#1C2B2C]">
      <DemoBanner />
      <header className="border-b border-[#D8DEDC] bg-[#F3F5F4]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#2F6F62] mb-1">
              <Wifi size={16} strokeWidth={2.5} />
              <span className="text-[11px] font-mono tracking-[0.18em] uppercase">공공 와이파이 현장조사</span>
            </div>
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight font-display">
              설치 현황 조회
            </h1>
          </div>
          <button
            onClick={onDashboard}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D8DEDC] bg-white px-3 py-2 text-[13px] font-medium text-[#4A5A5C] hover:border-[#2F6F62] hover:text-[#2F6F62] transition-colors shrink-0"
          >
            <LayoutDashboard size={14} />
            <span className="hidden sm:inline">대시보드</span>
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-4">
          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A8886]" />
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="위치, 주소, AP번호로 검색"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62] focus:ring-2 focus:ring-[#2F6F62]/15"
            />
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <select
              value={gugun}
              onChange={(e) => setGugun(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62]"
            >
              {guguns.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62]"
            >
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62]"
            >
              {["전체", "정상", "점검필요"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62]"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="col-span-2 sm:col-span-1 text-[12px] font-mono text-[#7A8886] sm:ml-auto whitespace-nowrap">
              {rows.length}건
            </span>
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={f.clear}
                  className="inline-flex items-center gap-1 rounded-full bg-[#DCE9E6] text-[#1E4F45] text-[12px] pl-2.5 pr-1.5 py-1 hover:bg-[#CBE0DB] transition-colors"
                >
                  {f.label}
                  <X size={12} />
                </button>
              ))}
              <button
                onClick={resetFilters}
                className="text-[12px] text-[#7A8886] hover:text-[#1C2B2C] underline underline-offset-2 ml-1"
              >
                필터 초기화
              </button>
            </div>
          )}
        </div>
      </header>

      {error && <ErrorMessage message={error} />}
      {!error && !sites && <CenteredLoader />}

      {!error && sites && (
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          {/* 모바일: 카드 목록 (좁은 컬럼에 한글이 세로로 쪼개지는 문제 방지) */}
          <div className="grid gap-2.5 md:hidden">
            {rows.map((s) => (
              <div
                key={s.id}
                onClick={() => onSelect(s.id)}
                className="rounded-lg border border-[#D8DEDC] bg-white p-4 overflow-hidden active:bg-[#F3F5F4] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-[16px] font-semibold leading-snug flex items-center gap-1.5 min-w-0">
                    <MapPin size={14} className="text-[#7A8886] shrink-0" />
                    <span className="truncate min-w-0">{s.location}</span>
                  </h3>
                  {s.badCount === 0 ? (
                    <StatusChip label="정상" ok />
                  ) : (
                    <StatusChip label={`불량 ${s.badCount}`} ok={false} />
                  )}
                </div>
                <p className="text-[13px] text-[#7A8886] truncate mb-3">{s.address}</p>
                <div className="flex items-center gap-3 text-[12px] font-mono text-[#4A5A5C] pt-2.5 border-t border-[#EEF1F0]">
                  <span>#{String(s.id).padStart(3, "0")}</span>
                  <span className="w-px h-3 bg-[#E7EBEA]" />
                  <span>{s.gugun}</span>
                  <span className="w-px h-3 bg-[#E7EBEA]" />
                  <span>{s.install_year}</span>
                  <span className="w-px h-3 bg-[#E7EBEA]" />
                  <span>AP {s.apCount}대</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="text-center text-[#7A8886] text-sm py-16 border border-dashed border-[#D8DEDC] rounded-lg">
                <p>조건에 맞는 지점이 없습니다.</p>
                <button onClick={resetFilters} className="mt-2 text-[#2F6F62] underline underline-offset-2">
                  필터 초기화
                </button>
              </div>
            )}
          </div>

          {/* 데스크톱: 표 형식 */}
          <div className="hidden md:block rounded-lg border border-[#D8DEDC] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-mono uppercase tracking-wide text-[#7A8886] border-b border-[#E7EBEA]">
                  <th className="px-4 py-3 font-medium">관리번호</th>
                  <th className="px-4 py-3 font-medium">구군</th>
                  <th className="px-4 py-3 font-medium">설치년도</th>
                  <th className="px-4 py-3 font-medium">위치</th>
                  <th className="px-4 py-3 font-medium">주소</th>
                  <th className="px-4 py-3 font-medium text-right">AP</th>
                  <th className="px-4 py-3 font-medium text-right">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    className="border-b border-[#EEF1F0] last:border-0 hover:bg-[#F3F5F4] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[#4A5A5C] whitespace-nowrap">
                      {String(s.id).padStart(3, "0")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.gugun}</td>
                    <td className="px-4 py-3 font-mono whitespace-nowrap">{s.install_year}</td>
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <MapPin size={13} className="text-[#7A8886] shrink-0" />
                        {s.location}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#7A8886] truncate max-w-[220px]">{s.address}</td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">{s.apCount}대</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {s.badCount === 0 ? (
                        <StatusChip label="정상" ok />
                      ) : (
                        <StatusChip label={`불량 ${s.badCount}`} ok={false} />
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#7A8886] text-sm">
                      조건에 맞는 지점이 없습니다.{" "}
                      <button onClick={resetFilters} className="text-[#2F6F62] underline underline-offset-2">
                        필터 초기화
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail screen (화면 B)                                              */
/* ------------------------------------------------------------------ */

function DetailScreen({ siteId, onBack, onSurvey }) {
  const [site, setSite] = useState(null);
  const [aps, setAps] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSite(null);
    setAps(null);
    Promise.all([fetchSites(), fetchApDetailsBySite(siteId)])
      .then(([sites, apData]) => {
        if (cancelled) return;
        setSite(sites.find((s) => s.id === siteId) ?? null);
        setAps(apData);
      })
      .catch((err) => !cancelled && setError(err.message ?? String(err)));
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const okCount = useMemo(
    () => (aps ?? []).filter((a) => a.device_status === "정상" && a.network_status === "정상").length,
    [aps]
  );

  return (
    <div className="min-h-full bg-[#F3F5F4] text-[#1C2B2C]">
      <DemoBanner />
      <header className="border-b border-[#D8DEDC] bg-[#F3F5F4]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-[13px] text-[#4A5A5C] hover:text-[#1C2B2C] transition-colors"
          >
            <ChevronLeft size={15} /> 목록으로
          </button>
        </div>
      </header>

      {error && <ErrorMessage message={error} />}
      {!error && (!site || !aps) && <CenteredLoader />}

      {!error && site && aps && (
        <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
          <section className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-5">
            <div className="rounded-lg border border-[#D8DEDC] bg-white p-6">
              <div className="text-[11px] font-mono tracking-[0.18em] uppercase text-[#7A8886] mb-2">
                관리번호 {String(site.id).padStart(3, "0")}
              </div>
              <h1 className="text-[26px] font-semibold tracking-tight mb-4 font-display">{site.location}</h1>
              <dl className="grid grid-cols-2 gap-y-3 text-sm">
                <div>
                  <dt className="text-[#7A8886] text-[12px] mb-0.5">구군</dt>
                  <dd>{site.gugun}</dd>
                </div>
                <div>
                  <dt className="text-[#7A8886] text-[12px] mb-0.5">설치년도</dt>
                  <dd className="font-mono">{site.install_year}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[#7A8886] text-[12px] mb-0.5">주소</dt>
                  <dd>{site.address}</dd>
                </div>
              </dl>

              <div className="mt-5 flex items-center gap-4 pt-4 border-t border-[#EEF1F0]">
                <div className="text-sm">
                  <span className="font-mono text-lg">{aps.length}</span>
                  <span className="text-[#7A8886] ml-1">대 설치</span>
                </div>
                <div className="text-sm">
                  <span className="font-mono text-lg text-[#2F6F62]">{okCount}</span>
                  <span className="text-[#7A8886] ml-1">정상</span>
                </div>
                <div className="text-sm">
                  <span className="font-mono text-lg text-[#C1443B]">{aps.length - okCount}</span>
                  <span className="text-[#7A8886] ml-1">점검 필요</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-[12px] text-[#7A8886] mb-2">서비스범위 사진</div>
              <PhotoTile
                label={`${site.location}.jpg`}
                url={resolvePhotoUrl("service-photos", site.service_photo_path)}
                tall
              />
            </div>
          </section>

          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[15px] font-semibold">설치 AP 목록</h2>
              <span className="text-[12px] font-mono text-[#7A8886]">{aps.length}건</span>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {aps.map((ap) => {
                const isOpen = openId === ap.id;
                const deviceOk = ap.device_status === "정상";
                const netOk = ap.network_status === "정상";
                return (
                  <div
                    key={ap.id}
                    onClick={() => setOpenId(isOpen ? null : ap.id)}
                    className="rounded-lg border border-[#D8DEDC] bg-white p-4 cursor-pointer hover:border-[#2F6F62]/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold">{ap.ap_no}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#7A8886] border border-[#E7EBEA] rounded px-1.5 py-0.5">
                          {ap.in_out === "실내" ? <Home size={11} /> : <TreePine size={11} />}
                          {ap.in_out}
                        </span>
                      </div>
                      <SignalBars ok={netOk} />
                    </div>

                    <div className="text-[13px] text-[#4A5A5C] mb-3 flex items-center gap-1.5">
                      <MapPin size={12} className="text-[#7A8886]" />
                      {ap.install_point}
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <StatusChip label={`기기 ${ap.device_status}`} ok={deviceOk} />
                      <StatusChip label={`통신 ${ap.network_status}`} ok={netOk} />
                    </div>

                    {isOpen && (
                      <div className="pt-3 border-t border-[#EEF1F0] space-y-3">
                        <PhotoTile
                          label={`${site.location}_${ap.ap_no.slice(-2)}.jpg`}
                          url={resolvePhotoUrl("ap-photos", ap.photo_path)}
                        />
                        {ap.survey_photo_path && (
                          <div>
                            <div className="text-[11px] text-[#7A8886] mb-1.5">최근 조사 사진</div>
                            <PhotoTile
                              label="현장조사 사진"
                              url={resolvePhotoUrl("ap-survey-photos", ap.survey_photo_path)}
                            />
                          </div>
                        )}
                        <div className="text-[12px] text-[#7A8886] flex justify-between">
                          <span>최근 조사일</span>
                          <span className="font-mono text-[#1C2B2C]">{ap.survey_date || "조사 이력 없음"}</span>
                        </div>
                        {ap.remark && (
                          <div className="text-[12px] bg-[#F3F5F4] rounded-md p-2.5 text-[#4A5A5C]">
                            {ap.remark}
                          </div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSurvey(site, ap);
                          }}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#2F6F62] text-white text-[13px] font-medium py-2.5 hover:bg-[#28594E] transition-colors"
                        >
                          <ClipboardCheck size={14} />
                          현장조사 입력
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Survey input screen (화면 C) — mobile-first                         */
/* ------------------------------------------------------------------ */

function ToggleField({ label, value, onChange }) {
  return (
    <div>
      <div className="text-[13px] text-[#4A5A5C] mb-2">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {["정상", "불량"].map((opt) => {
          const active = value === opt;
          const isBad = opt === "불량";
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`py-3 rounded-md text-[14px] font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                active
                  ? isBad
                    ? "bg-[#C1443B] border-[#C1443B] text-white"
                    : "bg-[#2F6F62] border-[#2F6F62] text-white"
                  : "bg-white border-[#D8DEDC] text-[#4A5A5C]"
              }`}
            >
              {active && <Check size={14} />}
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SurveyScreen({ site, ap, onDone, onCancel }) {
  const [deviceStatus, setDeviceStatus] = useState(ap.device_status || "정상");
  const [networkStatus, setNetworkStatus] = useState(ap.network_status || "정상");
  const [remark, setRemark] = useState(ap.remark || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef(null);

  const existingPhotoUrl = resolvePhotoUrl("ap-survey-photos", ap.survey_photo_path);

  function handlePickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await submitSurvey({
        apId: ap.id,
        apNo: ap.ap_no,
        location: site.location,
        deviceStatus,
        networkStatus,
        remark,
        photoFile,
      });
      setDone(true);
      setTimeout(() => onDone(), 900);
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-full bg-[#F3F5F4] flex items-center justify-center px-6">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-[#DCE9E6] text-[#2F6F62] flex items-center justify-center mx-auto mb-3">
            <Check size={22} />
          </div>
          <p className="text-[15px] font-medium text-[#1C2B2C]">조사 결과가 저장됐어요</p>
          <p className="text-[13px] text-[#7A8886] mt-1">지점 화면으로 돌아갑니다...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#F3F5F4] text-[#1C2B2C]">
      <DemoBanner />
      <header className="border-b border-[#D8DEDC] bg-white sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-1 text-[13px] text-[#4A5A5C] hover:text-[#1C2B2C] transition-colors disabled:opacity-40"
          >
            <ChevronLeft size={15} /> 취소
          </button>
          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#7A8886]">현장조사 입력</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 sm:px-6 py-6 space-y-6 pb-28">
        <div className="rounded-lg border border-[#D8DEDC] bg-white p-4">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#7A8886] mb-1.5">
            {site.location}
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[15px] font-semibold">{ap.ap_no}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#7A8886] border border-[#E7EBEA] rounded px-1.5 py-0.5">
              {ap.in_out === "실내" ? <Home size={11} /> : <TreePine size={11} />}
              {ap.in_out}
            </span>
          </div>
          <div className="text-[13px] text-[#4A5A5C] flex items-center gap-1.5">
            <MapPin size={12} className="text-[#7A8886]" />
            {ap.install_point}
          </div>
        </div>

        <ToggleField label="기기상태" value={deviceStatus} onChange={setDeviceStatus} />
        <ToggleField label="통신상태" value={networkStatus} onChange={setNetworkStatus} />

        <div>
          <div className="text-[13px] text-[#4A5A5C] mb-2">현장사진</div>
          {photoPreview || existingPhotoUrl ? (
            <div className="relative">
              <div className="rounded-md overflow-hidden border border-[#D8DEDC] bg-[#EEF2F1] h-52 flex items-center justify-center">
                <img
                  src={photoPreview || existingPhotoUrl}
                  alt="현장조사 사진"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <label className="flex-1 text-center py-2 rounded-md border border-[#D8DEDC] bg-white text-[13px] text-[#4A5A5C] cursor-pointer">
                  다시 촬영
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePickPhoto}
                    className="hidden"
                  />
                </label>
                {photoPreview && (
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="px-3 rounded-md border border-[#D8DEDC] bg-white text-[#7A8886]"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 h-40 rounded-md border-2 border-dashed border-[#D8DEDC] bg-white text-[#7A8886] cursor-pointer">
              <Camera size={22} />
              <span className="text-[13px]">탭하여 촬영 또는 사진 선택</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePickPhoto}
                className="hidden"
              />
            </label>
          )}
        </div>

        <div>
          <div className="text-[13px] text-[#4A5A5C] mb-2">비고</div>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            placeholder="특이사항을 입력하세요 (예: 외함 파손, 재조사 필요 등)"
            className="w-full rounded-md border border-[#D8DEDC] bg-white p-3 text-[14px] outline-none focus:border-[#2F6F62] focus:ring-2 focus:ring-[#2F6F62]/15 resize-none"
          />
        </div>

        {error && (
          <div className="rounded-md border border-[#F4DEDB] bg-[#FBF0EE] text-[#8C2F27] text-[13px] p-3">
            저장하지 못했습니다: {error}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-[#D8DEDC] px-4 sm:px-6 py-3">
        <div className="max-w-lg mx-auto flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDeviceStatus(ap.device_status || "정상");
              setNetworkStatus(ap.network_status || "정상");
              setRemark(ap.remark || "");
              clearPhoto();
            }}
            disabled={saving}
            className="px-4 rounded-md border border-[#D8DEDC] text-[#4A5A5C] text-[14px] inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <RotateCcw size={14} />
            초기화
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-md bg-[#2F6F62] text-white text-[14px] font-medium py-3 inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? "저장 중..." : "조사 결과 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard (화면 D)                                                  */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, tone }) {
  const toneClass =
    tone === "good" ? "text-[#2F6F62]" : tone === "bad" ? "text-[#C1443B]" : "text-[#1C2B2C]";
  return (
    <div className="rounded-lg border border-[#D8DEDC] bg-white p-4">
      <div className="text-[12px] text-[#7A8886] mb-1.5">{label}</div>
      <div className={`text-[26px] font-semibold font-mono ${toneClass}`}>{value}</div>
    </div>
  );
}

function BarRow({ label, count, total, badCount, unit }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between text-[13px] mb-1.5">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-[#7A8886]">
          {count}
          {unit} {badCount > 0 && <span className="text-[#C1443B]">· 불량 {badCount}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#EEF1F0] overflow-hidden">
        <div className="h-full bg-[#2F6F62] rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function computeHistoryFlags(logs) {
  const byAp = {};
  for (const log of logs) {
    (byAp[log.ap_id] ??= []).push(log);
  }
  const flags = [];
  for (const apId of Object.keys(byAp)) {
    const sorted = byAp[apId].slice().sort((a, b) => a.survey_date.localeCompare(b.survey_date));
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const bad = sorted[i].device_status === "불량" || sorted[i].network_status === "불량";
      if (bad) streak++;
      else break;
    }
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const lastBad = last.device_status === "불량" || last.network_status === "불량";
    const prevOk = prev && prev.device_status === "정상" && prev.network_status === "정상";

    if (streak >= 2) {
      flags.push({ apId: Number(apId), type: "repeated", streak, lastDate: last.survey_date });
    } else if (prevOk && lastBad) {
      flags.push({ apId: Number(apId), type: "worsened", lastDate: last.survey_date });
    }
  }
  return flags.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

function DashboardScreen({ onBack, onOpenSite }) {
  const [sites, setSites] = useState(null);
  const [aps, setAps] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSites(), fetchAllApDetails(), fetchAllSurveyLogs()])
      .then(([siteData, apData, logData]) => {
        if (cancelled) return;
        setSites(siteData);
        setAps(apData);
        setLogs(logData);
      })
      .catch((err) => !cancelled && setError(err.message ?? String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const siteById = useMemo(() => Object.fromEntries((sites ?? []).map((s) => [s.id, s])), [sites]);

  const totals = useMemo(() => {
    if (!aps) return null;
    const bad = aps.filter((a) => a.device_status === "불량" || a.network_status === "불량");
    return { siteCount: sites?.length ?? 0, apCount: aps.length, badCount: bad.length, okCount: aps.length - bad.length };
  }, [aps, sites]);

  const byGugun = useMemo(() => {
    if (!sites || !aps) return [];
    const map = {};
    for (const s of sites) {
      map[s.gugun] ??= { label: s.gugun, count: 0, badCount: 0 };
    }
    for (const a of aps) {
      const s = siteById[a.site_id];
      if (!s) continue;
      map[s.gugun].count += 1;
      if (a.device_status === "불량" || a.network_status === "불량") map[s.gugun].badCount += 1;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [sites, aps, siteById]);

  const byYear = useMemo(() => {
    if (!sites || !aps) return [];
    const map = {};
    for (const s of sites) {
      map[s.install_year] ??= { label: String(s.install_year), count: 0, badCount: 0 };
    }
    for (const a of aps) {
      const s = siteById[a.site_id];
      if (!s) continue;
      map[s.install_year].count += 1;
      if (a.device_status === "불량" || a.network_status === "불량") map[s.install_year].badCount += 1;
    }
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label));
  }, [sites, aps, siteById]);

  const badAps = useMemo(() => {
    if (!aps) return [];
    return aps
      .filter((a) => a.device_status === "불량" || a.network_status === "불량")
      .map((a) => ({ ...a, site: siteById[a.site_id] }))
      .sort((a, b) => (b.survey_date ?? "").localeCompare(a.survey_date ?? ""));
  }, [aps, siteById]);

  const uncheckedAps = useMemo(() => {
    if (!aps) return [];
    const missing = aps.filter((a) => !a.survey_date);
    const old = aps
      .filter((a) => a.survey_date)
      .sort((a, b) => a.survey_date.localeCompare(b.survey_date));
    return [...missing, ...old].slice(0, 6).map((a) => ({ ...a, site: siteById[a.site_id] }));
  }, [aps, siteById]);

  const historyFlags = useMemo(() => {
    if (!logs || !aps) return [];
    return computeHistoryFlags(logs)
      .map((f) => {
        const ap = aps.find((a) => a.id === f.apId);
        if (!ap) return null;
        return { ...f, ap, site: siteById[ap.site_id] };
      })
      .filter(Boolean);
  }, [logs, aps, siteById]);

  const loading = !sites || !aps || !logs;

  return (
    <div className="min-h-full bg-[#F3F5F4] text-[#1C2B2C]">
      <DemoBanner />
      <header className="border-b border-[#D8DEDC] bg-[#F3F5F4]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-[13px] text-[#4A5A5C] hover:text-[#1C2B2C] transition-colors mb-3"
          >
            <ChevronLeft size={15} /> 목록으로
          </button>
          <div className="flex items-center gap-2 text-[#2F6F62] mb-1">
            <LayoutDashboard size={16} strokeWidth={2.5} />
            <span className="text-[11px] font-mono tracking-[0.18em] uppercase">현황 요약</span>
          </div>
          <h1 className="text-[24px] leading-tight font-semibold tracking-tight font-display">대시보드</h1>
        </div>
      </header>

      {error && <ErrorMessage message={error} />}
      {!error && loading && <CenteredLoader />}

      {!error && !loading && (
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* 요약 카드 */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="설치 지점" value={totals.siteCount} />
            <StatCard label="전체 AP" value={totals.apCount} />
            <StatCard label="정상 AP" value={totals.okCount} tone="good" />
            <StatCard label="점검 필요 AP" value={totals.badCount} tone="bad" />
          </section>

          {/* 구군별 / 연도별 현황 */}
          <section className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-[#D8DEDC] bg-white p-4">
              <h2 className="text-[14px] font-semibold mb-1">구군별 설치 현황</h2>
              <div className="divide-y divide-[#EEF1F0]">
                {byGugun.map((g) => (
                  <BarRow key={g.label} label={g.label} count={g.count} total={totals.apCount} badCount={g.badCount} unit="대" />
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-[#D8DEDC] bg-white p-4">
              <h2 className="text-[14px] font-semibold mb-1">설치년도별 현황</h2>
              <div className="divide-y divide-[#EEF1F0]">
                {byYear.map((y) => (
                  <BarRow key={y.label} label={y.label} count={y.count} total={totals.apCount} badCount={y.badCount} unit="대" />
                ))}
              </div>
            </div>
          </section>

          {/* 불량 기기 현황 */}
          <section className="rounded-lg border border-[#D8DEDC] bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-[14px] font-semibold flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-[#C1443B]" />
                불량 기기 현황
              </h2>
              <span className="text-[12px] font-mono text-[#7A8886]">{badAps.length}건</span>
            </div>
            {badAps.length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-[#7A8886]">불량으로 등록된 AP가 없습니다.</p>
            ) : (
              <div className="divide-y divide-[#EEF1F0]">
                {badAps.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onOpenSite(a.site_id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#F3F5F4] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">
                        {a.site?.location} · <span className="font-mono">{a.ap_no}</span>
                      </div>
                      <div className="text-[12px] text-[#7A8886] truncate">{a.install_point}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusChip label={`기기 ${a.device_status}`} ok={a.device_status === "정상"} />
                      <StatusChip label={`통신 ${a.network_status}`} ok={a.network_status === "정상"} />
                      <ChevronRight size={14} className="text-[#7A8886]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            {/* 미점검 지점 */}
            <div className="rounded-lg border border-[#D8DEDC] bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h2 className="text-[14px] font-semibold flex items-center gap-1.5">
                  <Clock size={14} className="text-[#7A8886]" />
                  최근 미점검 지점
                </h2>
              </div>
              {uncheckedAps.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-[#7A8886]">모든 AP가 최근 점검되었습니다.</p>
              ) : (
                <div className="divide-y divide-[#EEF1F0]">
                  {uncheckedAps.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onOpenSite(a.site_id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#F3F5F4] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {a.site?.location} · <span className="font-mono">{a.ap_no}</span>
                        </div>
                      </div>
                      <span className="text-[12px] font-mono text-[#C1443B] shrink-0">
                        {a.survey_date || "미조사"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 이력 분석 */}
            <div className="rounded-lg border border-[#D8DEDC] bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h2 className="text-[14px] font-semibold flex items-center gap-1.5">
                  <History size={14} className="text-[#7A8886]" />
                  상태 변화 이력
                </h2>
              </div>
              {historyFlags.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-[#7A8886]">
                  반복 불량이나 상태 악화가 감지된 AP가 없습니다.
                </p>
              ) : (
                <div className="divide-y divide-[#EEF1F0]">
                  {historyFlags.map((f) => (
                    <button
                      key={f.apId}
                      onClick={() => onOpenSite(f.ap.site_id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#F3F5F4] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {f.site?.location} · <span className="font-mono">{f.ap.ap_no}</span>
                        </div>
                        <div className="text-[12px] text-[#7A8886]">{f.lastDate} 기준</div>
                      </div>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-full shrink-0 ${
                          f.type === "repeated" ? "bg-[#F4DEDB] text-[#8C2F27]" : "bg-[#FBF2D9] text-[#6B5313]"
                        }`}
                      >
                        {f.type === "repeated" ? `반복 불량 ${f.streak}회` : "정상 → 불량"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

function BuildMarker() {
  return (
    <div className="fixed bottom-2 right-2 z-[999] text-[10px] font-mono text-[#B9C2C0] bg-white/70 px-1.5 py-0.5 rounded select-none pointer-events-none">
      build v8
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState({ name: "list" });

  let content;

  if (page.name === "survey") {
    content = (
      <SurveyScreen
        site={page.site}
        ap={page.ap}
        onDone={() => setPage({ name: "detail", siteId: page.site.id })}
        onCancel={() => setPage({ name: "detail", siteId: page.site.id })}
      />
    );
  } else if (page.name === "detail") {
    content = (
      <DetailScreen
        siteId={page.siteId}
        onBack={() => setPage({ name: "list" })}
        onSurvey={(site, ap) => setPage({ name: "survey", site, ap })}
      />
    );
  } else if (page.name === "dashboard") {
    content = (
      <DashboardScreen
        onBack={() => setPage({ name: "list" })}
        onOpenSite={(siteId) => setPage({ name: "detail", siteId })}
      />
    );
  } else {
    content = (
      <ListScreen
        onSelect={(siteId) => setPage({ name: "detail", siteId })}
        onDashboard={() => setPage({ name: "dashboard" })}
      />
    );
  }

  return (
    <>
      {content}
      <BuildMarker />
    </>
  );
}
