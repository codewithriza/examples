'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SettingsIcon } from 'lucide-react'

export function SettingsButton() {
  return (
    <Button
      asChild
      className="cursor-pointer"
      variant="outline"
      size="sm"
      aria-label="Settings"
    >
      <Link href="/settings">
        <SettingsIcon />
        <span className="hidden lg:inline">Settings</span>
      </Link>
    </Button>
  )
}
