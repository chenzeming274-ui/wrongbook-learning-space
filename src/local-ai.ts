import { CreateMLCEngine, deleteModelAllInfoInCache, hasModelInCache, type MLCEngine } from "@mlc-ai/web-llm";

/** Start quickly with the compact model, then prepare the stronger model in the background. */
export const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct";
const FAST_MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const UPGRADE_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

export type InitProgressReport = { progress: number; text: string };
type ProgressListener = (report: InitProgressReport) => void;
export type LocalAIMessage = { role: "user" | "assistant"; content: string };

let engine: MLCEngine | null = null;
let enginePromise: Promise<MLCEngine> | null = null;
let activeModelId = FAST_MODEL_ID;
let upgradeEngine: MLCEngine | null = null;
let upgradePromise: Promise<MLCEngine> | null = null;
const progressListeners = new Set<ProgressListener>();

function broadcastProgress(progress: number, text: string) {
  const report = { progress: Math.max(0, Math.min(1, progress)), text };
  progressListeners.forEach((listener) => listener(report));
}

export function sanitizeAIText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ""))
    .replace(/\\\[/g, "\n")
    .replace(/\\\]/g, "\n")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "")
    .replace(/\\left\s*/g, "")
    .replace(/\\right\s*/g, "")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\frac\s*([a-zA-Z0-9+\-^.]+)\s*([a-zA-Z0-9+\-^.]+)/g, "$1/$2")
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\(?:geq|ge)/g, "≥")
    .replace(/\\(?:leq|le)/g, "≤")
    .replace(/\\neq/g, "≠")
    .replace(/\\(?:to|rightarrow)/g, "→")
    .replace(/\\implies/g, "⇒")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/\\/g, "")
    .replace(/[{}]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\bimplies\b/gi, "⇒")
    .replace(/\[\s*([^\[\]\n]*=[^\[\]\n]*)\s*\]/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

export function supportsLocalAI() {
  return typeof navigator !== "undefined" && typeof WebAssembly !== "undefined" && "gpu" in navigator;
}

/** Detect existing browser downloads without starting a new download. */
export async function getCachedLocalAIState() {
  try {
    const [base, upgrade] = await Promise.all([
      hasModelInCache(FAST_MODEL_ID),
      hasModelInCache(UPGRADE_MODEL_ID),
    ]);
    return { base, upgrade };
  } catch {
    return { base: false, upgrade: false };
  }
}

export async function loadLocalAI(onProgress?: ProgressListener) {
  if (!supportsLocalAI()) throw new Error("此浏览器未开启 WebGPU。请使用最新版 Safari 或 Chrome。");
  if (onProgress) progressListeners.add(onProgress);
  try {
    if (engine) return engine;
    if (!enginePromise) {
      enginePromise = CreateMLCEngine(FAST_MODEL_ID, {
        initProgressCallback: (report) => broadcastProgress(report.progress, report.text || `正在安装 AI… ${Math.round(report.progress * 100)}%`),
      }).then((createdEngine) => {
        engine = createdEngine;
        activeModelId = FAST_MODEL_ID;
        broadcastProgress(1, "AI 已安装，可离线使用");
        return createdEngine;
      }).catch((error) => { enginePromise = null; engine = null; throw error; });
    }
    return await enginePromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

/** Downloads and warms up the stronger model without replacing the active conversation. */
export async function prepareAIUpgrade(onProgress?: ProgressListener) {
  if (!supportsLocalAI()) throw new Error("此浏览器未开启 WebGPU。");
  if (upgradeEngine) return upgradeEngine;
  if (!upgradePromise) {
    upgradePromise = CreateMLCEngine(UPGRADE_MODEL_ID, {
      initProgressCallback: (report) => onProgress?.({ progress: report.progress, text: report.text || `正在后台下载升级 AI… ${Math.round(report.progress * 100)}%` }),
    }).then((createdEngine) => {
      upgradeEngine = createdEngine;
      onProgress?.({ progress: 1, text: "升级 AI 已准备完成" });
      return createdEngine;
    }).catch((error) => { upgradePromise = null; upgradeEngine = null; throw error; });
  }
  return upgradePromise;
}

/** Switches engines while keeping app-managed chat history intact. */
export async function upgradeLocalAI() {
  const prepared = await prepareAIUpgrade();
  const oldEngine = engine;
  engine = prepared;
  enginePromise = Promise.resolve(prepared);
  activeModelId = UPGRADE_MODEL_ID;
  upgradeEngine = null;
  upgradePromise = null;
  if (oldEngine && oldEngine !== prepared) await oldEngine.unload();
}

/** Remove only downloaded AI files; learning data and chat records are separate. */
export async function clearLocalAI() {
  const engines = [engine, upgradeEngine].filter((item): item is MLCEngine => Boolean(item));
  engine = null;
  enginePromise = null;
  upgradeEngine = null;
  upgradePromise = null;
  activeModelId = FAST_MODEL_ID;
  await Promise.all(engines.map((item) => item.unload()));
  await Promise.all([deleteModelAllInfoInCache(FAST_MODEL_ID), deleteModelAllInfoInCache(UPGRADE_MODEL_ID)]);
}

export async function askLocalAI(question: string, history: LocalAIMessage[] = [], options?: { raw?: boolean }) {
  const localEngine = await loadLocalAI();
  const response = await localEngine.chat.completions.create({
    model: activeModelId,
    messages: [
      { role: "system", content: "你是错题本中的本地学习助手。不要提及模型名称、厂商、参数或技术实现。直接用简洁中文回答，解题时按“思路、步骤、结论”分行书写。必须使用普通文本和 Unicode 数学符号，绝对禁止 LaTeX、Markdown、反斜杠、花括号、公式定界符和代码块。函数必须写成 f(x)、f'(x)、f(1)，乘法写 ×，分数写 1/2，平方写 x²，不得写 fx、f'x、f1，也不得把乘数和变量粘连。区间可写 [1, 5]。示例：f'(x) = d/dx(1/2 × x² - 3x + 4)。输出前自行检查；若含反斜杠、花括号或 LaTeX 命令，必须改写成普通文本后再回答。无法确定时明确说明，不要编造。" },
      ...history,
      { role: "user", content: question },
    ],
    temperature: 0.25,
    max_tokens: 512,
  });
  const content = response.choices[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("AI 没有生成回答，请换一种问法再试一次。");
  const trimmed = content.trim();
  return options?.raw ? trimmed : sanitizeAIText(trimmed);
}
