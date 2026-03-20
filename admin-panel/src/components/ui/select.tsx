'use client'

import * as React from 'react'
import { Select } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

function SelectRoot(props: React.ComponentProps<typeof Select.Root>) {
  return <Select.Root {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Select.Trigger>) {
  return (
    <Select.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-3 text-sm text-foreground',
        'data-[placeholder]:text-muted-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      <Select.Icon>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Select.Icon>
    </Select.Trigger>
  )
}

function SelectValue(props: React.ComponentProps<typeof Select.Value>) {
  return <Select.Value {...props} />
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Select.Content>) {
  return (
    <Select.Portal>
      <Select.Content
        position="popper"
        sideOffset={4}
        className={cn(
          'relative z-50 max-h-60 min-w-[var(--radix-select-trigger-width)] overflow-hidden',
          'rounded-lg border border-border bg-popover text-popover-foreground shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      >
        <Select.Viewport className="p-1">{children}</Select.Viewport>
      </Select.Content>
    </Select.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Select.Item>) {
  return (
    <Select.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <Select.ItemIndicator>
          <Check className="size-3" />
        </Select.ItemIndicator>
      </span>
      <Select.ItemText>{children}</Select.ItemText>
    </Select.Item>
  )
}

export { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem }
