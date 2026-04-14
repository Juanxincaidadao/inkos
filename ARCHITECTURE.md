# InkOS 技术架构文档 (Technical Architecture Document)

本文档旨在为后续参与 InkOS（Autonomous AI novel writing CLI agent）开发的工程师提供系统级的架构全景图、核心模块设计解析以及数据流转机制，帮助开发者快速掌握项目全貌和二次开发的方法。

## 1. 项目概览

**InkOS** 是一个完全自动化的小说创作引擎，采用多 Agent（智能体）管线架构，涵盖了构思、提纲、撰写、审计、修改定稿的完整生命周期。
其核心特点为 **数据驱动和严格的状态管理**（"真相文件"），以克服大型语言模型（LLM）长文本遗忘、逻辑前后矛盾等核心痛点。

### 1.1 技术栈
- **语言**: TypeScript (Node.js >= 20)
- **包管理工具**: pnpm (Workspace Monorepo)
- **底层驱动**: OpenAI 兼容的 LLM 接口抽象（支持多 Provider 动态路由）
- **状态与校验**: Zod Schema，局部 JSON delta 更新 + SQLite 时序记忆数据库
- **前端工具**: Vite + React + Hono (提供给内置 Web Studio)
- **CLI / UI**: Ink (React for CLI), Commander.js 等

## 2. 系统分层架构 (Monorepo 结构)


### 2.0. 项目结构
项目根目录基于 pnpm workspaces 规范配置，源码按照功能划分模块，主要目录如下：
```text
inkos/
├── packages/           # 核心业务包文件夹
│   ├── cli/            # 终端命令行交互工具
│   ├── core/           # 核心 AI 创作引擎与 Agent 服务
│   └── studio/         # Web 视图工作台与本地接口层
├── skills/             # 对外暴露的 OpenClaw Skill 规范定义目录
├── scripts/            # 构建、包发布校验相关的工程化辅助脚本
├── test-project/       # 用于测试用例演示或调试的测试载体项目
├── package.json        # 根目录配置定义
└── pnpm-workspace.yaml # Monorepo 工作区定义
```

InkOS 采用 Monorepo 结构，划分为三个核心逻辑边界明确的 `packages`：

### 2.1 `packages/core` (核心引擎层)
系统的“大脑”，处于最底层，不关心展示形态。
- **`agents/`**: 存放所有独立职责的智能体实现（Writer、Auditor、Planner、Architect、Normalizer、Reviser 等）。每个 Agent 都有专属的 Prompt 生成器和结果解析器/验证器。
- **`pipeline/`**: 管线生命周期管理及调度器（Runner）。控制 Agent 之间的顺序调用、重试机制、错误处理以及环路控制（例如：审计不通过 -> 修订 -> 反复循环）。
- **`state/`**: 真相文件（Truth Files）存储与持久化逻辑。包括 Markdown 到 JSON 的映射转换、Zod 结构校验和 SQLite 时序数据管理。
- **`interaction/`**: 统一交互内核（Interaction Kernel），用于解析人类自然语言输入或来自其他 Agent（如 OpenClaw）的 JSON Payload 并转化为执行意图（Intent）。

### 2.2 `packages/cli` (命令行接口层)
负责系统与用户的终端交互。
- 采用 `commander` 提供所有原子和组合命令（`inkos book create`, `inkos write next`, `inkos audit`）。
- **TUI 仪表盘**: 使用 `Ink`（基于 React 的终端 UI 库）渲染互动式控制面板。
- 基于 `packages/core` 提供能力，处理命令行的输入输出及进程生命周期。

### 2.3 `packages/studio` (Web 工作台层)
提供可视化操作的辅助面板。
- 后端使用 `Hono` 构建轻量 API 路由，对接 `core` 和本地文件系统。
- 前端使用 `Vite + React`，提供页面组件处理（全书设定查看、章节审核、系统状态大盘监控）。
- 可完全无缝联动 CLI 终端数据，作为增强型体验附加组件。

### 2.4 其他辅助模块
- **scripts 脚本层**：统一收纳诸如发布前的 `workspace:*` 协议过滤转换脚本（例如 `verify-no-workspace-protocol.mjs` 等），保障向 NPM 发布的各个包的独立性和健康度。
- **skills (技能集成定义)**：开放定义的 "openclaw-skill"。使 InkOS 的文本创作能力（或单个执行流）能够遵循特定 AI Agent 契约抛出为标准 skill，随时可被其他高级智能调度中心接管和调用。

## 3. 核心管线与数据流 (Pipeline & Agent Flow)

从生成一章小说，系统经历一条严格的有向无环图（DAG）流转（附带部分重试环路）：

