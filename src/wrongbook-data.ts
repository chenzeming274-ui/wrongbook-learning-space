export type QuestionSource = "manual" | "ai" | "bank";

export type WrongQuestion = {
  id: string;
  stem: string;
  answer: string;
  explanation: string;
  type: string;
  createdAt: string;
  mastered: boolean;
  photo?: string;
  source?: QuestionSource;
  acceptedAnswers?: string[];
  attempts: number;
  correctAttempts: number;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  mastery: number;
};

export type Notebook = {
  id: string;
  name: string;
  color: string;
  questions: WrongQuestion[];
};

export type WrongbookExport = {
  version: 2;
  exportedAt: string;
  notebooks: Notebook[];
};

export type TodayReview = {
  notebookId: string;
  notebookName: string;
  question: WrongQuestion;
};

export type ReviewStats = {
  totalQuestions: number;
  dueToday: number;
  attempts: number;
  correctAttempts: number;
  mastery: number;
};

export type ImportResult =
  | { ok: true; notebooks: Notebook[] }
  | { ok: false; error: string };

type UnknownRecord = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function countValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function clampPercent(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function normalizedDateString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const answers = [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  return answers.length ? answers : undefined;
}

function normalizeSource(value: unknown): QuestionSource | undefined {
  return value === "manual" || value === "ai" || value === "bank" ? value : undefined;
}

function fallbackId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function uniqueId(preferred: string, prefix: string, index: number, usedIds: Set<string>) {
  const base = preferred || fallbackId(prefix, index);
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
  usedIds.add(candidate);
  return candidate;
}

/** Convert legacy and current question objects to the current shape. */
export function normalizeQuestion(value: unknown, index = 0): WrongQuestion | null {
  if (!isRecord(value)) return null;

  const stem = stringValue(value.stem).trim();
  const answer = stringValue(value.answer).trim();
  if (!stem || !answer) return null;

  const mastered = booleanValue(value.mastered);
  const attempts = countValue(value.attempts);
  const correctAttempts = Math.min(attempts, countValue(value.correctAttempts));
  const inferredMastery = mastered ? 100 : calculateMastery(attempts, correctAttempts);
  const mastery = mastered ? 100 : clampPercent(value.mastery, inferredMastery);
  const createdAt = normalizedDateString(value.createdAt) ?? new Date().toISOString();
  const lastReviewedAt = normalizedDateString(value.lastReviewedAt);
  const nextReviewAt = normalizedDateString(value.nextReviewAt);

  return {
    id: stringValue(value.id).trim() || fallbackId("question", index),
    stem,
    answer,
    explanation: stringValue(value.explanation),
    type: stringValue(value.type, "综合").trim() || "综合",
    createdAt,
    mastered: mastered || mastery >= 100,
    ...(stringValue(value.photo).trim() ? { photo: stringValue(value.photo) } : {}),
    ...(normalizeSource(value.source) ? { source: normalizeSource(value.source) } : {}),
    ...(uniqueStrings(value.acceptedAnswers) ? { acceptedAnswers: uniqueStrings(value.acceptedAnswers) } : {}),
    attempts,
    correctAttempts,
    ...(lastReviewedAt ? { lastReviewedAt } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    mastery,
  };
}

/** Convert one legacy/current notebook to the current shape. */
export function normalizeNotebook(value: unknown, index = 0): Notebook | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  if (!name) return null;

  const rawQuestions = Array.isArray(value.questions) ? value.questions : [];
  const usedQuestionIds = new Set<string>();
  const questions = rawQuestions
    .map((question, questionIndex) => normalizeQuestion(question, questionIndex))
    .filter((question): question is WrongQuestion => question !== null)
    .map((question, questionIndex) => ({
      ...question,
      id: uniqueId(question.id, "question", questionIndex, usedQuestionIds),
    }));

  return {
    id: stringValue(value.id).trim() || fallbackId("notebook", index),
    name,
    color: stringValue(value.color, "violet").trim() || "violet",
    questions,
  };
}

/**
 * Migrate the old `wrongbook-data` value. It accepts either the historical
 * notebook array or the versioned export envelope.
 */
export function migrateNotebooks(value: unknown): Notebook[] {
  const rawNotebooks = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.notebooks)
      ? value.notebooks
      : [];

  const usedNotebookIds = new Set<string>();
  return rawNotebooks
    .map((notebook, index) => normalizeNotebook(notebook, index))
    .filter((notebook): notebook is Notebook => notebook !== null)
    .map((notebook, index) => ({
      ...notebook,
      id: uniqueId(notebook.id, "notebook", index, usedNotebookIds),
    }));
}

