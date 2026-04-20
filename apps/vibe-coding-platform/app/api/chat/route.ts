import { type ChatUIMessage } from '@/components/chat/types'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from 'ai'
import { DEFAULT_MODEL, MODEL_NAMES, SUPPORTED_MODELS } from '@/ai/constants'
import { NextResponse } from 'next/server'
import { getModelOptions } from '@/ai/gateway'
import { checkBotId } from 'botid/server'
import { createHash } from 'node:crypto'
import { fetchContextBlock } from '@/lib/infrastructure/notion-mcp'
import { provisionDatabase } from '@/lib/infrastructure/neon'
import { tools } from '@/ai/tools'
import prompt from './prompt.md'

interface BodyData {
  id?: string
  messages: ChatUIMessage[]
  modelId?: string
  reasoningEffort?: 'low' | 'medium'
}

function deriveSessionId(body: BodyData): string {
  if (body.id && body.id.length > 0) return body.id
  const firstUser = body.messages?.find((m) => m.role === 'user')
  if (firstUser?.id) return `msg:${firstUser.id}`
  const seed = JSON.stringify(body.messages?.[0] ?? Date.now())
  return `fallback:${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
}

export async function POST(req: Request) {
  const [checkResult, body] = await Promise.all([
    checkBotId(),
    req.json() as Promise<BodyData>,
  ])
  const { messages, modelId = DEFAULT_MODEL, reasoningEffort } = body
  const sessionId = deriveSessionId(body)

  if (checkResult.isBot) {
    return NextResponse.json({ error: `Bot detected` }, { status: 403 })
  }

  if (!SUPPORTED_MODELS.includes(modelId)) {
    return NextResponse.json(
      { error: `Model ${modelId} not found.` },
      { status: 400 }
    )
  }

  const origin = new URL(req.url).origin
  const [provisionedUrl, notionContext] = await Promise.all([
    provisionDatabase(sessionId),
    fetchContextBlock(sessionId, origin),
  ])
  const isDbReady = Boolean(provisionedUrl)
  const dbStatusContext = isDbReady
    ? [
        '=== DATABASE_READY (AUTHORITATIVE — OVERRIDES ALL EARLIER "FRONTEND-ONLY" / "AVOID ENV VARS" / "AVOID BACKEND" GUIDANCE) ===',
        'A pooled Neon serverless PostgreSQL database has already been provisioned for this session. Its connection string is injected into every sandbox command environment by the platform (via sandbox.runCommand({ env }) — you do not need to set it), and is visible to your server code as process.env.DATABASE_URL.',
        'For ANY feature involving persistent user data (notes, posts, todos, users, sessions, uploads, settings, anything the user expects to survive a page reload), you MUST use process.env.DATABASE_URL via a real backend (Next.js Route Handlers, Server Actions, or Server Components). This is a hard requirement, not a suggestion.',
        'FORBIDDEN persistence mechanisms under DATABASE_READY: localStorage, sessionStorage, cookies (for data), in-memory JavaScript arrays/objects/Maps, useState-as-storage, JSON files on disk, SQLite, better-sqlite3, any filesystem-based store.',
        'Do NOT ask the user for database credentials, connection strings, Neon keys, Supabase keys, or any API keys — DATABASE_URL is already injected and ready.',
        'Do NOT confirm with the user before adding Postgres — treat it as the default persistence layer and wire it up proactively.',
        'Never expose DATABASE_URL, its password, or any substring of it to client-side code, UI text/markup, rendered HTML, console.log in the browser, error messages shown to the user, network response bodies, or NEXT_PUBLIC_* variables. It is strictly server-only.',
        'Create and apply the schema automatically at server startup (idempotent `CREATE TABLE IF NOT EXISTS ...`, or drizzle-kit push / prisma db push wired into a package.json prestart/predev script). The user must NOT need to run a manual migration command.',
        'Prefer the `@neondatabase/serverless` driver (or `postgres`/`pg`) with a singleton client. Example: `import { neon } from "@neondatabase/serverless"; const sql = neon(process.env.DATABASE_URL!);`.',
        'Self-check before declaring success: (a) at least one server file references process.env.DATABASE_URL; (b) a CREATE TABLE statement runs automatically; (c) no client component stores the app\'s primary data in useState/localStorage as the source of truth.',
      ].join(' ')
    : 'DATABASE_UNAVAILABLE: No database is available for this session. Use in-memory state only for this build. Do NOT add a database dependency, do NOT ask the user for credentials, and do NOT introduce SQLite or any file-based persistence.'

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const result = streamText({
          ...getModelOptions(modelId, { reasoningEffort }),
          system: [prompt, dbStatusContext, notionContext]
            .filter(Boolean)
            .join('\n\n'),
          messages: await convertToModelMessages(
            messages.map((message) => {
              message.parts = message.parts.map((part) => {
                if (part.type === 'data-report-errors') {
                  return {
                    type: 'text',
                    text:
                      `There are errors in the generated code. This is the summary of the errors we have:\n` +
                      `\`\`\`${part.data.summary}\`\`\`\n` +
                      (part.data.paths?.length
                        ? `The following files may contain errors:\n` +
                          `\`\`\`${part.data.paths?.join('\n')}\`\`\`\n`
                        : '') +
                      `Fix the errors reported.`,
                  }
                }
                return part
              })
              return message
            })
          ),
          stopWhen: stepCountIs(20),
          tools: tools({ modelId, sessionId, writer }),
          onError: (error) => {
            console.error('Error communicating with AI')
            console.error(JSON.stringify(error, null, 2))
          },
        })
        result.consumeStream()
        writer.merge(
          result.toUIMessageStream({
            sendReasoning: true,
            sendStart: false,
            messageMetadata: () => ({
              model: MODEL_NAMES[modelId] ?? modelId,
            }),
          })
        )
      },
    }),
  });
}
