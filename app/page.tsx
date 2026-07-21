"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isAnswerCorrect } from "../src/answer-utils";
import { compressImage } from "../src/image-utils";
import { recognizeWrongQuestionImage } from "../src/local-ocr";
import { askLocalAI, clearLocalAI, getCachedLocalAIState, loadLocalAI, prepareAIUpgrade, sanitizeAIText, supportsLocalAI, upgradeLocalAI, type LocalAIMessage } from "../src/local-ai";
import { buildQuestionAutofillPrompt, parseQuestionAutofill } from "../src/question-autofill";
import { calculateMastery, calculateNextReviewAt, enforceLatestPhoto, exportWrongbookJSON, getReviewStats, getQuestionMastery, importWrongbookJSON, isDueToday, mergeNotebooks, migrateNotebooks, recordReview, type Notebook, type WrongQuestion } from "../src/wrongbook-data";

const seedQuestion: WrongQuestion = {
  id: "q-1",
  stem: "若函数 f(x) = x² - 4x + 3，则 f(x) 的最小值是多少？",
  answer: "-1",
  explanation: "配方得 f(x) = (x - 2)² - 1。因为平方项恒大于等于 0，所以当 x = 2 时，函数取得最小值 -1。",
  type: "二次函数",
  createdAt: "今天",
  mastered: false,
  source: "manual",
  attempts: 0,
  correctAttempts: 0,
  mastery: 0,
};

const starterNotebooks: Notebook[] = [
  { id: "math", name: "数学 · 高中", color: "violet", questions: [seedQuestion] },
  { id: "english", name: "英语 · 语法", color: "mint", questions: [] },
  { id: "science", name: "物理 · 力学", color: "orange", questions: [] },
];

const generated: Record<string, Array<{ stem: string; answer: string; explanation: string }>> = {
  "二次函数": [
    { stem: "函数 y = x² - 8x + 7 的最小值是？", answer: "-9", explanation: "配方得 y = (x - 4)² - 9，因此最小值为 -9。" },
    { stem: "函数 y = 2x² + 4x - 6 的最小值是？", answer: "-8", explanation: "配方得 y = 2(x + 1)² - 8，因此最小值为 -8。" },
    { stem: "函数 y = -x² + 6x - 5 的最大值是？", answer: "4", explanation: "配方得 y = -(x - 3)² + 4，因此最大值为 4。" },
  ],
  "英语语法": [
    { stem: "If I ___ you, I would take the opportunity.", answer: "were", explanation: "与现在事实相反的虚拟条件句中，be 动词通常使用 were。" },
    { stem: "She ___ the report before the meeting started.", answer: "had finished", explanation: "会议开始前已经完成，过去的过去使用过去完成时。" },
    { stem: "Neither the teacher nor the students ___ late.", answer: "were", explanation: "就近原则下，谓语与 students 保持复数一致。" },
  ],
  "物理力学": [
    { stem: "物体质量为 2kg，受到 6N 合力，加速度是多少？", answer: "3m/s²", explanation: "根据 F = ma，a = 6 ÷ 2 = 3m/s²。" },
    { stem: "质量为 5kg 的物体以 2m/s² 加速，合力是多少？", answer: "10N", explanation: "根据 F = ma，F = 5 × 2 = 10N。" },
    { stem: "物体受到 12N 合力并产生 4m/s² 加速度，质量是多少？", answer: "3kg", explanation: "由 m = F ÷ a，m = 12 ÷ 4 = 3kg。" },
  ],
  default: [
    { stem: "已知一个量增加 20% 后为 36，原来的量是多少？", answer: "30", explanation: "设原量为 x，则 1.2x = 36，解得 x = 30。" },
    { stem: "某数减少 25% 后为 45，原来的数是多少？", answer: "60", explanation: "设原数为 x，则 0.75x = 45，解得 x = 60。" },
    { stem: "一件商品打八折后为 96 元，原价是多少？", answer: "120 元", explanation: "设原价为 x，则 0.8x = 96，解得 x = 120。" },
  ],
};

function uid() { return Math.random().toString(36).slice(2, 9); }

type DraftQuestion = {
  stem: string;
  answer: string;
  explanation: string;
  type: string;
  photo: string;
  photoHint: string;
};

const superscripts: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  "n": "ⁿ",
  "i": "ⁱ",
};

function toSuperscript(value: string) {
  return value.replace(/\^(\d+|[+-=()ni])/g, (_, token: string) => token.split("").map((char) => superscripts[char] ?? char).join(""));
}