1. **Radar (雷达)**: *[可选]* 扫描市场和网络趋势，提供外部流行偏好反馈。
2. **Planner (规划师)**: 评估 `author_intent.md`（作者长期意图）与 `current_focus.md`（当前焦点），提出当前章节的具体任务（须保留和须避免的情节）。
3. **Composer (编排师)**: 从全量“真相文件”数据库中 RAG（检索增强生成）出与当前章节最相关的上下文及特定世界观规则，产出精简的 `context.json` 和 `rule-stack.yaml`。
4. **Architect (建筑师)**: 将本章目标转化为可执行的微观场景大纲与节点节拍（Scenes & Beats）。
5. **Writer (写手)**: 基于前面的所有设定和限制，生成本章正文。内部集成去 AI 味防御系统（敏感词及句式降级），进行初步字数控制。
6. **Observer (观察者)**: 细粒度读取刚写出的初稿，强制提取 9 大类客观事实变更（位置移动、角色见面、物品消耗等）。
7. **Reflector (反射器)**: 梳理 Observer 提取的变更，采用 JSON delta diff 的机制准备去修改"真相文件"，过程中经过 Zod Schema 拦截非法状态。
8. **Normalizer (归一化器)**: 进行字数控制校验和拉伸压缩处理，确保内容保持在预设范围（不至于超出设定 Hard bounds）。
9. **Auditor (连续性审计员)**: 取出全量“真相文件”和当前书稿，进行 33 个维度的冷血比对！只要有维度评分不及格或者被标为重大连续性缺陷，阻断通过，抛给下一阶段。
10. **Reviser (修订者)**: 根据 Auditor 的意见进行专项改写纠偏，重新送交评审，直到通过（或转交人工介入）。

## 4. 存储与状态设计 (Truth Files 与持久化)

系统通过 **7 大核心真相文件** 维系状态的绝对一致性：
- `current_state.md` (当前全局状态)
- `particle_ledger.md` (资源/金钱/耐久度账本)
- `pending_hooks.md` (待回收的伏笔与留白)
- `chapter_summaries.md` (各章短摘要)
- `subplot_board.md` (支线及暗线任务看板)
- `emotional_arcs.md` (角色情绪及弧光变迁日志)
- `character_matrix.md` (角色好感度与互动矩阵)

在现代版本中，真相文件的数据权威为 `story/state/*.json` (强类型的 Zod Immutable State)，Markdown 仅仅是供人类查阅和轻度编辑的投影图层（Projection UI Layer）。
复杂的检索历史依靠自带引擎创建并维护的 `story/memory.db` (时序 SQLite)。

## 5. 控制面与运行时架构 (Control Plane & Runtime)

不同于暴力的在单一 Prompt 中塞积设定，InkOS 引入了类似 K8s 的“控制面与业务运行时分离”概念。
通过提供两个文件供人类用户/上层神级 Agent 修改：
- `story/author_intent.md` // 整体战略（全书风格、高概念）
- `story/current_focus.md` // 战术策略（最近3章必须把焦点拉回学院副本，或是收尾感情戏）

在运行时（每次执行 `inkos write next` 时）：
- 系统自动编译出 `story/runtime/chapter-XXXX.intent.md` 和 `context.json`。
- 全程解耦输入与状态变更，实现防劣化且极易容错重跑。

## 6. 开发者接入与扩展指南

### 6.1 开发调试流
```bash
# 克隆仓库后安装依赖
pnpm install

# 监听态与持续构建 (核心逻辑修改)
pnpm dev

# 使用本底代码运行命令行
cd test-project # 或任何临时书库目录
node ../packages/cli/dist/index.js write next
# 或配置 alias： alias inkos="node $(pwd)/packages/cli/dist/index.js"
```

### 6.2 新增一个 Agent / 命令的规范
若需要开发新的特性（例如：“自动翻译器” Agent 或针对不同网站的“导出打包器”）：
1. 在 `packages/core/src/agents/` 创建 Agent 类，须继承相应的基类。定义其 LLM Prompt 及输入 Zod Validator、输出 Parser。
2. 若涉及流程修改，将其嵌入 `packages/core/src/pipeline/runner.ts` 适当的拓扑位置。
3. 在 `packages/cli/src/commands/` 下封装供终端人类调用的入口逻辑。

### 6.3 统一交互内核的接入 (第三方 Agent 调用)
InkOS 提供 `/interact` 共享路由。如果上层 Agent（如直接来自 ClawHub / Claude Code）向系统注入操作，请直接调用封装好的方法，这些方法遵循 JSON 严苛输入出境标准，避免屏幕污染。

---
*附：更多架构演进与接口细节，请详查 `packages/core` 相关定义与类型源码，以严格强类型为第一准则。*
