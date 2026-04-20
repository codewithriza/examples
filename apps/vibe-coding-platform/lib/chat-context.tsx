'use client'

import { type ChatUIMessage } from '@/components/chat/types'
import { type ReactNode } from 'react'
import { Chat } from '@ai-sdk/react'
import { DataPart } from '@/ai/messages/data-parts'
import { DataUIPart } from 'ai'
import { createContext, useContext, useMemo, useRef } from 'react'
import { useDataStateMapper } from '@/app/state'
import { mutate } from 'swr'
import { toast } from 'sonner'

interface ChatContextValue {
  chat: Chat<ChatUIMessage>
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined)

const CHAT_ID_STORAGE_KEY = 'vibe.chat.id'

function getOrCreatePersistentChatId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const existing = window.localStorage.getItem(CHAT_ID_STORAGE_KEY)
    if (existing) return existing
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(CHAT_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    return undefined
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const mapDataToState = useDataStateMapper()
  const mapDataToStateRef = useRef(mapDataToState)
  mapDataToStateRef.current = mapDataToState

  const chat = useMemo(
    () =>
      new Chat<ChatUIMessage>({
        id: getOrCreatePersistentChatId(),
        onToolCall: () => mutate('/api/auth/info'),
        onData: (data: DataUIPart<DataPart>) => mapDataToStateRef.current(data),
        onError: (error) => {
          toast.error(`Communication error with the AI: ${error.message}`)
          console.error('Error sending message:', error)
        },
      }),
    []
  )

  return (
    <ChatContext.Provider value={{ chat }}>{children}</ChatContext.Provider>
  )
}

export function useSharedChatContext() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useSharedChatContext must be used within a ChatProvider')
  }
  return context
}