/** Keep at most one stored image across the whole wrongbook. */
export function enforceLatestPhoto(notebooks: Notebook[], preferred?: { notebookId: string; questionId: string }) {
  const migrated = migrateNotebooks(notebooks);
  const pictured = migrated.flatMap((book) => book.questions.filter((question) => Boolean(question.photo)).map((question) => ({ notebookId: book.id, question })));
  const preferredPhoto = preferred ? pictured.find((item) => item.notebookId === preferred.notebookId && item.question.id === preferred.questionId) : undefined;
  const keep = preferredPhoto ?? pictured.reduce<(typeof pictured)[number] | undefined>((latest, item) => {
    if (!latest) return item;
    return Date.parse(item.question.createdAt) >= Date.parse(latest.question.createdAt) ? item : latest;
  }, undefined);
  return migrated.map((book) => ({ ...book, questions: book.questions.map((question) => book.id === keep?.notebookId && question.id === keep.question.id ? question : { ...question, photo: undefined }) }));
}

/** Percentage of correct attempts. A manually mastered question is 100%. */
export function calculateMastery(attempts: number, correctAttempts: number, mastered = false) {
  if (mastered) return 100;
  const safeAttempts = countValue(attempts);
  if (!safeAttempts) return 0;
  const safeCorrect = Math.min(safeAttempts, countValue(correctAttempts));
  return clampPercent((safeCorrect / safeAttempts) * 100);
}

export function getQuestionMastery(question: Pick<WrongQuestion, "attempts" | "correctAttempts" | "mastered" | "mastery">) {
  if (question.mastered) return 100;
  return clampPercent(question.mastery, calculateMastery(question.attempts, question.correctAttempts, question.mastered));
}

/** Return the next review timestamp using a small spaced-repetition schedule. */
export function calculateNextReviewAt(mastery: number, from: Date | string = new Date()) {
  const base = from instanceof Date ? new Date(from) : new Date(from);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  const score = clampPercent(mastery);
  const days = score >= 90 ? 30 : score >= 75 ? 14 : score >= 50 ? 7 : score > 0 ? 3 : 1;
  return new Date(safeBase.getTime() + days * DAY_MS).toISOString();
}

/** Apply one answer result and schedule the following review. */
export function recordReview(question: WrongQuestion, correct: boolean, reviewedAt: Date | string = new Date()): WrongQuestion {
  const reviewedDate = reviewedAt instanceof Date ? new Date(reviewedAt) : new Date(reviewedAt);
  const safeReviewedDate = Number.isNaN(reviewedDate.getTime()) ? new Date() : reviewedDate;
  const attempts = question.attempts + 1;
  const correctAttempts = question.correctAttempts + (correct ? 1 : 0);
  const mastery = calculateMastery(attempts, correctAttempts, question.mastered && correct);

  return {
    ...question,
    mastered: correct ? question.mastered : false,
    attempts,
    correctAttempts,
    mastery,
    lastReviewedAt: safeReviewedDate.toISOString(),
    nextReviewAt: calculateNextReviewAt(correct ? mastery : 0, safeReviewedDate),
  };
}

export function isDueToday(question: WrongQuestion, now: Date | string = new Date()) {
  const today = now instanceof Date ? new Date(now) : new Date(now);
  const safeToday = Number.isNaN(today.getTime()) ? new Date() : today;
  const endOfToday = new Date(safeToday);
  endOfToday.setHours(23, 59, 59, 999);

  if (!question.nextReviewAt) return !question.mastered;
  const dueAt = Date.parse(question.nextReviewAt);
  return !Number.isNaN(dueAt) && dueAt <= endOfToday.getTime();
}

