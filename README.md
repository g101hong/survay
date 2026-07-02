# 와이파이 현장조사 · 조회 화면 (목록/상세)

Vite + React + Tailwind로 만든 정적 웹앱입니다. Supabase 환경변수가 없으면
자동으로 데모(목업) 데이터로 동작하고, 환경변수를 채우면 실제 DB로 전환됩니다.

## 1. 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 확인 (환경변수 없이도 데모 데이터로 바로 동작).

## 2. Supabase 연동

1. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
   ```
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
2. Supabase에 아래 테이블이 필요합니다 (제안서 스키마 기준, 최소 컬럼만 표기):

   ```sql
   create table site_info (
     id bigint generated always as identity primary key,
     gugun text,
     install_year int,
     location text,
     address text,
     service_photo_path text,
     created_at timestamp default now()
   );

   create table ap_detail (
     id bigint generated always as identity primary key,
     site_id bigint references site_info(id),
     ap_no text,
     in_out text,
     install_point text,
     device_status text,
     network_status text,
     survey_date date,
     remark text,
     photo_path text,
     survey_photo_path text,
     created_at timestamp default now()
   );
   ```

3. Storage에 `service-photos`, `ap-photos` 버킷을 만들고 **공개(public) 읽기**로
   설정하면 사진이 상세 화면에 자동으로 표시됩니다 (`resolvePhotoUrl`이
   `getPublicUrl`을 사용합니다). 비공개로 운영하려면 `src/api.js`의
   `resolvePhotoUrl`을 서명된 URL(`createSignedUrl`) 방식으로 바꿔야 합니다.

## 3. Render 배포 (Static Site)

1. 이 프로젝트를 GitHub 저장소에 올립니다.
2. Render 대시보드 → **New** → **Static Site** → 저장소 선택
3. 설정값
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
4. **Environment** 탭에서 환경변수 추가
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - (Vite는 빌드 시점에 환경변수를 정적 파일에 주입하므로, 값을 바꾸면
     반드시 재배포가 필요합니다.)
5. Deploy 후 자동 발급되는 `.onrender.com` 주소로 접속하면 목록/상세 화면이
   바로 열립니다.

## 4. 다음 단계 (제안서 3~4단계)

- 화면 C: 현장조사 입력 화면 (기기상태/통신상태 입력, 사진 업로드, `survey_log` insert)
- 화면 D: 대시보드
- 검색/필터 고도화, 엑셀 내보내기

이 저장소는 화면 A(목록)·화면 B(상세)까지 구현되어 있습니다.
