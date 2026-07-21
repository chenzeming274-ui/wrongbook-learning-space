import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
import { recognizeWrongQuestionImage } from "./local-ocr";

export const MAX_PDF_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const MAX_OCR_PAGES = 5;

export type PDFProgress = { progress: number; text: string };

function readFileAsArrayBuffer(file: File) {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("PDF 文件读取失败。"));
    reader.readAsArrayBuffer(file);
  });
}

export async function extractWrongQuestionPDF(file: File, onProgress?: (report: PDFProgress) => void) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("请选择 PDF 文件。");
  if (file.size > MAX_PDF_INPUT_BYTES) throw new Error("PDF 超过 20MB，请先压缩或拆分后再上传。");

  onProgress?.({ progress: 0.03, text: "正在打开 PDF…" });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) });

  try {
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const textPages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress?.({ progress: 0.05 + (pageNumber / pageCount) * 0.45, text: `正在读取 PDF 第 ${pageNumber}/${pageCount} 页…` });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      textPages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      page.cleanup();
    }

    const embeddedText = textPages.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (embeddedText.length >= 20) {
      await loadingTask.destroy?.();
      onProgress?.({ progress: 1, text: "PDF 文字读取完成" });
      return embeddedText.slice(0, 12000);
    }

    const ocrPages: string[] = [];
    const ocrPageCount = Math.min(pdf.numPages, MAX_OCR_PAGES);
    for (let pageNumber = 1; pageNumber <= ocrPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法读取扫描版 PDF。");
      await page.render({ canvasContext: context, viewport }).promise;
      const pageImage = canvas.toDataURL("image/jpeg", 0.86);
      const pageText = await recognizeWrongQuestionImage(pageImage, (report) => {
        const pageBase = (pageNumber - 1) / ocrPageCount;
        onProgress?.({ progress: 0.5 + (pageBase + report.progress / ocrPageCount) * 0.5, text: `正在识别扫描页 ${pageNumber}/${ocrPageCount}…` });
      });
      ocrPages.push(pageText);
      page.cleanup();
    }
    await loadingTask.destroy?.();
    const scannedText = ocrPages.join("\n").trim();
    if (!scannedText) throw new Error("PDF 中没有识别到题目文字。");
    onProgress?.({ progress: 1, text: "扫描版 PDF 识别完成" });
    return scannedText.slice(0, 12000);
  } catch (error) {
    await loadingTask.destroy?.();
    const message = error instanceof Error ? error.message : "PDF 读取失败";
    if (/password/i.test(message)) throw new Error("暂不支持加密 PDF，请解除密码后重试。");
    throw error;
  }
}
