import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Search,
  MapPin,
  Camera,
  Wifi,
  Home,
  TreePine,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { fetchSites, fetchApDetailsBySite, fetchAllApDetails, resolvePhotoUrl } from "./api";
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
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono tracking-wide ${
        ok ? "bg-[#DCE9E6] text-[#1E4F45]" : "bg-[#F4DEDB] text-[#8C2F27]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#2F6F62]" : "bg-[#C1443B]"}`} />
      {label}
    </span>
  );
}

function PhotoTile({ label, url, tall }) {
  if (url) {
    return (
      <div className={`relative overflow-hidden rounded-md border border-[#D8DEDC] ${tall ? "h-56" : "h-28"}`}>
        <img src={url} alt={label} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div
      className={`relative overflow-hidden rounded-md border border-[#D8DEDC] bg-gradient-to-br from-[#EEF2F1] to-[#DCE4E2] flex items-end ${
        tall ? "h-56" : "h-28"
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
        <span className="text-[11px] font-mono truncate">{label}</span>
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
        데모 모드입니다. Supabase 환경변수(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)가 설정되면
        실제 DB 데이터로 자동 전환됩니다.
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

function ListScreen({ onSelect }) {
  const [sites, setSites] = useState(null);
  const [apSummary, setApSummary] = useState([]);
  const [error, setError] = useState(null);

  const [gugun, setGugun] = useState("전체");
  const [year, setYear] = useState("전체");
  const [query, setQuery] = useState("");

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

  const rows = useMemo(() => {
    if (!sites) return [];
    return sites
      .filter((s) => {
        if (gugun !== "전체" && s.gugun !== gugun) return false;
        if (year !== "전체" && s.install_year !== Number(year)) return false;
        if (query && !`${s.location} ${s.address}`.includes(query)) return false;
        return true;
      })
      .map((s) => {
        const aps = apSummary.filter((a) => a.site_id === s.id);
        const badCount = aps.filter((a) => a.device_status === "불량" || a.network_status === "불량").length;
        return { ...s, apCount: aps.length, badCount };
      });
  }, [sites, apSummary, gugun, year, query]);

  return (
    <div className="min-h-full bg-[#F3F5F4] text-[#1C2B2C]">
      <DemoBanner />
      <header className="border-b border-[#D8DEDC] bg-[#F3F5F4]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-5">
          <div className="flex items-center gap-2 text-[#2F6F62] mb-1">
            <Wifi size={16} strokeWidth={2.5} />
            <span className="text-[11px] font-mono tracking-[0.18em] uppercase">공공 와이파이 현장조사</span>
          </div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight font-display">
            설치 현황 조회
          </h1>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A8886]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="위치 또는 주소 검색"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62] focus:ring-2 focus:ring-[#2F6F62]/15"
            />
          </div>
          <select
            value={gugun}
            onChange={(e) => setGugun(e.target.value)}
            className="px-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62]"
          >
            {guguns.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="px-3 py-2 rounded-md border border-[#D8DEDC] bg-white text-sm outline-none focus:border-[#2F6F62]"
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <span className="text-[12px] font-mono text-[#7A8886] ml-auto">{rows.length}건</span>
        </div>
      </header>

      {error && <ErrorMessage message={error} />}
      {!error && !sites && <CenteredLoader />}

      {!error && sites && (
        <main className="max-w-5xl mx-auto px-6 py-6">
          <div className="rounded-lg border border-[#D8DEDC] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-mono uppercase tracking-wide text-[#7A8886] border-b border-[#E7EBEA]">
                  <th className="px-4 py-3 font-medium">관리번호</th>
                  <th className="px-4 py-3 font-medium">구군</th>
                  <th className="px-4 py-3 font-medium">설치년도</th>
                  <th className="px-4 py-3 font-medium">위치</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">주소</th>
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
                    <td className="px-4 py-3 font-mono text-[#4A5A5C]">{String(s.id).padStart(3, "0")}</td>
                    <td className="px-4 py-3">{s.gugun}</td>
                    <td className="px-4 py-3 font-mono">{s.install_year}</td>
                    <td className="px-4 py-3 font-medium flex items-center gap-1.5">
                      <MapPin size={13} className="text-[#7A8886]" />
                      {s.location}
                    </td>
                    <td className="px-4 py-3 text-[#7A8886] hidden md:table-cell truncate max-w-[220px]">
                      {s.address}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{s.apCount}대</td>
                    <td className="px-4 py-3 text-right">
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
                      조건에 맞는 지점이 없습니다. 필터를 조정해 주세요.
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

function DetailScreen({ siteId, onBack }) {
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
                        <div className="text-[12px] text-[#7A8886] flex justify-between">
                          <span>최근 조사일</span>
                          <span className="font-mono text-[#1C2B2C]">{ap.survey_date}</span>
                        </div>
                        {ap.remark && (
                          <div className="text-[12px] bg-[#F3F5F4] rounded-md p-2.5 text-[#4A5A5C]">
                            {ap.remark}
                          </div>
                        )}
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
/* Root                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [siteId, setSiteId] = useState(null);

  return siteId ? (
    <DetailScreen siteId={siteId} onBack={() => setSiteId(null)} />
  ) : (
    <ListScreen onSelect={setSiteId} />
  );
}
