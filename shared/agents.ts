import { z } from 'zod'

// 两个带工具的 Agent（决策 0028）。工具的参数格式写在这里，服务端用它生成给模型的工具说明，
// App 用它校验模型给的参数，两边不会对不上。工具本身在手机上执行

export const AGENT_KINDS = ['ask', 'locate'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export const MAX_AGENT_STEPS = 6 // 一次最多调用模型几轮
export const MAX_AGENT_CHARS = 40_000 // 整段对话的总字数上限
export const MAX_TOOL_RESULT_CHARS = 4000 // 每个工具结果截到多少字
export const MAX_QUESTION_CHARS = 200

const day = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/)
  .describe('日期，YYYY-MM-DD 或 YYYY-MM')

type Tool = { description: string; args: z.ZodObject }

// 问问我的足迹
export const ASK_TOOLS = {
  search_records: {
    description:
      '在用户的记录里找。所有条件都可以不填；填了的同时满足。返回最多 12 条记录的摘要，带编号',
    args: z.object({
      keywords: z
        .string()
        .nullable()
        .describe(
          '要找的词，多个词用空格隔开，比如"面 排队"。不按词找就填 null',
        ),
      city: z.string().nullable().describe('城市名，比如"杭州"；不限就填 null'),
      category: z
        .string()
        .nullable()
        .describe('类别，比如"美食""风景""展览"；不限就填 null'),
      from: day.nullable().describe('从哪天起（含），不限填 null'),
      to: day.nullable().describe('到哪天止（含），不限填 null'),
    }),
  },
  stats: {
    description:
      '数数：按城市、类别、年份或月份分组，给出每组的记录数、天数、第一次和最近一次的日期。问"几次""多少""哪个最多""第一次是什么时候"时用它，不要自己数',
    args: z.object({
      groupBy: z.enum(['city', 'category', 'year', 'month']),
      city: z.string().nullable().describe('只统计这个城市，不限填 null'),
      category: z.string().nullable().describe('只统计这个类别，不限填 null'),
      from: day.nullable(),
      to: day.nullable(),
    }),
  },
  get_record: {
    description: '看一条记录的全文',
    args: z.object({ id: z.string().describe('search_records 给的编号') }),
  },
  answer: {
    description:
      '给出最终回答。只能根据工具查到的内容回答；查不到就直说没有找到',
    args: z.object({
      text: z.string().max(600).describe('回答，中文，简短'),
      recordIds: z
        .array(z.string())
        .max(12)
        .describe('回答用到的记录编号，没有就是空数组'),
    }),
  },
} satisfies Record<string, Tool>

// 帮我找地点
export const LOCATE_TOOLS = {
  record_clues: {
    description:
      '这条记录里的线索：原话、AI 写的标题和正文、AI 从照片里猜的地名、照片里的电话和车牌，以及电话区号和车牌查表得出的城市',
    args: z.object({}),
  },
  same_day_places: {
    description:
      '同一天有定位的其他记录：时间和地名。每个地方有编号，可以直接用在 propose 里',
    args: z.object({}),
  },
  past_places: {
    description: '以前去过、地名里含有某个词的地方，每个有编号',
    args: z.object({ keyword: z.string().min(1).max(30) }),
  },
  search_place: {
    description:
      '按名字查地点（地图服务），最多 5 个结果，每个有编号。名字前面加上城市更准，比如"杭州 知味观"',
    args: z.object({ query: z.string().min(1).max(60) }),
  },
  propose: {
    description:
      '给出最终的候选地点，最多 3 个，最可能的在前。每个候选必须是工具结果里出现过的编号；找不到就给空数组',
    args: z.object({
      candidates: z
        .array(
          z.object({
            ref: z.string().describe('工具结果里的编号，比如 d1、p2、s1-3'),
            evidence: z
              .string()
              .max(200)
              .describe(
                '为什么是这里，写出依据，比如"电话区号 0571 → 杭州；同一天 14:00 在西湖"',
              ),
          }),
        )
        .max(3),
      note: z.string().max(200).nullable().describe('补充说明，没有就填 null'),
    }),
  },
} satisfies Record<string, Tool>

export const AGENT_TOOLS: Record<AgentKind, Record<string, Tool>> = {
  ask: ASK_TOOLS,
  locate: LOCATE_TOOLS,
}
export const FINAL_TOOL: Record<AgentKind, string> = {
  ask: 'answer',
  locate: 'propose',
}

// OpenAI 兼容格式的对话消息。App 存着整段对话，每轮整段发给服务端（服务端不存）
const toolCall = z.object({
  id: z.string().max(100),
  type: z.literal('function'),
  function: z.object({
    name: z.string().max(40),
    arguments: z.string().max(4000),
  }),
})
export type ToolCall = z.infer<typeof toolCall>

export const agentMessage = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().nullable(),
    tool_calls: z.array(toolCall).max(8).optional(),
  }),
  z.object({
    role: z.literal('tool'),
    tool_call_id: z.string().max(100),
    content: z.string().max(MAX_TOOL_RESULT_CHARS + 200),
  }),
])
export type AgentMessage = z.infer<typeof agentMessage>

export const agentRequest = z
  .object({
    agent: z.enum(AGENT_KINDS),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // 用户手机上的今天，用来换算"去年""上个月"
    messages: z
      .array(agentMessage)
      .min(1)
      .max(MAX_AGENT_STEPS * 10),
  })
  .refine(
    (r) =>
      r.messages.filter((m) => m.role === 'assistant').length < MAX_AGENT_STEPS,
    { message: '步数超过上限' },
  )
  .refine((r) => JSON.stringify(r.messages).length <= MAX_AGENT_CHARS, {
    message: '对话太长',
  })
export type AgentRequest = z.infer<typeof agentRequest>

export const agentResponse = z.object({
  content: z.string().nullable(),
  toolCalls: z.array(toolCall),
})
export type AgentResponse = z.infer<typeof agentResponse>
