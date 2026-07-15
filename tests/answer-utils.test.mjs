import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/answer-utils.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const answerUtils = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const {
  answersEquivalent,
  isAnswerCorrect,
  judgeAnswer,
  normalizeAnswer,
  parseNumericAnswer,
  splitAcceptedAnswers,
} = answerUtils;

test("ignores case, full-width forms and extra whitespace", () => {
  assert.equal(normalizeAnswer("  Ａ  b\nC "), "abc");
  assert.equal(isAnswerCorrect(" Bei Jing ", "beijing"), true);
  assert.equal(isAnswerCorrect("YES", "yes"), true);
});

test("supports alternative answers from punctuation, slashes, lines, and arrays", () => {
  assert.deepEqual(splitAcceptedAnswers("red | blue/green\nyellow"), ["red", "blue", "green", "yellow"]);
  assert.deepEqual(splitAcceptedAnswers("甲，乙;丙；丁、戊"), ["甲", "乙", "丙", "丁", "戊"]);
  assert.equal(isAnswerCorrect("green", "red | blue/green\nyellow"), true);
  assert.equal(isAnswerCorrect("乙", "甲，乙"), true);
  assert.equal(isAnswerCorrect("B", ["A", "B", "C"]), true);
  assert.equal(judgeAnswer("b", "a|B").matchedAnswer, "B");
});

test("does not mistake simple fraction slashes for answer separators", () => {
  assert.deepEqual(splitAcceptedAnswers("1/2"), ["1/2"]);
  assert.deepEqual(splitAcceptedAnswers("1/2 / 0.5"), ["1/2", "0.5"]);
  assert.equal(isAnswerCorrect("0.5", "1/2"), true);
  assert.equal(isAnswerCorrect("3/4", "0.75 | 75/100"), true);
});

test("compares numeric answers with absolute and relative tolerance", () => {
  assert.equal(answersEquivalent("1.0000004", "1"), true);
  assert.equal(answersEquivalent("1.01", "1"), false);
  assert.equal(answersEquivalent("1000000.5", "1000000"), true);
  assert.equal(answersEquivalent("1.01", "1", { absoluteTolerance: 0.02, relativeTolerance: 0 }), true);
});

test("only parses plain decimals and simple fractions", () => {
  assert.equal(parseNumericAnswer(" -3 / 4 "), -0.75);
  assert.equal(parseNumericAnswer(".25"), 0.25);
  assert.equal(parseNumericAnswer("1/0"), null);
  assert.equal(parseNumericAnswer("1+1"), null);
  assert.equal(isAnswerCorrect("", ""), false);
});
