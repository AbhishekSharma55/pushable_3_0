'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logoutAction } from '@/app/actions/auth'
import {
  LayoutDashboard,
  Users,
  Server,
  CreditCard,
  Settings,
  Zap,
  LogOut,
  Wrench,
  Radio,
  DollarSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard',          icon: LayoutDashboard },
  { href: '/users',     label: 'User Management',    icon: Users           },
  { href: '/monitoring',label: 'Resource Monitoring', icon: Server          },
  { href: '/tools',     label: 'Tools',               icon: Wrench          },
  { href: '/plans',     label: 'Plans Management',   icon: CreditCard      },
  { href: '/credit-ranges', label: 'Credit Ranges',     icon: DollarSign      },
  { href: '/channel-config', label: 'Channel Config',   icon: Radio           },
  { href: '/settings',  label: 'Configuration',      icon: Settings        },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r bg-card">
      {/* ── Brand ── */}
      <div className="flex h-16 items-center gap-3 px-6">
        <div className="flex size-9 items-center justify-center rounded-xl bg-foreground">
          <Zap className="size-4.5 text-background" />
        </div>
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold tracking-tight">
            Pushable
          </span>
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Admin
          </span>
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="mx-5 h-px bg-border" />

      {/* ── Nav Label ── */}
      <div className="px-6 pt-6 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Menu
        </span>
      </div>

      {/* ── Nav Links ── */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
                isActive
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon
                className={cn(
                  'size-4 shrink-0 transition-colors',
                  isActive ? 'text-background' : 'text-muted-foreground/70 group-hover:text-foreground',
                )}
              />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* ── Bottom section ── */}
      <div className="mx-5 h-px bg-border" />
      <div className="p-3">
        {/* User card */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-foreground text-[12px] font-bold text-background">
            A
          </div>
          <div className="flex flex-1 flex-col leading-tight">
            <span className="text-[13px] font-medium">Admin</span>
            <span className="text-[11px] text-muted-foreground">admin@example.com</span>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <LogOut className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
