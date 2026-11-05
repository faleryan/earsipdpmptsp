import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-accent text-accent-foreground',
      navy: 'bg-navy text-white',
      success: 'bg-[#e3f4ec] text-[#16704a]',
      warning: 'bg-[#fbf0dc] text-[#8a5a12]',
      danger: 'bg-[#fbe5e3] text-[#a12a24]',
      muted: 'bg-muted text-muted-foreground',
      outline: 'border border-border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
