export type AcceptedAnswers = string | readonly string[];

export type AnswerJudgeOptions = {
  /** Absolute numeric error accepted when comparing decimals or fractions. */
  absoluteTolerance?: number;
  /** Relative numeric error accepted for larger numbers. */
  relativeTolerance?: number;
  caseSensitive?: boolean;
};

export type AnswerJudgeResult = {
  correct: boolean;
  normalizedAnswer: string;
  matchedAnswer?: string;
};

const DEFAULT_ABSOLUTE_TOLERANCE = 1e-6;
const DEFAULT_RELATIVE_TOLERANCE = 1e-6;
const SIMPLE_NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const SIMPLE_FRACTION_PATTERN = new RegExp(`^(${SIMPLE_NUMBER})\\s*\\/\\s*(${SIMPLE_NUMBER})$`);
const EMBEDDED_FRACTION_PATTERN = new RegExp(`(${SIMPLE_NUMBER})\\s*\\/\\s*(${SIMPLE_NUMBER})`, "g");

/**
 * Normalizes text answers without changing their mathematical meaning.
 * Whitespace is removed entirely so `New York` and ` new   york ` compare equal.
 */
export function normalizeAnswer(value: string, options: AnswerJudgeOptions = {}): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, "").trim();
  return options.caseSensitive ? normalized : normalized.toLowerCase();
}

/**
 * Splits alternative correct answers. Common list punctuation and newlines are separators.
 * A slash is a separator unless it belongs to a simple numeric fraction.
 * Examples: `A/B` -> [A, B], `1/2` -> [1/2], `1/2 / 0.5` -> [1/2, 0.5].
 */
export function splitAcceptedAnswers(value: AcceptedAnswers): string[] {
  const sourceItems = typeof value === "string" ? [value] : [...value];

  return sourceItems
    .flatMap((source) => source.split(/[|,，;；、\r\n]+/u))
    .flatMap(splitSlashAlternatives)
    .map((answer) => answer.trim())
    .filter(Boolean);
}

function splitSlashAlternatives(value: string): string[] {
  const fractions: string[] = [];
  const protectedValue = value.replace(EMBEDDED_FRACTION_PATTERN, (match) => {
    const token = `\uE000${fractions.length}\uE001`;
    fractions.push(match);
    return token;
  });

  return protectedValue.split("/").map((part) =>
    part.replace(/\uE000(\d+)\uE001/gu, (_, index: string) => fractions[Number(index)] ?? ""),
  );
}

/** Parses a plain decimal or one simple fraction. Other expressions are rejected. */
export function parseNumericAnswer(value: string): number | null {
  const compact = value.normalize("NFKC").trim();
  const fraction = compact.match(SIMPLE_FRACTION_PATTERN);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
    return numerator / denominator;
  }

  if (!new RegExp(`^${SIMPLE_NUMBER}$`).test(compact)) return null;
  const numericValue = Number(compact);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function answersEquivalent(
  actual: string,
  expected: string,
  options: AnswerJudgeOptions = {},
): boolean {
  const normalizedActual = normalizeAnswer(actual, options);
  const normalizedExpected = normalizeAnswer(expected, options);
  if (!normalizedActual || !normalizedExpected) return false;
  if (normalizedActual === normalizedExpected) return true;

  const actualNumber = parseNumericAnswer(normalizedActual);
  const expectedNumber = parseNumericAnswer(normalizedExpected);
  if (actualNumber === null || expectedNumber === null) return false;

  const absoluteTolerance = Math.max(0, options.absoluteTolerance ?? DEFAULT_ABSOLUTE_TOLERANCE);
  const relativeTolerance = Math.max(0, options.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE);
  const difference = Math.abs(actualNumber - expectedNumber);
  const scale = Math.max(Math.abs(actualNumber), Math.abs(expectedNumber));
  return difference <= Math.max(absoluteTolerance, relativeTolerance * scale);
}

export function judgeAnswer(
  actual: string,
  acceptedAnswers: AcceptedAnswers,
  options: AnswerJudgeOptions = {},
): AnswerJudgeResult {
  const normalizedAnswer = normalizeAnswer(actual, options);
  const matchedAnswer = splitAcceptedAnswers(acceptedAnswers).find((expected) =>
    answersEquivalent(actual, expected, options),
  );

  return {
    correct: matchedAnswer !== undefined,
    normalizedAnswer,
    ...(matchedAnswer === undefined ? {} : { matchedAnswer }),
  };
}

export function isAnswerCorrect(
  actual: string,
  acceptedAnswers: AcceptedAnswers,
  options: AnswerJudgeOptions = {},
): boolean {
  return judgeAnswer(actual, acceptedAnswers, options).correct;
}
