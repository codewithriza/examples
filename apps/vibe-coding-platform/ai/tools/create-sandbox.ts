import type { UIMessageStreamWriter, UIMessage } from 'ai'
import type { DataPart } from '../messages/data-parts'
import { Sandbox } from '@vercel/sandbox'
import { databaseNameFor, provisionDatabase } from '@/lib/infrastructure/neon'
import { getRichError } from './get-rich-error'
import { tool } from 'ai'
import description from './create-sandbox.md'
import z from 'zod/v3'

interface Params {
  writer: UIMessageStreamWriter<UIMessage<never, DataPart>>
  sessionId: string
}

export const createSandbox = ({ writer, sessionId }: Params) =>
  tool({
    description,
    inputSchema: z.object({
      timeout: z
        .number()
        .min(600000)
        .max(2700000)
        .optional()
        .describe(
          'Maximum time in milliseconds the Vercel Sandbox will remain active before automatically shutting down. Minimum 600000ms (10 minutes), maximum 2700000ms (45 minutes). Defaults to 600000ms (10 minutes). The sandbox will terminate all running processes when this timeout is reached.'
        ),
      ports: z
        .array(z.number())
        .max(2)
        .optional()
        .describe(
          'Array of network ports to expose and make accessible from outside the Vercel Sandbox. These ports allow web servers, APIs, or other services running inside the Vercel Sandbox to be reached externally. Common ports include 3000 (Next.js), 8000 (Python servers), 5000 (Flask), etc.'
        ),
    }),
    execute: async ({ timeout, ports }, { toolCallId }) => {
      writer.write({
        id: toolCallId,
        type: 'data-create-sandbox',
        data: { status: 'loading' },
      })

      const dbCallId = `${toolCallId}-db`
      const databaseName = databaseNameFor(sessionId)
      writer.write({
        id: dbCallId,
        type: 'data-provision-database',
        data: { status: 'provisioning', databaseName },
      })

      let provisionedUrl: string | null = null
      try {
        provisionedUrl = await provisionDatabase(sessionId)
      } catch (err) {
        console.error('[createSandbox] Neon provisioning threw:', err)
      }
      const isDbReady = Boolean(provisionedUrl)

      writer.write({
        id: dbCallId,
        type: 'data-provision-database',
        data: isDbReady
          ? { status: 'ready', databaseName }
          : {
              status: 'unavailable',
              databaseName,
              error: { message: 'Neon database could not be provisioned' },
            },
      })

      try {
        const sandbox = await Sandbox.create({
          timeout: timeout ?? 600000,
          ports,
        })

        writer.write({
          id: toolCallId,
          type: 'data-create-sandbox',
          data: { sandboxId: sandbox.sandboxId, status: 'done' },
        })

        const dbLine = isDbReady
          ? `\nA Neon PostgreSQL database is available at process.env.DATABASE_URL (pooled).`
          : `\nNo database is available in this sandbox; operate in-memory only.`

        return (
          `Sandbox created with ID: ${sandbox.sandboxId}.` +
          `\nYou can now upload files, run commands, and access services on the exposed ports.` +
          dbLine
        )
      } catch (error) {
        const richError = getRichError({
          action: 'Creating Sandbox',
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-create-sandbox',
          data: {
            error: { message: richError.error.message },
            status: 'error',
          },
        })

        console.log('Error creating Sandbox:', richError.error)
        return richError.message
      }
    },
  })
