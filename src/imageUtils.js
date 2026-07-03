/**
 * 이미지 업로드 전 클라이언트에서 리사이즈하기 위한 유틸입니다.
 * 모바일 카메라로 촬영한 원본 사진은 수 MB에 달해 업로드 속도/용량 부담이 크므로,
 * 저장하기 전에 긴 변(가로/세로 중 큰 값) 기준으로 1024px로 축소합니다.
 */

/**
 * 이미지 파일을 캔버스로 리사이즈합니다.
 * 긴 변이 maxEdge(px)를 넘으면 가로세로 비율을 유지한 채 축소하고,
 * 이미 maxEdge 이하라면 리사이즈 없이 원본을 그대로 반환합니다.
 *
 * @param {File} file - 원본 이미지 파일 (카메라 촬영/갤러리 선택)
 * @param {number} maxEdge - 긴 변의 최대 길이(px), 기본 1024
 * @param {number} quality - JPEG 압축 품질(0~1), 기본 0.85
 * @returns {Promise<File>} 리사이즈된 이미지 File 객체 (실패 시 원본 파일을 그대로 반환)
 */
export async function resizeImage(file, maxEdge = 1024, quality = 0.85) {
  if (!file || !file.type?.startsWith("image/")) return file;

  let source;
  try {
    source = await loadImageSource(file);
  } catch (err) {
    console.warn("[wifi-survey] 이미지 로드 실패, 원본 파일을 그대로 사용합니다:", err);
    return file;
  }

  const { width, height } = source;
  const longEdge = Math.max(width, height);

  if (!longEdge || longEdge <= maxEdge) {
    releaseSource(source);
    return file; // 이미 충분히 작으면 그대로 사용
  }

  try {
    const scale = maxEdge / longEdge;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const outputType = "image/jpeg"; // 사진 특성상 jpeg로 통일해 용량을 줄입니다.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
    if (!blob) return file;

    const baseName = file.name?.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${baseName}.jpg`, { type: outputType, lastModified: Date.now() });
  } catch (err) {
    console.warn("[wifi-survey] 이미지 리사이즈 실패, 원본 파일을 그대로 사용합니다:", err);
    return file;
  } finally {
    releaseSource(source);
  }
}

/**
 * 이미지 소스를 로드합니다.
 * createImageBitmap을 지원하는 브라우저에서는 EXIF 방향(orientation) 정보를 반영해
 * 세로로 촬영한 사진이 눕지 않도록 자동 보정합니다.
 */
async function loadImageSource(file) {
  if (typeof window !== "undefined" && window.createImageBitmap) {
    try {
      return await window.createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // 일부 구형 브라우저는 imageOrientation 옵션을 지원하지 않으므로 폴백합니다.
    }
  }
  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function releaseSource(source) {
  if (source && typeof source.close === "function") source.close(); // ImageBitmap 리소스 해제
}
