'use client'

import { useActionState } from 'react'
import { loginAction } from '@/app/actions/auth'
import { Zap, Mail, Lock, ArrowRight, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null)

  return (
    <div className="flex min-h-screen">
      {/* ── Left: Branding Panel ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] shrink-0 flex-col justify-between bg-foreground p-10 text-background relative overflow-hidden">
        {/* Decorative elements */}
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full border border-background/5" />
        <div className="pointer-events-none absolute -bottom-32 -left-32 size-96 rounded-full border border-background/5" />

        {/* Top: Brand */}
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-background/10 bg-background/5">
            <Zap className="size-5" />
          </div>
          <span className="text-lg font-bold tracking-tight">Pushable</span>
        </div>

        {/* Center: Hero */}
        <div className="relative space-y-6">
          <h1 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            Admin Control<br />Center
          </h1>
          <p className="max-w-sm text-[15px] leading-relaxed text-background/60">
            Manage users, monitor resources, configure plans, and keep everything running smoothly.
          </p>
          <div className="flex flex-col gap-3 pt-2">
            <Feature text="Real-time user management" />
            <Feature text="Resource monitoring & analytics" />
            <Feature text="Plan & billing configuration" />
          </div>
        </div>

        {/* Bottom */}
        <p className="relative text-[12px] text-background/30">
          &copy; 2024 Pushable AI. All rights reserved.
        </p>
      </div>

      {/* ── Right: Login Form ── */}
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="w-full max-w-[400px]">
          {/* Mobile brand */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:items-start">
            <div className="flex size-11 items-center justify-center rounded-xl bg-foreground lg:hidden">
              <Zap className="size-5 text-background" />
            </div>
            <div className="text-center lg:text-left">
              <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
              <p className="mt-1.5 text-[14px] text-muted-foreground">Sign in to your admin account</p>
            </div>
          </div>

          {/* Card */}
          <div className="rounded-2xl border bg-card p-7 shadow-sm">
            <form action={formAction} className="space-y-5">
              {/* Error */}
              {state?.error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive">
                  <ShieldCheck className="size-4 shrink-0" />
                  {state.error}
                </div>
              )}

              {/* Email */}
              <div className="space-y-2">
                <label className="text-[13px] font-medium">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="admin@example.com"
                    className="h-11 pl-11 text-[14px]"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium">Password</label>
                  <button type="button" className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="h-11 pl-11 text-[14px]"
                  />
                </div>
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-2.5">
                <Checkbox id="remember" />
                <label htmlFor="remember" className="text-[13px] text-muted-foreground select-none cursor-pointer">
                  Remember me for 30 days
                </label>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={pending}
                className="h-11 w-full text-[14px] font-semibold"
                size="lg"
              >
                {pending ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>
          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-[12px] text-muted-foreground/60">
            Protected admin area &middot; Pushable AI
          </p>
        </div>
      </div>
    </div>
  )
}

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-background/70">
      <div className="flex size-5 items-center justify-center rounded-full border border-background/20">
        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      {text}
    </div>
  )
}
