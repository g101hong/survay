// 개발/데모용 목업 데이터.
// 실제 서비스에서는 Supabase의 site_info / ap_detail 테이블 데이터로 대체됩니다.

export const MOCK_SITES = [
  { id: 1, gugun: "강남구", install_year: 2022, location: "강남역 8번출구", address: "서울 강남구 강남대로 396", service_photo_path: null },
  { id: 2, gugun: "강남구", install_year: 2023, location: "역삼공원", address: "서울 강남구 역삼로 155", service_photo_path: null },
  { id: 3, gugun: "서초구", install_year: 2021, location: "서초구청 앞", address: "서울 서초구 남부순환로 2584", service_photo_path: null },
  { id: 4, gugun: "서초구", install_year: 2024, location: "양재시민의숲", address: "서울 서초구 매헌로 108", service_photo_path: null },
  { id: 5, gugun: "송파구", install_year: 2022, location: "석촌호수 서호", address: "서울 송파구 삼전동", service_photo_path: null },
  { id: 6, gugun: "송파구", install_year: 2023, location: "잠실광장", address: "서울 송파구 올림픽로 240", service_photo_path: null },
  { id: 7, gugun: "강남구", install_year: 2024, location: "선릉역 1번출구", address: "서울 강남구 테헤란로 지하 340", service_photo_path: null },
  { id: 8, gugun: "서초구", install_year: 2022, location: "반포한강공원 나들목", address: "서울 서초구 신반포로11길 40", service_photo_path: null },
];

export const MOCK_AP_DETAIL = [
  { id: 101, site_id: 1, ap_no: "AP-01", in_out: "실내", install_point: "1층 대합실", device_status: "정상", network_status: "정상", survey_date: "2026-06-18", remark: "", photo_path: null },
  { id: 102, site_id: 1, ap_no: "AP-02", in_out: "실외", install_point: "출구 상단 차양", device_status: "정상", network_status: "불량", survey_date: "2026-06-18", remark: "우천 시 간헐적 끊김 보고됨", photo_path: null },
  { id: 103, site_id: 2, ap_no: "AP-01", in_out: "실외", install_point: "정자 지붕 하단", device_status: "정상", network_status: "정상", survey_date: "2026-05-02", remark: "", photo_path: null },
  { id: 104, site_id: 3, ap_no: "AP-01", in_out: "실내", install_point: "민원실 천장", device_status: "불량", network_status: "불량", survey_date: "2026-04-11", remark: "전원 미인가, 교체 필요", photo_path: null },
  { id: 105, site_id: 4, ap_no: "AP-01", in_out: "실외", install_point: "산책로 초입 전주", device_status: "정상", network_status: "정상", survey_date: "2026-06-25", remark: "", photo_path: null },
  { id: 106, site_id: 4, ap_no: "AP-02", in_out: "실외", install_point: "숲속쉼터", device_status: "정상", network_status: "정상", survey_date: "2026-06-25", remark: "", photo_path: null },
  { id: 107, site_id: 4, ap_no: "AP-03", in_out: "실외", install_point: "전망대 입구", device_status: "불량", network_status: "정상", survey_date: "2026-06-25", remark: "외함 파손, 방수처리 필요", photo_path: null },
  { id: 108, site_id: 5, ap_no: "AP-01", in_out: "실외", install_point: "서호 산책로 벤치 옆", device_status: "정상", network_status: "정상", survey_date: "2026-03-30", remark: "", photo_path: null },
  { id: 109, site_id: 6, ap_no: "AP-01", in_out: "실외", install_point: "광장 중앙 게시대", device_status: "정상", network_status: "불량", survey_date: "2026-06-01", remark: "혼신 의심, 재조사 예정", photo_path: null },
  { id: 110, site_id: 6, ap_no: "AP-02", in_out: "실외", install_point: "지하철 연결통로 입구", device_status: "정상", network_status: "정상", survey_date: "2026-06-01", remark: "", photo_path: null },
  { id: 111, site_id: 7, ap_no: "AP-01", in_out: "실내", install_point: "지하 승강장", device_status: "정상", network_status: "정상", survey_date: "2026-06-29", remark: "", photo_path: null },
  { id: 112, site_id: 8, ap_no: "AP-01", in_out: "실외", install_point: "나들목 안내소", device_status: "정상", network_status: "정상", survey_date: "2026-05-14", remark: "", photo_path: null },
  { id: 113, site_id: 8, ap_no: "AP-02", in_out: "실외", install_point: "자전거 대여소", device_status: "불량", network_status: "불량", survey_date: "2026-05-14", remark: "기기 도난, 원상복구 대기", photo_path: null },
];
