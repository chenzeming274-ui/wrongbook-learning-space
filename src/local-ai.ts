import { LoggerWithoutDebug, Wllama } from "@wllama/wllama";

// @wllama/wllama 3.5.1 publishes the CDN declaration but omits its JS file,
// so keep the equivalent official CDN path inline.
const WasmFromCDN = {
  default: "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/src/wasm/wllama.wasm",
};

/** Exact GGUF requested by the user. It is downloaded once and cached by Wllama. */
export const LOCAL_AI_MODEL =
  "DeepSeek-R1-Distill-Qwen-1.5B-Q2_K.gguf";
const LOCAL_AI_MODEL_URL =
  "https://huggingface.co/second-state/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q2_K.gguf";

export type InitProgressReport = { progress: number; text: string };
type ProgressListener = (report: InitProgressReport) => void;
export type LocalAIMessage = { role: "user" | "assistant"; content: string };

let engine: Wllama | null = null;
let enginePromise: Promise<Wllama> | null = null;
const progressListeners = new Set<ProgressListener>();

function broadcastProgress(progress: number, text: string) {
  const report = { progress: Math.max(0, Math.min(1, progress)), text };
  progressListeners.forEach((listener) => listener(report));
}

export function supportsLocalAI() {
  return typeof navigator !== "undefined" && typeof WebAssembly !== "undefined";
}

export async function loadLocalAI(onProgress?: ProgressListener) {
  if (!supportsLocalAI()) {
    throw new Error("当前浏览器不支持 WebAssembly，请使用新版 Chrome、Edge 或 Safari。");
  }

  if (onProgress) progressListeners.add(onProgress);
  try {
    if (engine) return engine;

    if (!enginePromise) {
      enginePromise = (async () => {
        const createdEngine = new Wllama(WasmFromCDN, {
          logger: LoggerWithoutDebug,
          parallelDownloads: 3,
          allowOffline: true,
        });
        await createdEngine.loadModelFromUrl(LOCAL_AI_MODEL_URL, {
          n_ctx: 4096,
          n_threads: 2,
          n_gpu_layers: 0,
          reasoning: true,
          reasoning_format: "deepseek",
          progressCallback: ({ loaded, total }) => {
            const progress = total > 0 ? loaded / total : 0;
            broadcastProgress(progress, `正在下载离线模型… ${Math.round(progress * 100)}%`);
          },
        });
        engine = createdEngine;
        broadcastProgress(1, "离线模型已准备完成");
        return createdEngine;
      })().catch((error) => {
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

export async function askLocalAI(question: string, history: LocalAIMessage[] = []) {
  const localEngine = await loadLocalAI();
  const response = await localEngine.createChatCompletion({
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
