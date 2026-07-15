export const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_OUTPUT_BYTES = 900 * 1024;
const MAX_IMAGE_EDGE = 1600;

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil(base64.length * 0.75);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取这张图片，请换一张重试。")); };
    image.src = url;
  });
}

export async function compressImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请选择 JPG、PNG、WebP 或 HEIC 图片。若 HEIC 无法读取，请先转为 JPG。 ");
  if (file.size > MAX_IMAGE_INPUT_BYTES) throw new Error("原图超过 12MB，请先裁剪后再上传。");

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  let width = Math.max(1, Math.round(image.naturalWidth * scale));
  let height = Math.max(1, Math.round(image.naturalHeight * scale));
  let quality = 0.84;
  let output = "";

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片。");
    context.drawImage(image, 0, 0, width, height);
    output = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(output) <= MAX_IMAGE_OUTPUT_BYTES) return { dataUrl: output, bytes: dataUrlBytes(output), width, height };
    if (quality > 0.55) quality -= 0.1;
    else { width = Math.max(1, Math.round(width * 0.82)); height = Math.max(1, Math.round(height * 0.82)); }
  }

  if (!output || dataUrlBytes(output) > MAX_IMAGE_OUTPUT_BYTES) throw new Error("压缩后仍超过 900KB，请裁剪图片后重试。");
  return { dataUrl: output, bytes: dataUrlBytes(output), width, height };
}
