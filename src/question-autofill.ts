export type QuestionAutofill = {
  stem: string;
  type: string;
  answer: string;
  explanation: string;
};

type PartialQuestionAutofill = Partial<QuestionAutofill>;

export function buildQuestionAutofillPrompt(input: PartialQuestionAutofill & { recognizedText?: string; photoHint?: string }) {
  return `请把照片 OCR 文字整理成一条完整错题记录，只输出一个 JSON 对象，不要 Markdown、代码块或其他文字。字段必须是 stem、type、answer、explanation。必须自动完成以下工作：纠正明显 OCR 错字；保留完整题干、条件、选项和问题；判断学科知识点；计算正确答案；给出清晰解析。已有内容优先保留并补全缺失项；不能确定的内容要在对应字段中明确写“需人工核对”，绝对不要编造。禁止 LaTeX，使用普通文本和 Unicode 数学符号。
OCR 文字：${input.recognizedText?.slice(0, 6000) || "未提供"}
题目：${input.stem || "未填写"}
题型：${input.type || "未填写"}
答案：${input.answer || "未填写"}
解析：${input.explanation || "未填写"}
拍照备注：${input.photoHint || "未填写"}`;
}

export function parseQuestionAutofill(raw: string): QuestionAutofill {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 没有返回可用的错题信息。");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as PartialQuestionAutofill;
  const result = {
    stem: typeof parsed.stem === "string" ? parsed.stem.trim() : "",
    type: typeof parsed.type === "string" ? parsed.type.trim() : "",
    answer: typeof parsed.answer === "string" ? parsed.answer.trim() : "",
    explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
  };
  if (!result.stem) throw new Error("没有识别到完整题目，请重拍或手动补充。");
  return result;
}
