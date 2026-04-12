import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  InteractionEvent,
  Logger,
  PipelineRunner,
  StateManager,
  ReviseMode,
  LLMClient,
  BookConfig,
  Platform,
} from "../index.js";
import { chatCompletion } from "../index.js";
import { executeEditTransaction } from "./edit-controller.js";
import type { InteractionRuntimeTools } from "./runtime.js";

type PipelineLike = Pick<PipelineRunner, "writeNextChapter" | "reviseDraft"> & {
  readonly initBook?: PipelineRunner["initBook"];
};
type StateLike = Pick<StateManager, "ensureControlDocuments" | "bookDir" | "loadBookConfig" | "loadChapterIndex" | "saveChapterIndex" | "listBooks">;
type InstrumentablePipelineLike = PipelineLike & {
  readonly config?: {
    logger?: Logger;
    client?: LLMClient;
    model?: string;
  };
};

function normalizePlatform(platform?: string): Platform {
  switch (platform) {
    case "tomato":
    case "feilu":
    case "qidian":
      return platform;
    default:
      return "other";
  }
}

function deriveBookId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

function buildBookConfig(input: {
  readonly title: string;
  readonly genre?: string;
  readonly platform?: string;
  readonly language?: "zh" | "en";
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
}): BookConfig {
  const now = new Date().toISOString();
  return {
    id: deriveBookId(input.title),
    title: input.title,
    platform: normalizePlatform(input.platform),
    genre: input.genre ?? "other",
    status: "outlining",
    targetChapters: input.targetChapters ?? 200,
    chapterWordCount: input.chapterWordCount ?? 3000,
    ...(input.language ? { language: input.language } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

async function exportBookToPath(state: StateLike, bookId: string, options: {
  readonly format?: "txt" | "md" | "epub";
  readonly approvedOnly?: boolean;
  readonly outputPath?: string;
}) {
  const format = options.format ?? "txt";
  const index = await state.loadChapterIndex(bookId);
  const book = await state.loadBookConfig(bookId);
  const chapters = options.approvedOnly
    ? index.filter((chapter) => chapter.status === "approved")
    : index;

  if (chapters.length === 0) {
    throw new Error("No chapters to export.");
  }

  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  const projectRoot = dirname(dirname(bookDir));
  const outputPath = options.outputPath ?? join(projectRoot, `${bookId}_export.${format}`);

  if (format === "epub") {
    const sections: string[] = [
      "<!DOCTYPE html>",
      `<html><head><meta charset="utf-8"><title>${book.title}</title><style>body{font-family:serif;max-width:40em;margin:auto;padding:2em;line-height:1.8}h2{margin-top:3em}</style></head><body>`,
      `<h1>${book.title}</h1>`,
    ];

    for (const chapter of chapters) {
      const padded = String(chapter.number).padStart(4, "0");
      const files = await readdir(chaptersDir);
      const match = files.find((file) => file.startsWith(padded) && file.endsWith(".md"));
      if (!match) {
        continue;
      }
      const markdown = await readFile(join(chaptersDir, match), "utf-8");
      const title = markdown.match(/^#\s+(.+)/m)?.[1] ?? match.replace(/\.md$/, "");
      const htmlBody = markdown
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .map((line) => line.trim() ? `<p>${line}</p>` : "")
        .join("\n");
      sections.push(`<h2>${title}</h2>`);
      sections.push(htmlBody);
    }
    sections.push("</body></html>");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, sections.join("\n"), "utf-8");
  } else {
    const parts: string[] = [];
    parts.push(format === "md" ? `# ${book.title}\n\n---\n` : `${book.title}\n\n`);
    for (const chapter of chapters) {
      const padded = String(chapter.number).padStart(4, "0");
      const files = await readdir(chaptersDir);
      const match = files.find((file) => file.startsWith(padded) && file.endsWith(".md"));
      if (!match) {
        continue;
      }
      parts.push(await readFile(join(chaptersDir, match), "utf-8"));
      parts.push("\n\n");
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, parts.join(format === "md" ? "\n---\n\n" : "\n"), "utf-8");
  }

  return {
    outputPath,
    chaptersExported: chapters.length,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    format,
  };
}

function mapStageMessageToStatus(message: string): InteractionEvent["status"] | undefined {
  const lower = message.trim().toLowerCase();
  if (
    lower.includes("planning next chapter")
    || lower.includes("generating foundation")
    || lower.includes("reviewing foundation")
    || lower.includes("preparing chapter inputs")
    || message.includes("规划下一章意图")
    || message.includes("生成基础设定")
    || message.includes("审核基础设定")
    || message.includes("准备章节输入")
  ) {
    return "planning";
  }
  if (
    lower.includes("composing chapter runtime context")
    || message.includes("组装章节运行时上下文")
  ) {
    return "composing";
  }
  if (
    lower.includes("writing chapter draft")
    || message.includes("撰写章节草稿")
  ) {
    return "writing";
  }
  if (
    lower.includes("auditing draft")
    || message.includes("审计草稿")
  ) {
    return "assessing";
  }
  if (
    lower.includes("fixing")
    || lower.includes("revising chapter")
    || lower.includes("rewrite")
    || lower.includes("repair")
    || message.includes("自动修复")
    || message.includes("整章改写")
    || message.includes("修订第")
  ) {
    return "repairing";
  }
  if (
    lower.includes("persist")
    || lower.includes("saving")
    || lower.includes("snapshot")
    || lower.includes("rebuilding final truth files")
    || lower.includes("validating truth file updates")
    || lower.includes("syncing memory indexes")
    || message.includes("落盘")
    || message.includes("保存")
    || message.includes("快照")
    || message.includes("校验真相文件变更")
    || message.includes("生成最终真相文件")
    || message.includes("同步记忆索引")
  ) {
    return "persisting";
  }
  return undefined;
}

function extractStageDetail(message: string): string | undefined {
  if (message.startsWith("Stage: ")) {
    return message.slice("Stage: ".length).trim();
  }
  if (message.startsWith("阶段：")) {
    return message.slice("阶段：".length).trim();
  }
  return undefined;
}

function createInteractionLogger(
  original: Logger | undefined,
  events: InteractionEvent[],
  bookId: string,
): Logger {
  const emit = (level: "debug" | "info" | "warn" | "error", message: string): void => {
    const stageDetail = extractStageDetail(message);
    const stageStatus = stageDetail ? mapStageMessageToStatus(stageDetail) : undefined;

    if (stageDetail && stageStatus) {
      events.push({
        kind: "stage.changed",
        timestamp: Date.now(),
        status: stageStatus,
        bookId,
        detail: stageDetail,
      });
      return;
    }

    if (level === "warn") {
      events.push({
        kind: "task.warning",
        timestamp: Date.now(),
        status: "blocked",
        bookId,
        detail: message,
      });
      return;
    }

    if (level === "error") {
      events.push({
        kind: "task.failed",
        timestamp: Date.now(),
        status: "failed",
        bookId,
        detail: message,
      });
    }
  };

  const wrap = (base: Logger | undefined): Logger => ({
    debug: (msg, ctx) => {
      emit("debug", msg);
      base?.debug(msg, ctx);
    },
    info: (msg, ctx) => {
      emit("info", msg);
      base?.info(msg, ctx);
    },
    warn: (msg, ctx) => {
      emit("warn", msg);
      base?.warn(msg, ctx);
    },
    error: (msg, ctx) => {
      emit("error", msg);
      base?.error(msg, ctx);
    },
    child: (tag, extraCtx) => wrap(base?.child(tag, extraCtx)),
  });

  return wrap(original);
}

async function withPipelineInteractionTelemetry<T extends { chapterNumber?: number }>(
  pipeline: InstrumentablePipelineLike,
  bookId: string,
  executor: () => Promise<T>,
): Promise<T & {
  __interaction: {
    events: ReadonlyArray<InteractionEvent>;
    activeChapterNumber?: number;
  };
}> {
  const events: InteractionEvent[] = [];
  const originalLogger = pipeline.config?.logger;
  if (pipeline.config) {
    pipeline.config.logger = createInteractionLogger(originalLogger, events, bookId);
  }

  try {
    const result = await executor();
    return {
      ...result,
      __interaction: {
        events,
        ...(typeof result.chapterNumber === "number"
          ? { activeChapterNumber: result.chapterNumber }
          : {}),
      },
    };
  } finally {
    if (pipeline.config) {
      pipeline.config.logger = originalLogger;
    }
  }
}

export function createInteractionToolsFromDeps(
  pipeline: PipelineLike,
  state: StateLike,
  hooks?: {
    readonly onChatTextDelta?: (text: string) => void;
    readonly getChatRequestOptions?: () => {
      readonly temperature?: number;
      readonly maxTokens?: number;
    };
  },
): InteractionRuntimeTools {
  const instrumentedPipeline = pipeline as InstrumentablePipelineLike;

  return {
    listBooks: () => state.listBooks(),
    createBook: async (input) => {
      const book = buildBookConfig(input);
      if (!pipeline.initBook) {
        throw new Error("Pipeline does not support shared book creation.");
      }
      await pipeline.initBook(book);
      return {
        bookId: book.id,
        title: book.title,
        __interaction: {
          responseText: `Created ${book.title} (${book.id}).`,
          details: {
            bookId: book.id,
            title: book.title,
          },
        },
      };
    },
    exportBook: async (bookId, options) => {
      const result = await exportBookToPath(state, bookId, options);
      return {
        ...result,
        __interaction: {
          responseText: `Exported ${bookId} to ${result.outputPath} (${result.chaptersExported} chapters).`,
          details: {
            outputPath: result.outputPath,
            chaptersExported: result.chaptersExported,
            totalWords: result.totalWords,
            format: result.format,
          },
        },
      };
    },
    chat: async (input, options) => {
      const bookLabel = options.bookId ?? "none";
      const chatRequestOptions = hooks?.getChatRequestOptions?.() ?? {};
      const response = instrumentedPipeline.config?.client && instrumentedPipeline.config?.model
        ? await chatCompletion(
          instrumentedPipeline.config.client,
          instrumentedPipeline.config.model,
          [
            {
              role: "system",
              content: [
                "You are InkOS inside the terminal workbench.",
                "Respond conversationally and briefly.",
                "If there is no active book, help the user decide what to write next.",
                "If there is an active book, keep the answer grounded in that book context.",
              ].join(" "),
            },
            {
              role: "user",
              content: `activeBook=${bookLabel}\nautomationMode=${options.automationMode}\nmessage=${input}`,
            },
          ],
          {
            temperature: chatRequestOptions.temperature ?? 0.4,
            maxTokens: chatRequestOptions.maxTokens ?? 240,
            onTextDelta: hooks?.onChatTextDelta,
          },
        )
        : undefined;

      return {
        __interaction: {
          responseText: response?.content?.trim()
            || (options.bookId
              ? `I’m here. Active book is ${options.bookId}.`
              : "I’m here. No active book yet."),
        },
      };
    },
    writeNextChapter: (bookId) => withPipelineInteractionTelemetry(
      instrumentedPipeline,
      bookId,
      () => pipeline.writeNextChapter(bookId),
    ),
    reviseDraft: (bookId, chapterNumber, mode) => withPipelineInteractionTelemetry(
      instrumentedPipeline,
      bookId,
      () => pipeline.reviseDraft(bookId, chapterNumber, mode as ReviseMode),
    ),
    patchChapterText: async (bookId, chapterNumber, targetText, replacementText) => {
      const execution = await executeEditTransaction(
        {
          bookDir: (targetBookId) => state.bookDir(targetBookId),
          loadChapterIndex: (targetBookId) => state.loadChapterIndex(targetBookId),
          saveChapterIndex: (targetBookId, index) => state.saveChapterIndex(targetBookId, index),
        },
        {
          kind: "chapter-local-edit",
          bookId,
          chapterNumber,
          instruction: `Replace ${targetText} with ${replacementText}`,
          targetText,
          replacementText,
        },
      );
      return {
        __interaction: {
          activeChapterNumber: chapterNumber,
          responseText: execution.summary,
        },
      };
    },
    renameEntity: async (bookId, oldValue, newValue) => {
      const execution = await executeEditTransaction(
        {
          bookDir: (targetBookId) => state.bookDir(targetBookId),
          loadChapterIndex: (targetBookId) => state.loadChapterIndex(targetBookId),
          saveChapterIndex: (targetBookId, index) => state.saveChapterIndex(targetBookId, index),
        },
        {
          kind: "entity-rename",
          bookId,
          entityType: "character",
          oldValue,
          newValue,
        },
      );
      return {
        __interaction: {
          responseText: execution.summary,
        },
      };
    },
    updateCurrentFocus: async (bookId, content) => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), content, "utf-8");
    },
    updateAuthorIntent: async (bookId, content) => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", "author_intent.md"), content, "utf-8");
    },
    writeTruthFile: async (bookId, fileName, content) => {
      await state.ensureControlDocuments(bookId);
      await writeFile(join(state.bookDir(bookId), "story", fileName), content, "utf-8");
    },
  };
}
