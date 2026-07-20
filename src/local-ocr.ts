import type { Worker } from "tesseract.js";

export type OCRProgress = { progress: number; text: string };

let workerPromise: Promise<Worker> | null = null;
let progressListener: ((report: OCRProgress) => void) | undefined;

const statusText: Record<string, string> = {
  "loading tesseract core": "正在启动本机文字识别…",
  "initializing tesseract": "正在初始化文字识别…",
  "loading language traineddata": "正在下载中英文识别数据…",
  "initializing api": "正在准备识别引擎…",
  "recognizing text": "正在识别题目文字…",
};

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(({ createWorker }) => createWorker(["chi_sim", "eng"], undefined, {
        logger: (message) => progressListener?.({
          progress: Math.max(0, Math.min(1, message.progress || 0)),
          text: statusText[message.status] || "正在本机识别文字…",
        }),
      }))
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

/** OCR runs in the browser. Language data is cached after its first download. */
export async function recognizeWrongQuestionImage(image: string, onProgress?: (report: OCRProgress) => void) {
  progressListener = onProgress;
  try {
    const worker = await getWorker();
    const result = await worker.recognize(image, { rotateAuto: true });
    const text = result.data.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("没有识别到文字，请重新拍摄清晰、端正的题目照片。");
    return text;
  } finally {
    progressListener = undefined;
  }
}
