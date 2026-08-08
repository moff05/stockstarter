import { useState, useRef, useEffect, useMemo } from "react";
import { X, Send, Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { askPortfolio } from "@/lib/chat.functions";
import { useAccountFilter } from "@/lib/account-filter";
import { useQuery } from "@tanstack/react-query";
import { listTransactions } from "@/lib/transactions.functions";
import { listMappings } from "@/lib/symbol-mappings.functions";
import { buildResolver } from "@/lib/symbol-resolver";

type Message = { role: "user" | "assistant"; content: string };

// Map a caught error to plain, calm copy that names the likely reason.
// Surfaces the server's own message/status when present rather than a blanket string.
function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string } | undefined;
  const raw = (e?.message ?? String(err ?? "")).trim();
  const hay = `${e?.name ?? ""} ${raw}`.toLowerCase();
  const status = typeof e?.status === "number" ? e.status : undefined;

  // Rate limited
  if (status === 429 || /rate.?limit|too many requests|429/.test(hay)) {
    return "The AI is rate-limited right now — try again in a moment.";
  }
  // No API key / auth / not configured on this deployment
  if (
    status === 401 ||
    status === 403 ||
    /api[_ -]?key|unauthorized|forbidden|authentication|not configured|401|403/.test(hay)
  ) {
    return "AI isn't configured on this deployment.";
  }
  // Network / offline / couldn't reach the service
  if (
    /failed to fetch|network|offline|connection|econn|enotfound|etimedout|timeout|fetch failed|load failed/.test(
      hay,
    )
  ) {
    return "Couldn't reach the AI service — check your connection and retry.";
  }
  // Specific-but-graceful fallback: surface the short reason when we have one
  if (raw && raw.toLowerCase() !== "failed to fetch") {
    const short = raw.length > 140 ? raw.slice(0, 140) + "…" : raw;
    return `The AI request failed: ${short}. Try again.`;
  }
  return "The AI request failed. Please try again.";
}

const SUGGESTIONS = [
  "What's my biggest position?",
  "Show my unrealized gains by holding",
  "How much dividend income have I earned?",
  "Which positions are underwater?",
];

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc list-outside pl-4 mb-2 space-y-0.5 text-sm">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5 text-sm">{children}</ol>,
          li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2 rounded border border-border/50">
              <table className="text-xs w-full border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-border/30 last:border-0">{children}</tr>,
          th: ({ children }) => (
            <th className="text-left px-2.5 py-1.5 font-medium text-muted-foreground text-xs whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 text-xs whitespace-nowrap">{children}</td>
          ),
          code: ({ children }) => (
            <code className="bg-muted rounded px-1 py-0.5 text-xs font-mono">{children}</code>
          ),
          h1: ({ children }) => <p className="font-semibold text-sm mb-1">{children}</p>,
          h2: ({ children }) => <p className="font-semibold text-sm mb-1">{children}</p>,
          h3: ({ children }) => <p className="font-medium text-sm mb-1">{children}</p>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground italic mb-2">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function ChatPanel() {
  const { account } = useAccountFilter();

  // Chat needs the WHOLE portfolio (every account) to answer cross-account
  // questions, regardless of which account is currently selected in the nav —
  // so this fetches unfiltered, independent of usePortfolio()'s account scoping.
  const txnsQ = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: () => listTransactions({ data: {} }),
    staleTime: Infinity,
  });
  const mappingsQ = useQuery({
    queryKey: ["symbol_mappings"],
    queryFn: () => listMappings(),
    staleTime: Infinity,
  });
  const resolve = useMemo(() => buildResolver(mappingsQ.data ?? []), [mappingsQ.data]);
  const resolvedTransactions = useMemo(
    () =>
      (txnsQ.data ?? []).map((t) => {
        if (!t.symbol) return t;
        const r = resolve(t.symbol);
        return { ...t, symbol: r.ticker ?? r.original };
      }),
    [txnsQ.data, resolve],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  async function send() {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "36px";
    setIsLoading(true);

    try {
      const result = await askPortfolio({
        data: { messages: history, account, transactions: resolvedTransactions as any },
      });
      setMessages([...history, { role: "assistant", content: result.content }]);
    } catch (err) {
      setMessages([
        ...history,
        { role: "assistant", content: describeError(err) },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Floating trigger */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full px-4 py-2.5 bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-sm font-medium">Ask AI</span>
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col bg-background border border-border/60 rounded-2xl shadow-2xl"
          style={{ width: "min(420px, calc(100vw - 3rem))", height: "min(580px, calc(100vh - 5rem))" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-primary/10">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="font-semibold text-sm">Portfolio Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <style>{`.chat-scroll::-webkit-scrollbar { display: none; }`}</style>
          <div
            className="chat-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            } as React.CSSProperties}
          >

            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="p-3 rounded-xl bg-muted/60 mb-3">
                  <Sparkles className="w-6 h-6 text-primary/70" />
                </div>
                <p className="font-medium text-sm mb-1">Ask about your portfolio</p>
                <p className="text-xs text-muted-foreground mb-5">
                  Live prices · all holdings · transaction history
                </p>
                <div className="w-full space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      className="block w-full text-left text-xs px-3 py-2.5 rounded-xl border border-border/60 hover:bg-muted/60 hover:border-border transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m, i) => {
                  const isLast = i === messages.length - 1;
                  return (
                    <div
                      key={i}
                      className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                    >
                      {m.role === "user" ? (
                        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed">
                          {m.content}
                        </div>
                      ) : (
                        <div className="w-full bg-muted/50 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                          {!m.content && isLoading && isLast ? (
                            <span className="inline-flex items-center gap-1.5 py-0.5">
                              {[0, 120, 240].map((delay, j) => (
                                <span
                                  key={j}
                                  className="w-1.5 h-1.5 bg-foreground/25 rounded-full animate-bounce"
                                  style={{ animationDelay: `${delay}ms` }}
                                />
                              ))}
                            </span>
                          ) : (
                            <AssistantMessage content={m.content} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-border/60 shrink-0">
            <div className="flex items-end gap-2 bg-muted/40 border border-border/60 rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "22px";
                  e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your portfolio…"
                disabled={isLoading}
                rows={1}
                style={{ height: "22px" }}
                className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 leading-snug overflow-y-hidden"
              />
              <button
                onClick={send}
                disabled={!input.trim() || isLoading}
                className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-35 hover:bg-primary/90 transition-colors shrink-0 mb-0.5"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}

