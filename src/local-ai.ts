import {
  CreateWebWorkerMLCEngine,
  type InitProgressReport,
  type MLCEngineInterface,
} from "@mlc-ai/web-llm";

export const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

type ProgressListener = (report: InitProgressReport) => void;

let engine: MLCEngineInterface | null = null;
let enginePromise: Promise<MLCEngineInterface> | null = null;
let worker: Worker | null = null;
const progressListeners = new Set<ProgressListener>();

function broadcastProgress(report: InitProgressReport) {
  progressListeners.forEach((listener) => listener(report));
}

export function supportsLocalAI() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function loadLocalAI(onProgress?: ProgressListener) {
  if (!supportsLocalAI()) {
    throw new Error("当前浏览器不支持 WebGPU，请使用新版 Chrome、Edge 或 Safari。");
  }

  if (onProgress) progressListeners.add(onProgress);
  try {
    if (engine) return engine;

    if (!enginePromise) {
      worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
      enginePromise = CreateWebWorkerMLCEngine(worker, LOCAL_AI_MODEL, {
        initProgressCallback: broadcastProgress,
      })
        .then((createdEngine) => {
          engine = createdEngine;
          return createdEngine;
        })
        .catch((error) => {
          worker?.terminate();
          worker = null;
          enginePromise = null;
          throw error;
        });
    }

    return await enginePromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

export async function askLocalAI(question: string) {
  const localEngine = await loadLocalAI();
  const response = await localEngine.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "你是一个耐心、简洁的中文学习助手。请直接回答学生的问题；涉及解题时，先给思路，再分步骤说明，最后给结论。无法确定时要明确说明，不要编造。",
      },
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