export function getTodayReviews(notebooks: Notebook[], now: Date | string = new Date()): TodayReview[] {
  return notebooks.flatMap((notebook) => notebook.questions
    .filter((question) => isDueToday(question, now))
    .map((question) => ({ notebookId: notebook.id, notebookName: notebook.name, question })));
}

export function getReviewStats(notebooks: Notebook[], now: Date | string = new Date()): ReviewStats {
  const questions = notebooks.flatMap((notebook) => notebook.questions);
  const attempts = questions.reduce((sum, question) => sum + question.attempts, 0);
  const correctAttempts = questions.reduce((sum, question) => sum + question.correctAttempts, 0);
  const mastery = questions.length
    ? Math.round(questions.reduce((sum, question) => sum + getQuestionMastery(question), 0) / questions.length)
    : 0;

  return {
    totalQuestions: questions.length,
    dueToday: getTodayReviews(notebooks, now).length,
    attempts,
    correctAttempts,
    mastery,
  };
}

/** Parse, validate and migrate a JSON backup without mutating existing data. */
export function importWrongbookJSON(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "JSON 文件格式不正确" };
  }

  if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version > 2) {
    return { ok: false, error: "此备份来自更高版本，当前网站无法安全导入" };
  }

  const rawNotebooks = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.notebooks)
      ? parsed.notebooks
      : null;
  const hasNotebookArray = rawNotebooks !== null;
  if (!hasNotebookArray) return { ok: false, error: "备份中没有题库数据" };

  const hasInvalidNotebook = rawNotebooks.some((notebook) => {
    if (!isRecord(notebook) || !stringValue(notebook.name).trim() || !Array.isArray(notebook.questions)) return true;
    return notebook.questions.some((question) => !normalizeQuestion(question));
  });
  if (hasInvalidNotebook) return { ok: false, error: "备份包含缺少题目或答案的无效数据" };

  const notebooks = migrateNotebooks(parsed);
  if (!notebooks.length) return { ok: false, error: "备份中没有有效题库" };
  return { ok: true, notebooks };
}

/** Merge an imported backup without deleting local notebooks or duplicate questions. */
export function mergeNotebooks(current: Notebook[], imported: Notebook[]) {
  const result = migrateNotebooks(current).map((book) => ({ ...book, questions: [...book.questions] }));
  const usedBookIds = new Set(result.map((book) => book.id));

  for (const incoming of migrateNotebooks(imported)) {
    const target = result.find((book) => book.id === incoming.id || book.name.trim().toLocaleLowerCase() === incoming.name.trim().toLocaleLowerCase());
    if (!target) {
      const nextId = uniqueId(incoming.id, "notebook", result.length, usedBookIds);
      result.push({ ...incoming, id: nextId });
      continue;
    }

    const fingerprints = new Set(target.questions.map((question) => `${question.stem.trim().toLocaleLowerCase()}\u0000${question.answer.trim().toLocaleLowerCase()}`));
    const usedQuestionIds = new Set(target.questions.map((question) => question.id));
    incoming.questions.forEach((question, index) => {
      const fingerprint = `${question.stem.trim().toLocaleLowerCase()}\u0000${question.answer.trim().toLocaleLowerCase()}`;
      if (fingerprints.has(fingerprint)) return;
      target.questions.push({ ...question, id: uniqueId(question.id, "question", target.questions.length + index, usedQuestionIds) });
      fingerprints.add(fingerprint);
    });
  }

  return result;
}

export function exportWrongbookJSON(notebooks: Notebook[]) {
  const payload: WrongbookExport = {
    version: 2,
    exportedAt: new Date().toISOString(),
    notebooks: migrateNotebooks(notebooks),
  };
  return JSON.stringify(payload, null, 2);
}
