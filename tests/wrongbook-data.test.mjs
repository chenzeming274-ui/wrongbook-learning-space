import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/wrongbook-data.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const data = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("migrates legacy mastery consistently and normalizes dates", () => {
  const [book] = data.migrateNotebooks([{ name: "数学", questions: [{
    stem: "1+1", answer: "2", mastered: true, mastery: 0,
    createdAt: "2026-01-02", lastReviewedAt: "invalid", nextReviewAt: "2026-01-03 08:00:00Z",
  }] }]);
  const [question] = book.questions;
  assert.equal(question.mastered, true);
  assert.equal(question.mastery, 100);
  assert.equal(data.getQuestionMastery(question), 100);
  assert.equal(question.createdAt, "2026-01-02T00:00:00.000Z");
  assert.equal(question.lastReviewedAt, undefined);
  assert.equal(question.nextReviewAt, "2026-01-03T08:00:00.000Z");
});

test("generates unique notebook and per-notebook question ids", () => {
  const books = data.migrateNotebooks([
    { id: "same", name: "数学", questions: [
      { id: "same-question", stem: "a", answer: "a" },
      { id: "same-question", stem: "b", answer: "b" },
      { stem: "c", answer: "c" },
      { id: "question-3", stem: "d", answer: "d" },
    ] },
    { id: "same", name: "英语", questions: [] },
  ]);
  assert.deepEqual(books.map((book) => book.id), ["same", "same-2"]);
  assert.equal(new Set(books[0].questions.map((question) => question.id)).size, 4);
});

test("records attempts and schedules incorrect reviews for the following day", () => {
  const question = {
    id: "q", stem: "题", answer: "答", explanation: "", type: "综合",
    createdAt: "2026-01-01T00:00:00.000Z", mastered: true,
    attempts: 4, correctAttempts: 4, mastery: 100,
  };
  const reviewed = data.recordReview(question, false, "2026-01-10T12:00:00.000Z");
  assert.equal(reviewed.mastered, false);
  assert.equal(reviewed.attempts, 5);
  assert.equal(reviewed.correctAttempts, 4);
  assert.equal(reviewed.mastery, 80);
  assert.equal(reviewed.nextReviewAt, "2026-01-11T12:00:00.000Z");
  assert.equal(data.isDueToday(reviewed, "2026-01-11T00:00:00.000Z"), true);
});

test("rejects invalid imports without mutating valid legacy arrays", () => {
  assert.equal(data.importWrongbookJSON("not json").ok, false);
  assert.equal(data.importWrongbookJSON(JSON.stringify({ version: 3, notebooks: [] })).ok, false);
  const result = data.importWrongbookJSON(JSON.stringify([{ name: "物理", questions: [{ stem: "s", answer: "a" }] }]));
  assert.equal(result.ok, true);
  assert.equal(result.notebooks[0].questions[0].attempts, 0);
});

test("merges notebooks and skips duplicate questions without deleting local data", () => {
  const current = data.migrateNotebooks([{ id: "math", name: "数学", questions: [{ id: "q1", stem: "1+1", answer: "2" }] }]);
  const imported = data.migrateNotebooks([
    { id: "other", name: "数学", questions: [{ id: "q1", stem: "1+1", answer: "2" }, { id: "q1", stem: "2+2", answer: "4" }] },
    { id: "english", name: "英语", questions: [{ stem: "Hello", answer: "你好" }] },
  ]);
  const merged = data.mergeNotebooks(current, imported);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].questions.length, 2);
  assert.equal(new Set(merged[0].questions.map((question) => question.id)).size, 2);
  assert.equal(merged[1].name, "英语");
});
