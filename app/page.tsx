"use client";

import { useEffect, useMemo, useState } from "react";
import { askLocalAI, clearLocalAI, loadLocalAI, prepareAIUpgrade, upgradeLocalAI, type LocalAIMessage } from "../src/local-ai";

type WrongQuestion = {
  id: string;
  stem: string;
  answer: string;
  explanation: string;
  type: string;
  createdAt: string;
  mastered: boolean;
};

type Notebook = { id: string; name: string; color: string; questions: WrongQuestion[] };

const seedQuestion: WrongQuestion = {
  id: "q-1",
  stem: "若函数 f(x) = x² - 4x + 3，则 f(x) 的最小值是多少？",
  answer: "-1",
  explanation: "配方得 f(x) = (x - 2)² - 1。因为平方项恒大于等于 0，所以当 x = 2 时，函数取得最小值 -1。",
  type: "二次函数",
  createdAt: "今天",
  mastered: false,
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

export default function Home() {
  const [notebooks, setNotebooks] = useState<Notebook[]>(starterNotebooks);
  const [activeId, setActiveId] = useState("math");
  const [selectedId, setSelectedId] = useState("q-1");
  const [view, setView] = useState<"review" | "add">("review");
  const [showAnswer, setShowAnswer] = useState(false);
  const [answerInput, setAnswerInput] = useState("");
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [answerCorrect, setAnswerCorrect] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiReady, setAiReady] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoadError, setAiLoadError] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiHistory, setAiHistory] = useState<LocalAIMessage[]>([]);
  const [showAiHistory, setShowAiHistory] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiClearing, setAiClearing] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState(0);
  const [upgradeReady, setUpgradeReady] = useState(false);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [aiRetryAttempt, setAiRetryAttempt] = useState(0);
  const [draggedQuestionId, setDraggedQuestionId] = useState("");
  const [query, setQuery] = useState("");
  const [newBook, setNewBook] = useState("");
  const [draft, setDraft] = useState({ stem: "", answer: "", explanation: "", type: "" });
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("wrongbook-data");
    if (saved) {
      try { setNotebooks(JSON.parse(saved)); } catch { localStorage.removeItem("wrongbook-data"); }
    }
    const savedAiHistory = localStorage.getItem("wrongbook-ai-history");
    if (savedAiHistory) {
      try { setAiHistory(JSON.parse(savedAiHistory).slice(-20)); } catch { localStorage.removeItem("wrongbook-ai-history"); }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem("wrongbook-data", JSON.stringify(notebooks));
  }, [loaded, notebooks]);

  useEffect(() => { setShowAnswer(false); setAnswerSubmitted(false); setAnswerInput(""); setAnswerCorrect(false); }, [selectedId]);

  useEffect(() => {
    let active = true;

    loadLocalAI((report) => {
      if (!active) return;
      setAiProgress(Math.max(0, Math.min(100, Math.round(report.progress * 100))));
    })
      .then(() => {
        if (!active) return;
        setAiProgress(100);
        setAiReady(true);
        prepareAIUpgrade((report) => {
          if (!active) return;
          setUpgradeProgress(Math.round(report.progress * 100));
        }).then(() => {
          if (!active) return;
          setUpgradeReady(true);
          notify("更强的 AI 已准备完成，可以升级。");
        }).catch(() => { if (active) setUpgradeProgress(-1); });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "模型加载失败，请重试。";
        setAiLoadError(message.includes("WebGPU") ? message : `模型加载失败：${message.slice(0, 90)}`);
      });

    return () => { active = false; };
  }, [aiRetryAttempt]);

  const active = notebooks.find((book) => book.id === activeId) ?? notebooks[0];
  const selected = active?.questions.find((question) => question.id === selectedId) ?? active?.questions[0];
  const filtered = useMemo(() => active?.questions.filter((q) => q.stem.includes(query) || q.type.includes(query)) ?? [], [active, query]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2200); }

  function retryAiLoad() {
    setAiReady(false);
    setAiLoadError("");
    setAiProgress(0);
    setAiRetryAttempt((value) => value + 1);
  }

  async function clearAiModel() {
    if (aiClearing || !window.confirm("删除本机 AI 模型吗？错题和聊天记录不会受影响。")) return;
    setAiClearing(true);
    try {
      await clearLocalAI();
      setAiReady(false);
      setAiLoadError("模型已清理，需要时可重新安装。");
      setAiProgress(0);
      setUpgradeProgress(0);
      setUpgradeReady(false);
      notify("本机 AI 已清理，需要时会重新安装。");
    } catch {
      notify("清理未完成，请关闭其他打开的网站页面后重试。");
    } finally {
      setAiClearing(false);
    }
  }

  async function upgradeAiModel() {
    if (upgradeBusy || !upgradeReady) return;
    setUpgradeBusy(true);
    try {
      await upgradeLocalAI();
      setUpgradeReady(false);
      setUpgradeProgress(100);
      notify("已升级，之前的对话已保留。");
    } catch {
      notify("升级未完成，请稍后再试。");
    } finally {
      setUpgradeBusy(false);
    }
  }

  async function runAiSearch() {
    if (!aiReady || !aiQuery.trim() || aiBusy) return;
    setAiBusy(true);
    setAiAnswer("");
    try {
      const question = aiQuery.trim();
      const answer = await askLocalAI(question, aiHistory);
      const nextHistory: LocalAIMessage[] = [...aiHistory, { role: "user", content: question }, { role: "assistant", content: answer }].slice(-20);
      setAiAnswer(answer);
      setAiHistory(nextHistory);
      localStorage.setItem("wrongbook-ai-history", JSON.stringify(nextHistory));
      setAiQuery("");
    } catch (error) {
      setAiAnswer(error instanceof Error ? error.message : "回答生成失败，请稍后重试。");
    } finally {
      setAiBusy(false);
    }
  }

  function createNotebook() {
    if (!newBook.trim()) return;
    const book = { id: uid(), name: newBook.trim(), color: "blue", questions: [] };
    setNotebooks((books) => [...books, book]); setActiveId(book.id); setNewBook(""); notify("题库已创建");
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

  function addQuestion() {
    if (!draft.stem.trim()) { notify("请先输入题目内容"); return; }
    const question = { ...draft, id: uid(), createdAt: "刚刚", mastered: false };
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: [question, ...book.questions] } : book));
    setSelectedId(question.id); setDraft({ stem: "", answer: "", explanation: "", type: "" }); setView("review"); setShowAnswer(false); notify("错题已保存");
  }

  function deleteQuestion() {
    if (!selected || !window.confirm("确定删除这道错题吗？")) return;
    const remaining = active.questions.filter((question) => question.id !== selected.id);
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: remaining } : book));
    setSelectedId(remaining[0]?.id || "");
    notify("错题已删除");
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
    const practices = templates.map((template) => ({ ...template, id: uid(), type: selected?.type || "综合", createdAt: "刚刚", mastered: false }));
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: [...practices, ...book.questions] } : book));
    setSelectedId(practices[0].id); setShowAnswer(false); notify("已生成 3 道同类练习题");
  }

  function generateOnePractice() {
    const templates = generated[selected?.type || ""] || generated.default;
    const template = templates[Math.floor(Math.random() * templates.length)];
    const practice = { ...template, id: uid(), type: selected?.type || "综合", createdAt: "刚刚", mastered: false };
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: [practice, ...book.questions] } : book));
    notify("答错了，已追加一道同类题");
  }

  function submitAnswer() {
    if (!selected || !answerInput.trim()) { notify("请先输入答案"); return; }
    const normalize = (value: string) => value.trim().replace(/\s+/g, "").toLowerCase();
    const correct = normalize(answerInput) === normalize(selected.answer);
    setAnswerCorrect(correct); setAnswerSubmitted(true); setShowAnswer(true);
    if (correct) notify("回答正确，可以标记为已掌握");
    else generateOnePractice();
  }

  function markMasteredAndMaybeDelete() {
    if (!selected) return;
    if (window.confirm("答对了。要删除这道错题吗？点击“取消”则移入已掌握。")) {
      deleteQuestion();
      return;
    }
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: book.questions.map((q) => q.id === selected.id ? { ...q, mastered: true } : q) } : book));
    notify("已移入已掌握");
  }

  function toggleMastered() {
    if (!selected) return;
    setNotebooks((books) => books.map((book) => book.id === activeId ? { ...book, questions: book.questions.map((q) => q.id === selected.id ? { ...q, mastered: !q.mastered } : q) } : book));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(notebooks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `错题本备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("备份已导出");
  }

  function resetData() {
    if (!window.confirm("确定清空本机数据并恢复示例题库吗？")) return;
    setNotebooks(starterNotebooks);
    setActiveId("math");
    setSelectedId("q-1");
    setShowAnswer(false);
    notify("已恢复初始数据");
  }

  function renderAnswerPanel() {
    if (!selected) return null;
    if (!answerSubmitted) return <div className="answer-block"><div className="answer-head"><span>先写下你的答案</span><span>提交后揭晓</span></div><div className="answer-entry"><input value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAnswer()} placeholder="输入你的答案…" /><button onClick={submitAnswer}>提交答案</button></div></div>;
    return <><div className="answer-block"><div className="answer-head"><span>正确答案</span><span className={answerCorrect ? "result-correct" : "result-wrong"}>{answerCorrect ? "回答正确" : "回答错误"}</span></div><div className="answer-value">{selected.answer || "尚未填写答案"}</div></div><div className="explanation"><div className="explain-icon">✦</div><div><span>解析与方法</span><p>{selected.explanation || "尚未填写解析。"}</p></div></div><div className="detail-actions">{answerCorrect ? <button className="master-button" onClick={markMasteredAndMaybeDelete}>删除或移入已掌握</button> : <button className="generate-button" onClick={generateOnePractice}><span>✦</span> 再生成 1 道同类题</button>}</div></>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">错</div><div><strong>错题本</strong><span>Learning workspace</span></div></div>
        <div className="side-label">工作台</div>
        <button className="side-link active"><span>⌂</span>总览 <em>{notebooks.reduce((n, b) => n + b.questions.length, 0)}</em></button>
        <button className="side-link" onClick={() => setView("add")}><span>＋</span>录入新错题</button>
        <div className="side-label library-label">我的题库 <button className="mini-add" aria-label="新建题库" onClick={() => document.getElementById("new-book")?.focus()}>＋</button></div>
        <div className="book-list">
          {notebooks.map((book) => (
            <div className={`book-item ${book.id === activeId ? "selected" : ""}`} key={book.id}>
              <button className="book-link" onClick={() => { setActiveId(book.id); setSelectedId(book.questions[0]?.id || ""); setView("review"); }}>
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
        <div className="data-actions"><button onClick={exportData}>导出备份</button><button onClick={resetData}>清空数据</button></div>
        <div className="sidebar-foot"><span className="status-dot" />本地模式 · 数据保存在此设备</div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb">我的题库 <span>/</span> <strong>{active?.name || "未命名题库"}</strong></div><div className="top-actions"><label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索错题或知识点" /><kbd>⌘ K</kbd></label><button className="icon-button" aria-label="通知">♧</button><button className="avatar">学</button></div></header>
        <div className="content">
          <div className="page-heading"><div><p className="eyebrow">学习进度 <span>·</span> {active?.name}</p><h1>把错题变成<br /><i>下一次的得分</i></h1><p className="subheading">理解错误、掌握方法，再用三道新题确认真的学会。</p></div><div className="progress-card"><div className="ring"><span>{active?.questions.filter((q) => q.mastered).length || 0}</span><small>/ {active?.questions.length || 0}</small></div><div><strong>掌握进度</strong><span>继续保持，慢慢变强</span></div></div></div>
          <div className="tabs"><button className={view === "review" ? "tab active" : "tab"} onClick={() => setView("review")}>错题复盘 <span>{active?.questions.length || 0}</span></button><button className={view === "add" ? "tab active" : "tab"} onClick={() => setView("add")}>＋ 录入错题</button><button className={`ai-tab ${aiReady ? "ready" : ""}`} disabled={!aiReady} onClick={() => document.getElementById("ai-search")?.focus()}>✦ AI 搜索</button></div>
          <section className={`ai-search-card ${aiReady ? "ready" : aiLoadError ? "error" : "loading"}`}>
            <div className="ai-search-head"><div><span className="ai-kicker">本机 AI · 高性能</span><strong>{aiReady ? "问问你的错题助手" : aiLoadError ? "AI 模型未能加载" : "正在安装 AI 模型"}</strong></div><span className="ai-status">{aiReady ? "已就绪" : aiLoadError ? "加载失败" : `${aiProgress}%`}</span></div>
            <div className="ai-progress-track" role="progressbar" aria-label="AI 模型加载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={aiProgress}><div className="ai-progress-fill" style={{ width: `${aiProgress}%` }} /></div>
            {aiLoadError ? <div className="ai-error" role="alert"><span>{aiLoadError}</span><button onClick={retryAiLoad}>重新加载</button></div> : null}
            {aiReady ? <><div className="ai-memory-note">已记住最近 10 轮对话，超过后自动删除最早一轮 <button className="ai-clear" disabled={aiClearing} onClick={clearAiModel}>{aiClearing ? "正在清理…" : "清理本机 AI"}</button></div>{upgradeReady ? <div className="ai-upgrade"><span>更强 AI 已准备完成</span><button onClick={upgradeAiModel} disabled={upgradeBusy}>{upgradeBusy ? "正在升级…" : "升级"}</button></div> : upgradeProgress >= 0 && upgradeProgress < 100 ? <div className="ai-upgrade muted">后台准备更强 AI… {upgradeProgress}%</div> : null}<div className="ai-search-row"><input id="ai-search" value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAiSearch()} placeholder="输入知识点或学习问题…" /><button disabled={!aiQuery.trim() || aiBusy} onClick={runAiSearch}>{aiBusy ? "思考中…" : "搜索"}</button></div>{aiBusy ? <div className="ai-answer" aria-live="polite">正在本机生成回答…</div> : null}{aiHistory.length ? <><button className="ai-history-toggle" onClick={() => setShowAiHistory((value) => !value)}>{showAiHistory ? "收起对话" : "显示对话"}</button>{showAiHistory ? <div className="ai-chat-history" aria-live="polite">{aiHistory.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "user" ? "你" : "学习助手"}</span><p>{message.content}</p></div>)}</div> : null}</> : null}</> : null}
          </section>

          {view === "add" ? <section className="add-card"><div className="card-title"><div><p className="eyebrow">记录一次错误</p><h2>把题目放进来</h2></div><span className="step-badge">自动保存到「{active?.name}」</span></div><label>题目内容<textarea value={draft.stem} onChange={(e) => setDraft({ ...draft, stem: e.target.value })} placeholder="粘贴题目、题干或你的解题过程…" /></label><div className="form-grid"><label>题型 / 知识点<input value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} placeholder="例如：二次函数" /></label><label>正确答案<input value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder="填入答案" /></label></div><label>解析与反思<textarea className="short" value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} placeholder="为什么错？正确思路是什么？" /></label><div className="form-actions"><button className="ghost" onClick={() => setView("review")}>取消</button><button className="primary" onClick={addQuestion}>保存这道错题 <span>→</span></button></div></section> : <div className="review-grid"><div className="question-list"><div className="list-head"><div><h2>待复盘题目</h2><p>长按或拖动题目可调整顺序</p></div><span className="count-pill">{filtered.length} 道</span></div>{filtered.length ? filtered.map((question) => <button className={`question-row ${question.id === selected?.id ? "current" : ""} ${question.id === draggedQuestionId ? "dragging" : ""}`} key={question.id} draggable onDragStart={() => setDraggedQuestionId(question.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => reorderQuestion(question.id)} onDragEnd={() => setDraggedQuestionId("")} onClick={() => { setSelectedId(question.id); setShowAnswer(true); }}><div className="row-index">{question.mastered ? "✓" : "0" + (active?.questions.indexOf(question) + 1)}</div><div className="row-copy"><strong>{question.stem}</strong><span>{question.type || "未分类"} · {question.createdAt}</span></div><span className="chevron">⠿</span></button>) : <div className="empty">还没有错题，点击“录入错题”开始。</div>}</div><article className="question-detail">{selected ? <><div className="detail-top"><span className={`tag ${selected.mastered ? "done" : ""}`}>{selected.mastered ? "已掌握" : "待复盘"}</span><span className="detail-date">{selected.createdAt}</span></div><h2>{selected.stem}</h2>{renderAnswerPanel()}</> : <div className="detail-empty"><div>✦</div><h2>选一道题开始复盘</h2><p>每一次理解错误，都会让下一次更稳。</p></div>}</article></div>}
          {view === "review" && selected && <div className="question-tools"><button onClick={deleteQuestion}>删除当前错题</button></div>}
          {view === "review" && selected && <section className="practice-banner"><div className="practice-shape">✦</div><div><p className="eyebrow">举一反三</p><h2>真的掌握了吗？</h2><p>用三道相似但不重复的题，检验你是否掌握了解题方法。</p></div><button className="primary" onClick={generatePractice}>生成 3 道练习题 <span>→</span></button></section>}
        </div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