function formatMathText(value: string) {
  if (!value) return value;
  const text = sanitizeAIText(value)
    .replace(/\\,|\\;|\\:/g, " ")
    .replace(/\^\{([^{}]+)\}/g, (_, token: string) => `^(${token})`)
    .replace(/\bf\s*'\s*x\b/g, "f'(x)")
    .replace(/\bfx\b/g, "f(x)")
    .replace(/\bf(\d+(?:\.\d+)?)\b/g, "f($1)");

  return toSuperscript(text).replace(/\s+([,，。；;])/g, "$1").trim();
}

function formatReviewDate(value?: string) {
  if (!value) return "尚未安排";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未安排";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  return date.toDateString() === today.toDateString() ? "今天" : formatReviewDate(value);
}

function sourceLabel(source?: WrongQuestion["source"]) {
  if (source === "ai") return "AI 生成";
  if (source === "bank") return "题库抽取";
  return "手动录入";
}

export default function Home() {
  const [notebooks, setNotebooks] = useState<Notebook[]>(starterNotebooks);
  const [activeId, setActiveId] = useState("math");
  const [selectedId, setSelectedId] = useState("q-1");
  const [view, setView] = useState<"review" | "add">("review");
  const [answerInput, setAnswerInput] = useState("");
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [answerCorrect, setAnswerCorrect] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiReady, setAiReady] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoadError, setAiLoadError] = useState("");
  const [aiHistory, setAiHistory] = useState<LocalAIMessage[]>([]);
  const [showAiHistory, setShowAiHistory] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiClearing, setAiClearing] = useState(false);
  const [aiWasCleared, setAiWasCleared] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState(0);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [aiUpgraded, setAiUpgraded] = useState(false);
  const [restoreUpgrade, setRestoreUpgrade] = useState(false);
  const [aiRetryAttempt, setAiRetryAttempt] = useState(0);
  const [aiLoadRequested, setAiLoadRequested] = useState(false);
  const [aiCompatible, setAiCompatible] = useState<boolean | null>(null);
  const [aiProgressText, setAiProgressText] = useState("");
  const [draggedQuestionId, setDraggedQuestionId] = useState("");
  const [query, setQuery] = useState("");
  const [newBook, setNewBook] = useState("");
  const [draft, setDraft] = useState<DraftQuestion>({ stem: "", answer: "", explanation: "", type: "", photo: "", photoHint: "" });
  const [draftUsedAI, setDraftUsedAI] = useState(false);
  const [toast, setToast] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState("");
  const [lastDeleted, setLastDeleted] = useState<{ bookId: string; question: WrongQuestion; index: number } | null>(null);
  const [reviewTodayOnly, setReviewTodayOnly] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"subjects" | "settings" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoProgress, setPhotoProgress] = useState(0);
  const [photoFeedback, setPhotoFeedback] = useState("");
  const [importFeedback, setImportFeedback] = useState("");
  const [pendingImport, setPendingImport] = useState<{ notebooks: Notebook[]; fileName: string } | null>(null);
  const [searchShortcut, setSearchShortcut] = useState("⌘ / Ctrl K");
  const importInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const upgradeRestoreStartedRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem("wrongbook-data");
      if (saved) {
        try {
          const migrated = enforceLatestPhoto(migrateNotebooks(JSON.parse(saved)));
          if (migrated.length) {
            setNotebooks(migrated);
            setActiveId(migrated[0].id);
            setSelectedId(migrated[0].questions[0]?.id ?? "");
          }
        } catch { localStorage.removeItem("wrongbook-data"); }
      }
      const savedAiHistory = localStorage.getItem("wrongbook-ai-history");
      if (savedAiHistory) {
        try {
          const parsed = JSON.parse(savedAiHistory) as LocalAIMessage[];
          setAiHistory(parsed.slice(-20).map((message) => ({
            ...message,
            content: message.role === "assistant" ? sanitizeAIText(message.content) : message.content,
          })));
        } catch { localStorage.removeItem("wrongbook-ai-history"); }
      }
      if (localStorage.getItem("wrongbook-ai-cleared") === "1") setAiWasCleared(true);
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem("wrongbook-data", JSON.stringify(notebooks));
  }, [loaded, notebooks]);

  useEffect(() => {
    if (!aiLoadRequested) return;
    let active = true;

    loadLocalAI((report) => {
      if (!active) return;
      setAiProgress(Math.max(0, Math.min(100, Math.round(report.progress * 100))));
      setAiProgressText(report.text);
    })
      .then(() => {
        if (!active) return;
        setAiProgress(100);
        setAiReady(true);
        setAiWasCleared(false);
        localStorage.removeItem("wrongbook-ai-cleared");
        localStorage.setItem("wrongbook-ai-installed", "1");
        setUpgradeProgress(0);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "模型加载失败，请重试。";
        setAiLoadError(message.includes("WebGPU") ? message : `模型加载失败：${message.slice(0, 90)}`);
      });

    return () => { active = false; };
  }, [aiLoadRequested, aiRetryAttempt]);

  const active = notebooks.find((book) => book.id === activeId) ?? notebooks[0];
  const filtered = useMemo(() => active?.questions.filter((q) => (!reviewTodayOnly || isDueToday(q)) && (q.stem.includes(query) || q.type.includes(query))) ?? [], [active, query, reviewTodayOnly]);
  const selected = reviewTodayOnly ? filtered.find((question) => question.id === selectedId) ?? filtered[0] : active?.questions.find((question) => question.id === selectedId) ?? active?.questions[0];
  const stats = useMemo(() => getReviewStats(notebooks), [notebooks]);
  const activeStats = useMemo(() => getReviewStats(active ? [active] : []), [active]);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const compatible = supportsLocalAI() && window.isSecureContext;
      setAiCompatible(compatible);
      setSearchShortcut(/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘ K" : "Ctrl K");
      if (!compatible) return;
      const cached = await getCachedLocalAIState();
      if (!cached.base && !cached.upgrade) return;
      setRestoreUpgrade(cached.upgrade);
      setAiProgressText("正在从本机缓存恢复 AI…");
      setAiLoadRequested(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!aiReady || !restoreUpgrade || upgradeRestoreStartedRef.current) return;
    upgradeRestoreStartedRef.current = true;
    setUpgradeBusy(true);
    prepareAIUpgrade((report) => setUpgradeProgress(Math.round(report.progress * 100)))
      .then(() => upgradeLocalAI())
      .then(() => {
        setUpgradeProgress(100);
        setAiUpgraded(true);
        localStorage.setItem("wrongbook-ai-upgraded", "1");
      })
      .catch(() => {
        setUpgradeProgress(-1);
        setRestoreUpgrade(false);
      })
      .finally(() => setUpgradeBusy(false));
  }, [aiReady, restoreUpgrade]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || event.altKey || window.matchMedia("(max-width: 650px)").matches) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnswerSubmitted(false);
      setAnswerInput("");
      setAnswerCorrect(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selected?.id]);

  function notify(message: string) {
    if (!message.includes("可撤销")) setLastDeleted(null);
    setToast(message);
    window.setTimeout(() => {
      setToast("");
      if (message.includes("可撤销")) setLastDeleted(null);
    }, message.includes("可撤销") ? 4500 : 2200);
  }

  function startAiLoad() {
    setAiReady(false);
    setAiProgress(0);
    setAiProgressText("正在准备下载…");
    if (!supportsLocalAI() || !window.isSecureContext) {
      setAiLoadRequested(false);
      setAiLoadError("当前浏览器不支持 WebGPU，或页面未使用安全连接。请更新 Safari/Chrome 后重试。");
      return;
    }
    setAiLoadRequested(true);
    setAiLoadError("");
  }

  function retryAiLoad() {
    startAiLoad();
    setAiRetryAttempt((value) => value + 1);
  }

  async function clearAiModel() {
    if (aiClearing || !window.confirm("删除本机 AI 模型吗？错题和聊天记录不会受影响。")) return;
    setAiClearing(true);
    try {
      await clearLocalAI();
      setAiReady(false);
      setAiLoadRequested(false);
      setAiLoadError("");
      setAiWasCleared(true);
      localStorage.setItem("wrongbook-ai-cleared", "1");
      localStorage.removeItem("wrongbook-ai-installed");
      localStorage.removeItem("wrongbook-ai-upgraded");
      setRestoreUpgrade(false);
      upgradeRestoreStartedRef.current = false;
      setAiProgress(0);
      setUpgradeProgress(0);
      setAiUpgraded(false);
      notify("本机 AI 已清理，需要时会重新安装。");
    } catch {
      notify("清理未完成，请关闭其他打开的网站页面后重试。");
    } finally {
      setAiClearing(false);
    }
  }

  async function upgradeAiModel() {
    if (upgradeBusy || aiUpgraded) return;
    setUpgradeBusy(true);
    try {
      await prepareAIUpgrade((report) => setUpgradeProgress(Math.round(report.progress * 100)));
      await upgradeLocalAI();
      setUpgradeProgress(100);
      setAiUpgraded(true);
      localStorage.setItem("wrongbook-ai-upgraded", "1");
      notify("已升级，之前的对话已保留。");
    } catch {
      setUpgradeProgress(-1);
      notify("升级未完成，请稍后再试。");
    } finally {
      setUpgradeBusy(false);
    }
  }

  async function runAiSearch() {
    if (!aiReady || !aiQuery.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      const question = aiQuery.trim();
      const answer = await askLocalAI(question, aiHistory);
      const userMessage: LocalAIMessage = { role: "user", content: question };
      const assistantMessage: LocalAIMessage = { role: "assistant", content: answer };
      const nextHistory: LocalAIMessage[] = [...aiHistory, userMessage, assistantMessage].slice(-20);
      setAiHistory(nextHistory);
      localStorage.setItem("wrongbook-ai-history", JSON.stringify(nextHistory));
      setAiQuery("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "回答生成失败，请稍后重试。");
    } finally {
      setAiBusy(false);
    }
  }

  function openAddView() {
    if (aiWasCleared && !aiReady) {
      const shouldDownload = window.confirm("本机 AI 已清理，要现在重新下载吗？");
      if (shouldDownload) startAiLoad();
    }
    setEditingQuestionId("");
    setDraftUsedAI(false);
    setDraft({ stem: "", answer: "", explanation: "", type: "", photo: "", photoHint: "" });
    setPhotoFeedback("");
    if (photoInputRef.current) photoInputRef.current.value = "";
    setView("add");
  }

  async function handlePhotoUpload(file?: File) {
    if (!file || photoBusy) return;
    const replacing = Boolean(draft.photo);
    setPhotoBusy(true);
    setPhotoProgress(0);
    setPhotoFeedback("正在压缩图片…");
    try {
      const compressed = await compressImage(file);
      const baseDraft = { ...draft, photo: compressed.dataUrl, photoHint: draft.photoHint || file.name };
      setDraft(baseDraft);
      setPhotoFeedback("图片已保存，正在本机识别文字…");
      const recognizedText = await recognizeWrongQuestionImage(compressed.dataUrl, (report) => {
        setPhotoProgress(Math.round(report.progress * 100));
        setPhotoFeedback(`${report.text} ${Math.round(report.progress * 100)}%`);
      });
      const recognizedDraft = { ...baseDraft, stem: baseDraft.stem || recognizedText };
      setDraft(recognizedDraft);

      if (!supportsLocalAI() || !window.isSecureContext) {
        setPhotoFeedback("文字已填入题目；当前浏览器无法运行离线 AI，请手动核对其余内容。");
        return;
      }

      setAiLoadRequested(true);
      setAiLoadError("");
      setPhotoFeedback("文字识别完成，正在准备离线 AI 自动补全…");
      await loadLocalAI((report) => {
        setAiProgress(Math.round(report.progress * 100));
        setAiProgressText(report.text);
        setPhotoFeedback(`正在准备离线 AI… ${Math.round(report.progress * 100)}%`);
      });
      setAiReady(true);
      localStorage.setItem("wrongbook-ai-installed", "1");
      const raw = await askLocalAI(buildQuestionAutofillPrompt({ ...recognizedDraft, recognizedText }), aiHistory, { raw: true });
      const filled = parseQuestionAutofill(raw);
      setDraft((current) => ({
        ...current,
        stem: filled.stem || recognizedDraft.stem,
        type: filled.type || recognizedDraft.type,
        answer: filled.answer || recognizedDraft.answer,
        explanation: filled.explanation || recognizedDraft.explanation,
      }));
      setDraftUsedAI(true);
      setPhotoProgress(100);
      setPhotoFeedback(`${replacing ? "新图已替换旧图" : "照片已识别"}，题目、题型、答案和解析已自动填写，请核对。`);
    } catch (error) {
      setPhotoFeedback(error instanceof Error ? `${error.message} 已保留图片和已识别内容。` : "自动识别失败，已保留图片和已有内容。");
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  function removeDraftPhoto() {
    setDraft((current) => ({ ...current, photo: "", photoHint: "" }));
    setPhotoFeedback("图片已移除");
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function fillDraftWithAI() {
    if (!aiReady) {
      notify("本机 AI 还没准备好");
      return;
    }
    const prompt = buildQuestionAutofillPrompt(draft);
    setAiBusy(true);
    try {
      const raw = await askLocalAI(prompt, aiHistory, { raw: true });
      const parsed = parseQuestionAutofill(raw);
      setDraft((current) => ({
        stem: parsed.stem?.trim() || current.stem,
        type: parsed.type?.trim() || current.type,
        answer: parsed.answer?.trim() || current.answer,
        explanation: parsed.explanation?.trim() || current.explanation,
        photo: current.photo,
        photoHint: current.photoHint,
      }));
      setDraftUsedAI(true);
      notify("已自动补全");
    } catch {
      notify("自动补全失败，请手动填写");
    } finally {
      setAiBusy(false);
    }
  }

  function createNotebook() {
    if (!newBook.trim()) return;
    const book: Notebook = { id: uid(), name: newBook.trim(), color: "blue", questions: [] };
    setNotebooks((books) => [...books, book]); setActiveId(book.id); setNewBook(""); notify("题库已创建");
  }

  function selectNotebook(book: Notebook) {
    setActiveId(book.id);
    setSelectedId(book.questions[0]?.id || "");
    setView("review");
    setReviewTodayOnly(false);
    setMobilePanel(null);
  }

  function renameNotebook(id: string) {
    const current = notebooks.find((book) => book.id === id);
    if (!current) return;
    const name = window.prompt("输入新的题库名称", current.name)?.trim();
    if (!name) return;
    setNotebooks((books) => books.map((book) => book.id === id ? { ...book, name } : book));
    notify("题库已重命名");
  }

  function deleteNotebook(id: string) {
    if (notebooks.length === 1) { notify("至少保留一个题库"); return; }
    const current = notebooks.find((book) => book.id === id);
    if (!current || !window.confirm(`确定删除“${current.name}”吗？其中的错题也会删除。`)) return;
    const remaining = notebooks.filter((book) => book.id !== id);
    setNotebooks(remaining);
    if (activeId === id) {
      setActiveId(remaining[0].id);
      setSelectedId(remaining[0].questions[0]?.id || "");
    }
    notify("题库已删除");
  }

  async function addQuestion() {
    const needsFill = !draft.stem.trim() || !draft.answer.trim() || !draft.explanation.trim() || !draft.type.trim();
    let nextDraft = { ...draft };
    let usedAI = false;
    if (needsFill) {
      if (!aiReady) {
        notify("有空项，先补齐参数或重新下载本机 AI");
        return;
      }
      try {
        setAiBusy(true);
        const raw = await askLocalAI(buildQuestionAutofillPrompt(draft), aiHistory, { raw: true });
        const parsed = parseQuestionAutofill(raw);
        nextDraft = {
          stem: parsed.stem?.trim() || draft.stem,
          type: parsed.type?.trim() || draft.type,
          answer: parsed.answer?.trim() || draft.answer,
          explanation: parsed.explanation?.trim() || draft.explanation,
          photo: draft.photo,
          photoHint: draft.photoHint,
        };
        usedAI = true;
        setDraft(nextDraft);
        notify("已自动补全");
      } catch {
        notify("自动补全失败，请手动填写");
        return;
      } finally {
        setAiBusy(false);
      }
    }
    if (!nextDraft.stem.trim() || !nextDraft.answer.trim() || !nextDraft.explanation.trim() || !nextDraft.type.trim()) {
      notify("有空项，先补齐参数");
      return;
    }
    if (editingQuestionId) {
      setNotebooks((books) => enforceLatestPhoto(books.map((book) => book.id === activeId ? { ...book, questions: book.questions.map((question) => question.id === editingQuestionId ? { ...question, stem: nextDraft.stem.trim(), answer: nextDraft.answer.trim(), explanation: nextDraft.explanation.trim(), type: nextDraft.type.trim(), photo: nextDraft.photo || undefined, source: usedAI || draftUsedAI ? "ai" : question.source } : question) } : book), nextDraft.photo ? { notebookId: activeId, questionId: editingQuestionId } : undefined));
      setSelectedId(editingQuestionId);
      setEditingQuestionId("");
      setDraft({ stem: "", answer: "", explanation: "", type: "", photo: "", photoHint: "" });
      setDraftUsedAI(false);
      setView("review");
      notify("错题已更新");
      return;
    }
    const question: WrongQuestion = { stem: nextDraft.stem.trim(), answer: nextDraft.answer.trim(), explanation: nextDraft.explanation.trim(), type: nextDraft.type.trim(), ...(nextDraft.photo ? { photo: nextDraft.photo } : {}), id: uid(), createdAt: new Date().toISOString(), mastered: false, source: usedAI || draftUsedAI ? "ai" : "manual", attempts: 0, correctAttempts: 0, mastery: 0 };
    setNotebooks((books) => enforceLatestPhoto(books.map((book) => book.id === activeId ? { ...book, questions: [question, ...book.questions] } : book), question.photo ? { notebookId: activeId, questionId: question.id } : undefined));
    setSelectedId(question.id); setDraft({ stem: "", answer: "", explanation: "", type: "", photo: "", photoHint: "" }); setDraftUsedAI(false); setView("review"); notify("错题已保存");
  }

  function openEditQuestion() {
    if (!selected) return;
    setEditingQuestionId(selected.id);
    setDraft({ stem: selected.stem, answer: selected.answer, explanation: selected.explanation, type: selected.type, photo: selected.photo || "", photoHint: "" });
    setView("add");
  }

  function deleteQuestion() {
    if (!selected || !window.confirm("确定删除这道错题吗？")) return;
    const index = active.questions.findIndex((question) => question.id === selected.id);
    setLastDeleted({ bookId: activeId, question: selected, index: Math.max(0, index) });
    const remaining = active.questions.filter((question) => question.id !== selected.id);
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: remaining } : book));
    setSelectedId(remaining[0]?.id || "");
    notify("错题已删除，可撤销");
  }

  function undoDelete() {
    if (!lastDeleted) return;
    if (!notebooks.some((book) => book.id === lastDeleted.bookId)) { setLastDeleted(null); setToast(""); return; }
    setNotebooks((books) => books.map((book) => {
      if (book.id !== lastDeleted.bookId || book.questions.some((question) => question.id === lastDeleted.question.id)) return book;
      const questions = [...book.questions];
      questions.splice(Math.min(lastDeleted.index, questions.length), 0, lastDeleted.question);
      return { ...book, questions };
    }));
    setActiveId(lastDeleted.bookId);
    setSelectedId(lastDeleted.question.id);
    setLastDeleted(null);
    setToast("");
  }

  function reorderQuestion(targetId: string) {
    if (!active || !draggedQuestionId || draggedQuestionId === targetId) return;
    const from = active.questions.findIndex((question) => question.id === draggedQuestionId);
    const to = active.questions.findIndex((question) => question.id === targetId);
    if (from < 0 || to < 0) return;
    const questions = [...active.questions];
    const [moved] = questions.splice(from, 1);
    questions.splice(to, 0, moved);
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions } : book));
    setDraggedQuestionId("");
  }

  function generatePractice() {
    const templates = generated[selected?.type || ""] || generated.default;
    const practices: WrongQuestion[] = templates.map((template) => ({ ...template, id: uid(), type: selected?.type || "综合", createdAt: new Date().toISOString(), mastered: false, source: "bank", attempts: 0, correctAttempts: 0, mastery: 0 }));
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: [...practices, ...book.questions] } : book));
    setSelectedId(practices[0].id); notify("已从题库抽取 3 道同类题");
  }

  function generateOnePractice() {
    const templates = generated[selected?.type || ""] || generated.default;
    const template = templates[Math.floor(Math.random() * templates.length)];
    const practice: WrongQuestion = { ...template, id: uid(), type: selected?.type || "综合", createdAt: new Date().toISOString(), mastered: false, source: "bank", attempts: 0, correctAttempts: 0, mastery: 0 };
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: [practice, ...book.questions] } : book));
    setSelectedId(practice.id);
    notify("答错了，已从题库追加一道同类题");
  }

  async function generateAiPractice() {
    if (!selected) return;
    if (!aiReady) { startAiLoad(); notify("请先加载本机 AI"); return; }
    setAiBusy(true);
    try {
      const raw = await askLocalAI(`根据这道错题生成 3 道同类型但数值不同的练习题，只输出 JSON 数组，每项包含 stem、answer、explanation、type。不要 LaTeX。原题：${selected.stem}；答案：${selected.answer}；类型：${selected.type}`, aiHistory, { raw: true });
      const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```$/, "").trim()) as Array<Partial<WrongQuestion>>;
      const practices: WrongQuestion[] = parsed.slice(0, 3).filter((item) => item.stem && item.answer).map((item) => ({ id: uid(), stem: String(item.stem), answer: String(item.answer), explanation: String(item.explanation || "请根据同类题方法完成。"), type: String(item.type || selected.type), createdAt: new Date().toISOString(), mastered: false, source: "ai", attempts: 0, correctAttempts: 0, mastery: 0 }));
      if (!practices.length) throw new Error("没有有效题目");
      setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: [...practices, ...book.questions] } : book));
      setSelectedId(practices[0].id);
      notify(`AI 已生成 ${practices.length} 道同类题`);
    } catch {
      notify("AI 生成失败，可改用题库抽取");
    } finally {
      setAiBusy(false);
    }
  }

  function submitAnswer() {
    if (!selected || !answerInput.trim()) { notify("请先输入答案"); return; }
    const acceptedAnswers = [selected.answer, ...(selected.acceptedAnswers || [])];
    const correct = isAnswerCorrect(answerInput, acceptedAnswers, { absoluteTolerance: 1e-4, relativeTolerance: 1e-4 });
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: book.questions.map((question) => question.id === selected.id ? { ...recordReview(question, correct), mastered: correct ? question.mastered : false } : question) } : book));
    setAnswerCorrect(correct); setAnswerSubmitted(true);
    if (correct) notify("回答正确，可以标记为已掌握");
    else generateOnePractice();
  }

  function markMasteredAndMaybeDelete() {
    if (!selected) return;
    if (window.confirm("答对了。要删除这道错题吗？点击“取消”则移入已掌握。")) {
      deleteQuestion();
      return;
    }
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: book.questions.map((q) => q.id === selected.id ? { ...q, mastered: true, mastery: 100, nextReviewAt: calculateNextReviewAt(100) } : q) } : book));
    notify("已移入已掌握");
  }

  function toggleQuestionMastered(id: string) {
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: book.questions.map((q) => {
      if (q.id !== id) return q;
      const mastered = !q.mastered;
      return { ...q, mastered, mastery: mastered ? 100 : calculateMastery(q.attempts, q.correctAttempts), nextReviewAt: mastered ? calculateNextReviewAt(100) : new Date().toISOString() };
    }) } : book));
  }

  function exportData() {
    const blob = new Blob([exportWrongbookJSON(notebooks)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `错题本备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("备份已导出");
  }

  async function importData(file?: File) {
    if (!file) return;
    setImportFeedback("");
    try {
      if (file.size > 10 * 1024 * 1024) { setImportFeedback("导入失败：JSON 文件超过 10MB。"); return; }
      const result = importWrongbookJSON(await file.text());
      if (!result.ok) { setImportFeedback(`导入失败：${result.error}`); notify(`导入失败：${result.error}`); return; }
      setPendingImport({ notebooks: result.notebooks, fileName: file.name });
      setMobilePanel(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "请检查 JSON 文件";
      setImportFeedback(`导入失败：${message}`);
      notify(`导入失败：${message}`);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function applyImport(mode: "merge" | "replace") {
    if (!pendingImport) return;
    const next = enforceLatestPhoto(mode === "merge" ? mergeNotebooks(notebooks, pendingImport.notebooks) : pendingImport.notebooks);
    setNotebooks(next);
    setActiveId(next[0].id);
    setSelectedId(next[0].questions[0]?.id || "");
    setView("review");
    setReviewTodayOnly(false);
    setPendingImport(null);
    setImportFeedback(mode === "merge" ? "导入成功：已与现有数据合并。" : "导入成功：已用备份覆盖现有数据。");
    notify(mode === "merge" ? "JSON 已合并导入" : "JSON 已覆盖导入");
  }

  function resetData() {
    if (!window.confirm("确定清空本机数据并恢复示例题库吗？")) return;
    setNotebooks(migrateNotebooks(starterNotebooks));
    setActiveId("math");
    setSelectedId("q-1");
    notify("已恢复初始数据");
  }

  function renderAnswerPanel() {
    if (!selected) return null;
    if (!answerSubmitted) return <div className="answer-block"><div className="answer-head"><span>先写下你的答案</span><span>提交后揭晓</span></div><div className="answer-entry"><input value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAnswer()} placeholder="输入你的答案…" /><button onClick={submitAnswer}>提交答案</button></div></div>;
    return <><div className="answer-block"><div className="answer-head"><span>正确答案</span><span className={answerCorrect ? "result-correct" : "result-wrong"}>{answerCorrect ? "回答正确" : "回答错误"}</span></div><div className="answer-value">{formatMathText(selected.answer || "尚未填写答案")}</div></div><div className="explanation"><div className="explain-icon">✦</div><div><span>解析与方法</span><p>{formatMathText(selected.explanation || "尚未填写解析。")}</p></div></div><div className="detail-actions">{answerCorrect ? <button className="master-button" onClick={markMasteredAndMaybeDelete}>删除或移入已掌握</button> : <button className="generate-button" onClick={generateOnePractice}><span>✦</span> 再生成 1 道同类题</button>}</div></>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">错</div><div><strong>错题本</strong><span>Learning workspace</span></div></div>
        <div className="side-label">工作台</div>
        <button className="side-link active"><span>⌂</span>总览 <em>{notebooks.reduce((n, b) => n + b.questions.length, 0)}</em></button>
        <button className="side-link" onClick={openAddView}><span>＋</span>录入新错题</button>
        <div className="side-label library-label">我的题库 <button className="mini-add" aria-label="新建题库" onClick={() => document.getElementById("new-book")?.focus()}>＋</button></div>
        <div className="book-list">
          {notebooks.map((book) => (
            <div className={`book-item ${book.id === activeId ? "selected" : ""}`} key={book.id}>
                <button className="book-link" onClick={() => selectNotebook(book)}>
                <i className={`dot ${book.color}`} />
                <span>{book.name}</span>
                <em>{book.questions.length}</em>
              </button>
              <div className="book-actions">
                <button aria-label={`重命名${book.name}`} title="重命名" onClick={() => renameNotebook(book.id)}>✎</button>
                <button aria-label={`删除${book.name}`} title="删除" onClick={() => deleteNotebook(book.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
        <div className="new-book"><input id="new-book" value={newBook} onChange={(e) => setNewBook(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNotebook()} placeholder="新建题库…" /><button onClick={createNotebook}>创建</button></div>
        <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importData(event.target.files?.[0])} />
        <div className="data-actions"><button onClick={() => importInputRef.current?.click()}>导入 JSON</button><button onClick={exportData}>导出 JSON</button><button onClick={resetData}>清空数据</button></div>
        <div className="sidebar-foot"><span className="status-dot" />本地模式 · 数据保存在此设备</div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb">我的题库 <span>/</span> <strong>{active?.name || "未命名题库"}</strong></div><div className="top-actions"><label className="search"><span>⌕</span><input ref={searchInputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索错题或知识点" /><kbd>{searchShortcut}</kbd></label><button className="icon-button" aria-label="通知">♧</button><button className="avatar">学</button></div></header>
        <div className="content">
          <div className="page-heading"><div><p className="eyebrow">学习进度 <span>·</span> {active?.name}</p><h1>把错题变成<br /><i>下一次的得分</i></h1><p className="subheading">理解错误、掌握方法，再用三道新题确认真的学会。</p></div><div className="progress-card"><div className="ring"><span>{activeStats.mastery}</span><small>%</small></div><div><strong>掌握度</strong><span>{activeStats.correctAttempts} 次答对 · {activeStats.attempts} 次作答</span></div></div></div>
          <div className="review-summary"><button className="review-stat" onClick={() => { setView("review"); setReviewTodayOnly(true); }}><strong>{activeStats.dueToday}</strong><span>今日复习</span></button><div className="review-stat"><strong>{activeStats.attempts}</strong><span>答题次数</span></div><div className="review-stat"><strong>{activeStats.mastery}%</strong><span>掌握度</span></div><div className="review-stat"><strong>{stats.totalQuestions}</strong><span>全部错题</span></div></div>
          <div className="tabs"><button className={view === "review" && !reviewTodayOnly ? "tab active" : "tab"} onClick={() => { setView("review"); setReviewTodayOnly(false); }}>错题复盘 <span>{active?.questions.length || 0}</span></button><button className={view === "review" && reviewTodayOnly ? "tab active" : "tab"} onClick={() => { setView("review"); setReviewTodayOnly(true); }}>今日复习 <span>{activeStats.dueToday}</span></button><button className={view === "add" ? "tab active" : "tab"} onClick={openAddView}>＋ 录入错题</button><button className={`ai-tab ${aiReady ? "ready" : ""}`} onClick={() => { if (!aiReady) startAiLoad(); window.setTimeout(() => document.getElementById(aiReady ? "ai-search" : "ai-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }}>✦ AI 搜索</button></div>
          <section id="ai-card" className={`ai-search-card ${aiReady ? "ready" : aiLoadError ? "error" : aiLoadRequested ? "loading" : "idle"}`}>
            <div className="ai-search-head"><div><span className="ai-kicker">本机 AI · 点击加载</span><strong>{aiReady ? "问问你的错题助手" : aiLoadError ? "AI 模型未能加载" : aiLoadRequested ? "正在加载 AI 模型" : "需要时再启用，不占用启动流量"}</strong></div><span className="ai-status">{aiReady ? "已就绪" : aiLoadError ? "加载失败" : aiLoadRequested ? `${aiProgress}%` : "未加载"}</span></div>
            {!aiLoadRequested && !aiReady ? <div className="ai-idle"><div className={`ai-compatibility ${aiCompatible === null ? "checking" : aiCompatible ? "compatible" : "incompatible"}`}><strong>{aiCompatible === null ? "正在检查浏览器兼容性" : aiCompatible ? "此浏览器支持本机 AI" : "当前浏览器不支持本机 AI"}</strong><span>{aiCompatible === null ? "检查 WebGPU 和安全连接…" : aiCompatible ? "支持 WebGPU 且处于安全连接；模型只保存在本机浏览器。" : "需要支持 WebGPU 的新版 Safari 或 Chrome，并使用 HTTPS。"}</span></div><button className="ai-load-button" disabled={aiCompatible !== true} onClick={startAiLoad}>下载并启用 AI</button></div> : <><div className="ai-progress-track" role="progressbar" aria-label="AI 模型加载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={aiProgress}><div className="ai-progress-fill" style={{ width: `${aiProgress}%` }} /></div>{!aiReady && aiProgressText ? <div className="ai-progress-text">{aiProgressText}</div> : null}</>}
            {aiLoadError ? <div className="ai-error" role="alert"><span>{aiLoadError}</span><button onClick={retryAiLoad}>重新加载</button></div> : null}
          {aiReady ? <><div className="ai-memory-note">已记住最近 10 轮对话，超过后自动删除最早一轮 <button className="ai-clear" disabled={aiClearing} onClick={clearAiModel}>{aiClearing ? "正在清理…" : "清理本机 AI"}</button></div><div className={`ai-upgrade ${upgradeBusy ? "loading" : ""}`}><span>{aiUpgraded ? "已使用增强版本地 AI" : upgradeBusy ? `正在下载增强版本地 AI… ${Math.max(0, upgradeProgress)}%` : upgradeProgress < 0 ? "增强版本地 AI 升级失败，可重试" : "需要更强能力时可升级为增强版本地 AI"}</span>{!aiUpgraded ? <button onClick={upgradeAiModel} disabled={upgradeBusy}>{upgradeBusy ? "升级中…" : upgradeProgress < 0 ? "重新升级" : "下载并升级"}</button> : null}</div><p className="ai-warning">AI 内容可能有误，请核对答案和解析。</p><div className="ai-search-row"><input id="ai-search" value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAiSearch()} placeholder="输入知识点或学习问题…" /><button disabled={!aiQuery.trim() || aiBusy} onClick={runAiSearch}>{aiBusy ? "思考中…" : "搜索"}</button></div>{aiBusy ? <div className="ai-answer" aria-live="polite">正在本机生成回答…</div> : null}{!aiBusy && !aiHistory.length ? <div className="ai-empty">AI 已就绪。输入知识点或一道题开始提问。</div> : null}{aiHistory.length ? <><div className="ai-chat-history" aria-live="polite">{(showAiHistory ? aiHistory : aiHistory.slice(-2)).map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "user" ? "你" : "学习助手"}</span><p>{formatMathText(message.content)}</p></div>)}</div>{aiHistory.length > 2 ? <button className="ai-history-toggle" onClick={() => setShowAiHistory((value) => !value)}>{showAiHistory ? "收起前九轮" : "显示前九轮对话"}</button> : null}</> : null}</> : null}
          </section>

          {view === "add" ? (
            <section className="add-card">
              <div className="card-title"><div><p className="eyebrow">{editingQuestionId ? "编辑错题" : "记录一次错误"}</p><h2>{editingQuestionId ? "修改题目内容" : "把题目放进来"}</h2></div><span className="step-badge">保存到「{active?.name}」</span></div>
              <label>拍照识别并自动填写（本机处理，原图最大 12MB）<input ref={photoInputRef} className="photo-input" type="file" accept="image/*" capture="environment" disabled={photoBusy} onChange={(e) => void handlePhotoUpload(e.target.files?.[0])} /></label>
              {photoFeedback ? <div className={`photo-feedback ${photoFeedback.includes("失败") || photoFeedback.includes("超过") || photoFeedback.includes("无法") ? "error" : ""}`} role="status">{photoFeedback}</div> : null}
              {photoBusy ? <div className="photo-recognition-progress" role="progressbar" aria-label="照片识别进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={photoProgress}><span style={{ width: `${photoProgress}%` }} /></div> : null}
              {draft.photo ? <div className="photo-preview editing"><img src={draft.photo} alt="错题照片预览" /><div className="photo-actions"><button onClick={() => photoInputRef.current?.click()} disabled={photoBusy}>{photoBusy ? "处理中…" : "替换图片"}</button><button className="danger" onClick={removeDraftPhoto}>删除图片</button></div></div> : photoBusy ? <div className="photo-loading" aria-live="polite">正在读取并压缩图片，请稍候…</div> : null}
              <div className="form-grid"><label>题型 / 知识点<input value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} placeholder="例如：二次函数" /></label><label>拍照参数 / 识别备注<input value={draft.photoHint} onChange={(e) => setDraft({ ...draft, photoHint: e.target.value })} placeholder="例如：第 3 题、求导题、选择题" /></label></div>
              <div className="form-grid"><label>题目内容<textarea value={draft.stem} onChange={(e) => setDraft({ ...draft, stem: e.target.value })} placeholder="输入题目内容" /></label><label>正确答案（多个答案可用 | 或换行）<textarea className="short" value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder="例如：0.5 | 1/2" /></label></div>
              <label>解析与反思<textarea className="short" value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} placeholder="写下解法、错误原因或让本机 AI 补全" /></label>
              <div className="form-actions"><button className="ghost" onClick={() => { setEditingQuestionId(""); setDraftUsedAI(false); setView("review"); }}>取消</button><button className="ghost" onClick={() => { if (aiReady) void fillDraftWithAI(); else startAiLoad(); }}>{aiBusy ? "补全中…" : aiReady ? "AI 自动补全" : "加载 AI 后补全"}</button><button className="primary" onClick={() => void addQuestion()}>{editingQuestionId ? "保存修改" : "保存这道错题"} <span>→</span></button></div>
            </section>
          ) : (
            <div className="review-grid">
              <div className="question-list">
                <div className="list-head"><div><h2>{reviewTodayOnly ? "今日复习" : "待复盘题目"}</h2><p>长按或拖动题目可调整顺序</p></div><span className="count-pill">{filtered.length} 道</span></div>
                {filtered.length ? filtered.map((question) => (
                  <div className={`question-row ${question.id === selected?.id ? "current" : ""} ${question.id === draggedQuestionId ? "dragging" : ""}`} key={question.id} role="button" tabIndex={0} draggable onDragStart={() => setDraggedQuestionId(question.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => reorderQuestion(question.id)} onDragEnd={() => setDraggedQuestionId("")} onClick={() => setSelectedId(question.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(question.id); } }}>
                    <div className="row-index">{question.mastered ? "✓" : "0" + (active?.questions.indexOf(question) + 1)}</div>
                    <div className="row-copy"><strong>{formatMathText(question.stem)}</strong><div className="question-meta"><span>{question.type || "未分类"} · {formatCreatedAt(question.createdAt)}</span><span className={`source-badge ${question.source || "manual"}`}>{sourceLabel(question.source)}</span><span>下次 {formatReviewDate(question.nextReviewAt)}</span></div></div>
                    <button className="row-menu" title={question.mastered ? "标记为未掌握" : "标记为已掌握"} aria-label={question.mastered ? "标记为未掌握" : "标记为已掌握"} onClick={(e) => { e.stopPropagation(); toggleQuestionMastered(question.id); }}>⠿</button>
                  </div>
                )) : <div className="empty-state"><strong>{query ? "没有找到匹配的错题" : reviewTodayOnly ? "今天的复习已完成" : "这里还没有错题"}</strong><span>{query ? "换个关键词，或清空搜索后再试。" : reviewTodayOnly ? "可以继续复盘全部错题，保持手感。" : "录入第一道错题后，就能开始复盘。"}</span><button onClick={query ? () => setQuery("") : reviewTodayOnly ? () => setReviewTodayOnly(false) : openAddView}>{query ? "清空搜索" : reviewTodayOnly ? "查看全部错题" : "录入错题"}</button></div>}
              </div>
              <article className="question-detail">{selected ? <><div className="detail-top"><div><span className={`tag ${selected.mastered ? "done" : ""}`}>{selected.mastered ? "已掌握" : "待复盘"}</span><span className={`source-badge ${selected.source || "manual"}`}>{sourceLabel(selected.source)}</span></div><span className="detail-date">{formatCreatedAt(selected.createdAt)}</span></div><h2>{formatMathText(selected.stem)}</h2><div className="question-meta"><span>答题 {selected.attempts} 次</span><span>掌握度 {getQuestionMastery(selected)}%</span><span>下次复习 {formatReviewDate(selected.nextReviewAt)}</span></div>{selected.photo ? <div className="photo-preview"><img src={selected.photo} alt="错题照片" /></div> : null}{renderAnswerPanel()}</> : <div className="detail-empty"><div>✦</div><h2>选一道题开始复盘</h2><p>每一次理解错误，都会让下一次更稳。</p></div>}</article>
            </div>
          )}
          {view === "review" && selected && <div className="question-tools"><button onClick={openEditQuestion}>编辑错题</button><button onClick={deleteQuestion}>删除当前错题</button></div>}
          {view === "review" && selected && <section className="practice-banner"><div className="practice-shape">✦</div><div><p className="eyebrow">举一反三</p><h2>真的掌握了吗？</h2><p>请选择题目来源，系统会明确标注，避免混淆。</p></div><div className="practice-actions"><button className="primary" onClick={generatePractice}>题库抽取 3 道</button><button className="primary secondary" disabled={aiBusy} onClick={() => void generateAiPractice()}>{aiReady ? "AI 生成 3 道" : "加载 AI 后生成"}</button></div></section>}
        </div>
      </section>
      {mobilePanel ? <button className="mobile-sheet-backdrop" aria-label="关闭面板" onClick={() => setMobilePanel(null)} /> : null}
      {mobilePanel === "subjects" ? <section className="mobile-sheet" aria-label="切换学科"><div className="mobile-sheet-head"><h2>切换学科</h2><button aria-label="关闭" onClick={() => setMobilePanel(null)}>×</button></div><div className="mobile-subject-list">{notebooks.map((book) => <button className={book.id === activeId ? "active" : ""} key={book.id} onClick={() => selectNotebook(book)}><i className={`dot ${book.color}`} /><span>{book.name}</span><em>{book.questions.length}</em></button>)}</div><div className="new-book"><input value={newBook} onChange={(event) => setNewBook(event.target.value)} placeholder="新建题库…" /><button onClick={createNotebook}>创建</button></div></section> : null}
      {mobilePanel === "settings" ? <section className="mobile-sheet" role="dialog" aria-modal="true" aria-label="设置"><div className="mobile-sheet-head"><h2>设置</h2><button aria-label="关闭" onClick={() => setMobilePanel(null)}>×</button></div><div className="mobile-settings-actions"><button onClick={() => importInputRef.current?.click()}>导入 JSON</button><button onClick={exportData}>导出 JSON</button><button onClick={resetData}>恢复初始数据</button>{aiReady ? <button onClick={() => void clearAiModel()}>清理本机 AI</button> : <button disabled={aiCompatible !== true} onClick={startAiLoad}>下载本机 AI</button>}</div>{importFeedback ? <p className={importFeedback.startsWith("导入失败") ? "import-feedback error" : "import-feedback success"}>{importFeedback}</p> : <p>数据保存在当前设备。导入兼容旧版 wrongbook-data。</p>}</section> : null}
      <nav className="mobile-nav" aria-label="手机端主导航"><button onClick={() => setMobilePanel(mobilePanel === "subjects" ? null : "subjects")}><span>▦</span>学科</button><button className={view === "review" ? "active" : ""} onClick={() => { setView("review"); setReviewTodayOnly(false); setMobilePanel(null); }}><span>✓</span>复习</button><button className={view === "add" ? "active" : ""} onClick={openAddView}><span>＋</span>添加</button><button onClick={() => setMobilePanel(mobilePanel === "settings" ? null : "settings")}><span>⚙</span>设置</button></nav>
      {pendingImport ? <><button className="import-backdrop" aria-label="取消导入" onClick={() => setPendingImport(null)} /><section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><span className="dialog-kicker">JSON 导入</span><h2 id="import-title">如何处理这份备份？</h2><p>文件：{pendingImport.fileName}</p><div className="import-summary"><strong>{pendingImport.notebooks.length}</strong><span>个题库</span><strong>{pendingImport.notebooks.reduce((sum, book) => sum + book.questions.length, 0)}</strong><span>道错题</span></div><button className="import-choice primary-choice" onClick={() => applyImport("merge")}><strong>合并到现有数据</strong><span>保留本机内容，自动跳过重复题目</span></button><button className="import-choice danger-choice" onClick={() => applyImport("replace")}><strong>覆盖现有数据</strong><span>删除当前内容并使用这份备份</span></button><button className="dialog-cancel" onClick={() => setPendingImport(null)}>取消</button></section></> : null}
      {toast && <div className="toast">{toast}{lastDeleted ? <button onClick={undoDelete}>撤销</button> : null}</div>}
    </main>
  );
}
