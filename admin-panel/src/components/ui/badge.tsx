import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary/10 text-primary',
        secondary:   'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/10 text-destructive',
        outline:     'border border-border text-foreground',
        success:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        warning:     'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400',
        danger:      'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
        blue:        'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400',
        purple:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
        muted:       'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
