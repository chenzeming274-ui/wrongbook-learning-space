import { CreateMLCEngine, deleteModelAllInfoInCache, type MLCEngine } from "@mlc-ai/web-llm";

/** Browser-native, Chinese-capable high-performance model. Downloads in-page once, then is cached. */
export const LOCAL_AI_MODEL = "Qwen2.5-1.5B-Instruct";
const LOCAL_AI_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

export type InitProgressReport = { progress: number; text: string };
type ProgressListener = (report: InitProgressReport) => void;
export type LocalAIMessage = { role: "user" | "assistant"; content: string };

let engine: MLCEngine | null = null;
let enginePromise: Promise<MLCEngine> | null = null;
const progressListeners = new Set<ProgressListener>();

function broadcastProgress(progress: number, text: string) {
  const report = { progress: Math.max(0, Math.min(1, progress)), text };
  progressListeners.forEach((listener) => listener(report));
}

export function supportsLocalAI() {
  return typeof navigator !== "undefined" && typeof WebAssembly !== "undefined" && "gpu" in navigator;
}

export async function loadLocalAI(onProgress?: ProgressListener) {
  if (!supportsLocalAI()) {
    throw new Error("此浏览器未开启 WebGPU。请使用最新版 Safari 或 Chrome。");
  }

  if (onProgress) progressListeners.add(onProgress);
  try {
    if (engine) return engine;
    if (!enginePromise) {
      enginePromise = CreateMLCEngine(LOCAL_AI_MODEL_ID, {
        initProgressCallback: (report) => {
          broadcastProgress(report.progress, report.text || `正在安装 AI… ${Math.round(report.progress * 100)}%`);
        },
      })
        .then((createdEngine) => {
          engine = createdEngine;
          broadcastProgress(1, "AI 已安装，可离线使用");
          return createdEngine;
        })
        .catch((error) => {
          enginePromise = null;
          engine = null;
          throw error;
        });
    }
    return await enginePromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

/** Remove only this AI model's downloaded files; learning data is stored separately. */
export async function clearLocalAI() {
  const activeEngine = engine;
  engine = null;
  enginePromise = null;
  if (activeEngine) await activeEngine.unload();
  await deleteModelAllInfoInCache(LOCAL_AI_MODEL_ID);
}

export async function askLocalAI(question: string, history: LocalAIMessage[] = []) {
  const localEngine = await loadLocalAI();
  const response = await localEngine.chat.completions.create({
    model: LOCAL_AI_MODEL_ID,
    messages: [
      {
        role: "system",
        content:
          "你是错题本中的本地学习助手。不要主动提及底层模型的名称、厂商、参数或技术实现，也不要用模型名称介绍自己。请耐心、简洁地直接回答学生的问题；涉及解题时，先给思路，再分步骤说明，最后给结论。无法确定时要明确说明，不要编造。",
      },
      ...history,
      { role: "user", content: question },
    ],
    temperature: 0.25,
    max_tokens: 512,
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI 没有生成回答，请换一种问法再试一次。");
  }
  return content.trim();
}
