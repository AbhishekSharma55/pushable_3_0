'use client'

import * as React from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

function SheetRoot(props: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root {...props} />
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof Dialog.Overlay>) {
  return (
    <Dialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  title = 'Details',
  ...props
}: React.ComponentProps<typeof Dialog.Content> & { title?: string }) {
  return (
    <Dialog.Portal>
      <SheetOverlay />
      <Dialog.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 h-full w-[500px] max-w-full bg-background shadow-2xl',
          'border-l border-border overflow-y-auto',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          'duration-300 ease-in-out',
          className
        )}
        {...props}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
        <Dialog.Close
          className={cn(
            'absolute right-4 top-4 rounded-lg p-1.5 opacity-60 transition-opacity hover:opacity-100',
            'focus:outline-none focus:ring-2 focus:ring-ring',
          )}
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export { SheetRoot, SheetContent }
