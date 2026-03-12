import { BaseAgent } from "./base.js";
import type { AgentContext } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ArchitectOutput {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly styleGuide: string;
  readonly currentState: string;
  readonly pendingHooks: string;
}

export class ArchitectAgent extends BaseAgent {
  get name(): string {
    return "architect";
  }

  async generateFoundation(book: BookConfig, externalContext?: string): Promise<ArchitectOutput> {
    const contextBlock = externalContext
      ? `\n\n## 外部指令\n以下是来自外部系统（如 OpenClaw）的创作指令，请将其融入设定中：\n\n${externalContext}\n`
      : "";

    const systemPrompt = `你是一个专业的网络小说架构师。你的任务是为一本新小说生成完整的基础设定。${contextBlock}

要求：
- 平台：${book.platform}
- 题材：${book.genre}
- 目标章数：${book.targetChapters}章
- 每章字数：${book.chapterWordCount}字

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
世界观设定、势力分布、核心规则体系、主角设定（身份/金手指/性格底色）、重要配角

=== SECTION: volume_outline ===
卷纲规划，每卷包含：卷名、章节范围、核心冲突、关键转折、收益目标

=== SECTION: style_guide ===
文风锁定：叙事视角、语言风格、禁忌清单、爽点回路设计、节奏规则

=== SECTION: current_state ===
初始状态卡（第0章），包含：
| 字段 | 值 |
|------|-----|
| 当前章节 | 0 |
| 当前位置 | (起始地点) |
| 主角状态 | (初始状态) |
| 当前目标 | (第一个目标) |
| 当前限制 | (初始限制) |
| 当前敌我 | (初始关系) |
| 当前冲突 | (第一个冲突) |

=== SECTION: pending_hooks ===
初始伏笔池（Markdown表格）：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |

生成内容必须：
1. 符合${book.platform}平台口味
2. 主角杀伐果断，不圣母
3. 有明确的数值/资源体系可追踪
4. 伏笔前后呼应，不留悬空线`;

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `请为标题为"${book.title}"的${book.genre}小说生成完整基础设定。`,
      },
    ], { maxTokens: 16384, temperature: 0.8 });

    return this.parseSections(response.content);
  }

  async writeFoundationFiles(
    bookDir: string,
    output: ArchitectOutput,
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), output.storyBible, "utf-8"),
      writeFile(
        join(storyDir, "volume_outline.md"),
        output.volumeOutline,
        "utf-8",
      ),
      writeFile(join(storyDir, "style_guide.md"), output.styleGuide, "utf-8"),
      writeFile(
        join(storyDir, "current_state.md"),
        output.currentState,
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        output.pendingHooks,
        "utf-8",
      ),
      writeFile(
        join(storyDir, "particle_ledger.md"),
        "# 资源账本\n\n| 章节 | 期初值 | 来源 | 完整度 | 增量 | 期末值 | 依据 |\n|------|--------|------|--------|------|--------|------|\n| 0 | 0 | 初始化 | - | 0 | 0 | 开书初始 |\n",
        "utf-8",
      ),
    ]);
  }

  private parseSections(content: string): ArchitectOutput {
    const extract = (name: string): string => {
      const regex = new RegExp(
        `=== SECTION: ${name} ===\\s*([\\s\\S]*?)(?==== SECTION:|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? `[${name} 生成失败，需要重新生成]`;
    };

    return {
      storyBible: extract("story_bible"),
      volumeOutline: extract("volume_outline"),
      styleGuide: extract("style_guide"),
      currentState: extract("current_state"),
      pendingHooks: extract("pending_hooks"),
    };
  }
}
