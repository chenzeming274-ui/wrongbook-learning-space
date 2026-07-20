import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/question-autofill.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const testModule = { exports: {} };
vm.runInNewContext(`(function(exports,module){${js}})(module.exports,module)`, { module: testModule, exports: testModule.exports, JSON });
const { buildQuestionAutofillPrompt, parseQuestionAutofill } = testModule.exports;

test("extracts JSON even when the model adds surrounding text", () => {
  const parsed = parseQuestionAutofill('结果：```json\n{"stem":"1+1=?","type":"加法","answer":"2","explanation":"相加得 2"}\n```');
  assert.deepEqual({ ...parsed }, { stem: "1+1=?", type: "加法", answer: "2", explanation: "相加得 2" });
});

test("prompt requests every automatically filled field", () => {
  const prompt = buildQuestionAutofillPrompt({ recognizedText: "求 1+1" });
  for (const field of ["stem", "type", "answer", "explanation"]) assert.match(prompt, new RegExp(field));
  assert.match(prompt, /纠正明显 OCR 错字/);
});
