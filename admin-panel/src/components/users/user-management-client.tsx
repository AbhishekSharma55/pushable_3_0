'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Download, Plus, MoreHorizontal,
  Eye, Pencil, Trash2, KeyRound, Ban, CheckCircle2,
  ChevronLeft, ChevronRight, Mail, Building2, Coins,
  CalendarDays, UserX, Users, Activity,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminUser, blockUser, unblockUser, deleteUser, updateUser, resetPassword } from '@/app/actions/users'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuDestructiveItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SheetRoot, SheetContent } from '@/components/ui/sheet'
import { DialogRoot, DialogContent } from '@/components/ui/dialog'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

const COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#f43f5e','#84cc16','#f97316']

function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

function getPlan(c: number | null): 'Free' | 'Pro' | 'Enterprise' {
  if (!c || c <= 1000) return 'Free'
  return c <= 10000 ? 'Pro' : 'Enterprise'
}

function getUsage(consumed: number | null, total: number | null) {
  if (!consumed || !total || total === 0) return 0
  return Math.min(Math.round((consumed / total) * 100), 100)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Status = 'Active' | 'Blocked'
function getStatus(b: string | null): Status { return b ? 'Blocked' : 'Active' }

type SortKey = 'name' | 'email' | 'provider' | 'workspace' | 'role' | 'plan' | 'credits' | 'joined' | 'status'
type SortDir = 'asc' | 'desc'

function getSortValue(user: AdminUser, key: SortKey): string | number {
  switch (key) {
    case 'name': return user.name.toLowerCase()
    case 'email': return user.email.toLowerCase()
    case 'provider': return 'email'
    case 'workspace': return (user.workspace_name ?? '').toLowerCase()
    case 'role': return user.role ?? ''
    case 'plan': return user.plan_credits ?? 0
    case 'credits': return user.credits_balance ?? 0
    case 'joined': return user.created_at ?? ''
    case 'status': return user.blocked_at ? 1 : 0
  }
}

// ─── Tiny Components ────────────────────────────────────────────────────────

function StatusPill({ status, size = 'sm' }: { status: Status; size?: 'sm' | 'md' }) {
  const active = status === 'Active'
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full font-medium',
      size === 'sm' ? 'px-2 py-[3px] text-[11px]' : 'px-3 py-1 text-xs',
      active
        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/20'
        : 'bg-red-50 text-red-700 ring-1 ring-red-500/20',
    )}>
      <span className={cn('size-[5px] rounded-full', active ? 'bg-emerald-500' : 'bg-red-500')} />
      {status}
    </span>
  )
}

function PlanBadge({ plan }: { plan: 'Free' | 'Pro' | 'Enterprise' }) {
  return (
    <Badge variant={plan === 'Enterprise' ? 'purple' : plan === 'Pro' ? 'blue' : 'muted'} className="font-medium">
      {plan}
    </Badge>
  )
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-muted-foreground/40">—</span>
  return (
    <Badge variant={role === 'owner' ? 'purple' : role === 'admin' ? 'blue' : 'muted'} className="font-medium">
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </Badge>
  )
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

function UserDetailDrawer({
  user, open, onClose, onBlock, onUnblock, onDelete, onEdit, onResetPassword,
}: {
  user: AdminUser | null; open: boolean; onClose: () => void
  onBlock: (id: string) => void; onUnblock: (id: string) => void; onDelete: (id: string) => void
  onEdit: (user: AdminUser) => void; onResetPassword: (user: AdminUser) => void
}) {
  if (!user) return null
  const status = getStatus(user.blocked_at)
  const plan = getPlan(user.plan_credits)
  const usage = getUsage(user.total_credits_consumed, user.plan_credits)
  const color = avatarColor(user.id)

  return (
    <SheetRoot open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent title="User Details">
        {/* Header */}
        <div className="bg-linear-to-b from-muted/50 to-transparent px-8 pt-8 pb-6">
          <div className="flex items-start gap-4 pr-8">
            <Avatar className="size-14 ring-4 ring-background shadow-lg">
              <AvatarFallback className="text-base font-bold text-white" style={{ backgroundColor: color }}>
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 pt-0.5">
              <h2 className="text-lg font-bold tracking-tight truncate">{user.name}</h2>
              <p className="text-[13px] text-muted-foreground truncate mt-0.5">{user.email}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <RoleBadge role={user.role} />
                <StatusPill status={status} size="md" />
              </div>
            </div>
          </div>
        </div>

        <Sec title="Workspace">
          <KV label="Name" icon={<Building2 className="size-3.5" />} value={user.workspace_name ?? '—'} />
          <KV label="ID" value={
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{user.workspace_id ?? '—'}</code>
          } />
        </Sec>

        <Sec title="Plan & Credits">
          <KV label="Plan" value={<PlanBadge plan={plan} />} />
          <KV label="Provider" icon={<Mail className="size-3.5" />} value="Email" />

          {/* Credit breakdown */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5 mt-1">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">Total Credits</span>
              <span className="text-[13px] font-semibold font-mono">
                {((user.plan_credits ?? 0) + (user.topup_credits ?? 0)).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">Plan Credits</span>
              <span className="text-[13px] font-mono">{user.plan_credits?.toLocaleString() ?? '0'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">Topup Credits</span>
              <span className="text-[13px] font-mono">{user.topup_credits?.toLocaleString() ?? '0'}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">Consumed</span>
              <span className="text-[13px] font-mono text-red-600">
                −{user.total_credits_consumed?.toLocaleString() ?? '0'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium">Remaining</span>
              <span className="text-[13px] font-bold font-mono text-emerald-600">
                {user.credits_balance?.toLocaleString() ?? '0'}
              </span>
            </div>
          </div>

          {/* Usage bar */}
          <div className="pt-1 space-y-1.5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Usage</span><span>{usage}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', usage > 80 ? 'bg-red-500' : usage > 60 ? 'bg-amber-500' : 'bg-emerald-500')}
                style={{ width: `${usage}%` }}
              />
            </div>
          </div>
        </Sec>

        <Sec title="Status">
          <div className="flex items-center justify-between">
            <StatusPill status={status} size="md" />
            <Button
              size="sm" variant={status === 'Active' ? 'destructive' : 'outline'}
              onClick={() => status === 'Active' ? onBlock(user.id) : onUnblock(user.id)}
            >
              {status === 'Active' ? <><Ban className="size-3.5" /> Block</> : <><CheckCircle2 className="size-3.5" /> Unblock</>}
            </Button>
          </div>
          <KV label="Joined" icon={<CalendarDays className="size-3.5" />} value={fmtDate(user.created_at)} />
        </Sec>

        <div className="p-6 space-y-2">
          <Button className="w-full justify-start gap-3" variant="outline" size="lg"
            onClick={() => { onClose(); onEdit(user) }}>
            <Pencil className="size-4 text-muted-foreground" /> Edit User
          </Button>
          <Button className="w-full justify-start gap-3" variant="outline" size="lg"
            onClick={() => { onClose(); onResetPassword(user) }}>
            <KeyRound className="size-4 text-muted-foreground" /> Reset Password
          </Button>
          <Button className="w-full justify-start gap-3" variant="destructive" size="lg"
            onClick={() => { onDelete(user.id); onClose() }}>
            <Trash2 className="size-4" /> Delete Account
          </Button>
        </div>
      </SheetContent>
    </SheetRoot>
  )
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-8 py-5 space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function KV({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground shrink-0">
        {icon && <span className="opacity-50">{icon}</span>}
        {label}
      </span>
      <span className="text-[13px] font-medium text-right">{value}</span>
    </div>
  )
}

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

function EditUserDialog({
  user, open, onClose, onSave,
}: {
  user: AdminUser | null; open: boolean; onClose: () => void
  onSave: (id: string, data: { name: string; email: string; role: string }) => void
}) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [role, setRole] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (user) {
      setName(user.name)
      setEmail(user.email)
      setRole(user.role ?? 'member')
    }
  }, [user])

  if (!user) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave(user!.id, { name, email, role })
    setSaving(false)
    onClose()
  }

  return (
    <DialogRoot open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Edit User">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Role</label>
            <SelectRoot value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </SelectRoot>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}

// ─── Reset Password Dialog ───────────────────────────────────────────────────

function ResetPasswordDialog({
  user, open, onClose,
}: {
  user: AdminUser | null; open: boolean; onClose: () => void
}) {
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (open) { setPassword(''); setConfirm(''); setError('') }
  }, [open])

  if (!user) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setSaving(true)
    await resetPassword(user!.id, password)
    setSaving(false)
    onClose()
  }

  return (
    <DialogRoot open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Reset Password">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-[13px] text-muted-foreground">
            Set a new password for <span className="font-medium text-foreground">{user.name}</span>
          </p>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">New Password</label>
            <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Confirm Password</label>
            <Input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError('') }} required />
          </div>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Resetting…' : 'Reset Password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function UserManagementClient({ initialUsers }: { initialUsers: AdminUser[] }) {
  const router = useRouter()
  const [users, setUsers]               = React.useState<AdminUser[]>(initialUsers)
  const [search, setSearch]             = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'All' | Status>('All')
  const [planFilter, setPlanFilter]     = React.useState<'All' | 'Free' | 'Pro' | 'Enterprise'>('All')
  const [selectedIds, setSelectedIds]   = React.useState<Set<string>>(new Set())
  const [page, setPage]                 = React.useState(1)
  const [perPage, setPerPage]           = React.useState(10)
  const [drawerUser, setDrawerUser]     = React.useState<AdminUser | null>(null)
  const [editUser, setEditUser]         = React.useState<AdminUser | null>(null)
  const [resetPwUser, setResetPwUser]   = React.useState<AdminUser | null>(null)
  const [loading, setLoading]           = React.useState<string | null>(null)
  const [sortKey, setSortKey]           = React.useState<SortKey | null>(null)
  const [sortDir, setSortDir]           = React.useState<SortDir>('asc')

  React.useEffect(() => { setPage(1) }, [search, statusFilter, planFilter])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortKey(null); setSortDir('asc') }
    } else {
      setSortKey(key); setSortDir('asc')
    }
    setPage(1)
  }

  const filtered = React.useMemo(() => {
    const list = users.filter((u: AdminUser) => {
      const s = getStatus(u.blocked_at)
      const q = search.toLowerCase()
      const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.workspace_name ?? '').toLowerCase().includes(q)
      return matchSearch && (statusFilter === 'All' || s === statusFilter) && (planFilter === 'All' || getPlan(u.plan_credits) === planFilter)
    })
    if (sortKey) {
      list.sort((a: AdminUser, b: AdminUser) => {
        const aVal = getSortValue(a, sortKey)
        const bVal = getSortValue(b, sortKey)
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [users, search, statusFilter, planFilter, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * perPage, safePage * perPage)
  const activeCount = users.filter((u) => !u.blocked_at).length
  const blockedCount = users.filter((u) => u.blocked_at).length
  const allSelected = paginated.length > 0 && selectedIds.size === paginated.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < paginated.length

  function toggleSelect(id: string) {
    setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelectedIds(selectedIds.size === paginated.length ? new Set() : new Set(paginated.map((u) => u.id)))
  }
  async function handleBlock(id: string) {
    setLoading(id); await blockUser(id)
    setUsers((p) => p.map((u) => u.id === id ? { ...u, blocked_at: new Date().toISOString() } : u))
    if (drawerUser?.id === id) setDrawerUser((u) => u ? { ...u, blocked_at: new Date().toISOString() } : u)
    setLoading(null)
  }
  async function handleUnblock(id: string) {
    setLoading(id); await unblockUser(id)
    setUsers((p) => p.map((u) => u.id === id ? { ...u, blocked_at: null } : u))
    if (drawerUser?.id === id) setDrawerUser((u) => u ? { ...u, blocked_at: null } : u)
    setLoading(null)
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this user? This cannot be undone.')) return
    await deleteUser(id)
    setUsers((p) => p.filter((u) => u.id !== id))
    setSelectedIds((p) => { const n = new Set(p); n.delete(id); return n })
    router.refresh()
  }
  async function handleBulkBlock() {
    for (const id of selectedIds) await blockUser(id)
    setUsers((p) => p.map((u) => selectedIds.has(u.id) ? { ...u, blocked_at: new Date().toISOString() } : u))
    setSelectedIds(new Set())
  }
  async function handleBulkUnblock() {
    for (const id of selectedIds) await unblockUser(id)
    setUsers((p) => p.map((u) => selectedIds.has(u.id) ? { ...u, blocked_at: null } : u))
    setSelectedIds(new Set())
  }
  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} users? This cannot be undone.`)) return
    for (const id of selectedIds) await deleteUser(id)
    setUsers((p) => p.filter((u) => !selectedIds.has(u.id)))
    setSelectedIds(new Set())
  }
  async function handleEditSave(id: string, data: { name: string; email: string; role: string }) {
    await updateUser(id, data)
    setUsers((p) => p.map((u) => u.id === id ? { ...u, name: data.name, email: data.email, role: data.role } : u))
    if (drawerUser?.id === id) setDrawerUser((u) => u ? { ...u, name: data.name, email: data.email, role: data.role } : u)
  }

  function exportCSV() {
    const rows = filtered.map((u) =>
      [u.name, u.email, u.workspace_name ?? '', u.role ?? '', getPlan(u.plan_credits), fmtDate(u.created_at), getStatus(u.blocked_at)].join(','))
    const csv = ['Name,Email,Workspace,Role,Plan,Joined,Status', ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'users.csv'; a.click()
  }

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ─ Top bar ─ */}
        <div className="shrink-0 border-b border-border bg-card">
          <div className="flex items-center justify-between px-6 py-5">
            <div className="flex items-center gap-6">
              <div>
                <h1 className="text-lg font-semibold tracking-tight">User Management</h1>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {users.length} users
                </p>
              </div>
              {/* Inline stats */}
              <div className="hidden lg:flex items-center gap-1 ml-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground">
                  <Users className="size-3.5 text-indigo-500" />
                  {users.length} total
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                  <Activity className="size-3.5" />
                  {activeCount} active
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-700">
                  <Ban className="size-3.5" />
                  {blockedCount} blocked
                </span>
              </div>
            </div>
            <Button size="sm">
              <Plus className="size-4" /> Add User
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2.5 px-6 pb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                placeholder="Search users…"
                className="h-8 pl-9 text-[13px] bg-muted/40 border-transparent focus-visible:border-border focus-visible:bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <SelectRoot value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-28 h-8 text-[12px] bg-muted/40 border-transparent">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Blocked">Blocked</SelectItem>
              </SelectContent>
            </SelectRoot>
            <SelectRoot value={planFilter} onValueChange={(v) => setPlanFilter(v as typeof planFilter)}>
              <SelectTrigger className="w-28 h-8 text-[12px] bg-muted/40 border-transparent">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Plans</SelectItem>
                <SelectItem value="Free">Free</SelectItem>
                <SelectItem value="Pro">Pro</SelectItem>
                <SelectItem value="Enterprise">Enterprise</SelectItem>
              </SelectContent>
            </SelectRoot>
            <Button variant="ghost" size="sm" onClick={exportCSV} className="text-[12px] text-muted-foreground ml-auto">
              <Download className="size-3.5" /> Export
            </Button>
          </div>

          {/* Bulk bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 border-t border-indigo-100 bg-indigo-50/60 px-6 py-2.5">
              <span className="text-[12px] font-semibold text-indigo-700">
                {selectedIds.size} selected
              </span>
              <div className="ml-auto flex gap-1.5">
                <Button size="xs" variant="outline" onClick={handleBulkBlock}>Block</Button>
                <Button size="xs" variant="outline" onClick={handleBulkUnblock}>Unblock</Button>
                <Button size="xs" variant="destructive" onClick={handleBulkDelete}>Delete</Button>
              </div>
            </div>
          )}
        </div>

        {/* ─ Table ─ */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur-sm">
              <tr className="border-b border-border">
                <th className="w-11 pl-6 pr-2 py-2.5">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <Th sortKey="name" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>User</Th>
                <Th sortKey="email" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Email</Th>
                <Th sortKey="provider" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Provider</Th>
                <Th sortKey="workspace" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Workspace</Th>
                <Th sortKey="role" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Role</Th>
                <Th sortKey="plan" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Plan</Th>
                <Th sortKey="credits" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Credits</Th>
                <Th sortKey="joined" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Joined</Th>
                <Th sortKey="status" currentSort={sortKey} sortDir={sortDir} onSort={toggleSort}>Status</Th>
                <th className="w-11 pr-6 py-2.5" />
              </tr>
            </thead>
            <tbody className="bg-card">
              {paginated.map((user) => {
                const status = getStatus(user.blocked_at)
                const plan = getPlan(user.plan_credits)
                const color = avatarColor(user.id)
                const isLoading = loading === user.id
                const selected = selectedIds.has(user.id)

                return (
                  <tr
                    key={user.id}
                    onClick={() => setDrawerUser(user)}
                    className={cn(
                      'group border-b border-border/50 transition-colors cursor-pointer',
                      selected ? 'bg-indigo-50/50' : 'hover:bg-muted/20',
                    )}
                  >
                    <td className="pl-6 pr-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected} onCheckedChange={() => toggleSelect(user.id)} />
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8">
                          <AvatarFallback className="text-[10px] font-bold text-white" style={{ backgroundColor: color }}>
                            {getInitials(user.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium whitespace-nowrap">{user.name}</span>
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{user.email}</td>

                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        <Mail className="size-2.5" /> Email
                      </span>
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {user.workspace_name
                        ? <span className="inline-flex items-center gap-1.5"><Building2 className="size-3 text-muted-foreground/40" />{user.workspace_name}</span>
                        : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                    </td>

                    <td className="px-3 py-2.5"><RoleBadge role={user.role} /></td>
                    <td className="px-3 py-2.5"><PlanBadge plan={plan} /></td>

                    <td className="px-3 py-2.5 font-mono text-[12px] tabular-nums">
                      {user.credits_balance != null ? user.credits_balance.toLocaleString() : <span className="text-muted-foreground/40">—</span>}
                    </td>

                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(user.created_at)}</td>

                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        disabled={isLoading}
                        onClick={() => status === 'Active' ? handleBlock(user.id) : handleUnblock(user.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-medium ring-1 transition-all',
                          status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20 hover:ring-emerald-500/40'
                            : 'bg-red-50 text-red-700 ring-red-500/20 hover:ring-red-500/40',
                          isLoading && 'opacity-50 cursor-wait',
                        )}
                      >
                        <span className={cn('size-[5px] rounded-full', status === 'Active' ? 'bg-emerald-500' : 'bg-red-500')} />
                        {status}
                      </button>
                    </td>

                    <td className="pr-6 pl-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuRoot>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDrawerUser(user)}>
                            <Eye className="size-3.5" /> View Profile
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditUser(user)}><Pencil className="size-3.5" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setResetPwUser(user)}><KeyRound className="size-3.5" /> Reset Password</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {status === 'Active'
                            ? <DropdownMenuItem onClick={() => handleBlock(user.id)}><Ban className="size-3.5" /> Block</DropdownMenuItem>
                            : <DropdownMenuItem onClick={() => handleUnblock(user.id)}><CheckCircle2 className="size-3.5" /> Unblock</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuDestructiveItem onClick={() => handleDelete(user.id)}>
                            <Trash2 className="size-3.5" /> Delete
                          </DropdownMenuDestructiveItem>
                        </DropdownMenuContent>
                      </DropdownMenuRoot>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {paginated.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-32 text-muted-foreground bg-card">
              <UserX className="size-8 opacity-20" />
              <p className="text-[13px]">No users found</p>
            </div>
          )}
        </div>

        {/* ─ Pagination footer ─ */}
        <div className="shrink-0 flex items-center justify-between border-t border-border bg-card px-6 py-2.5 text-[12px] text-muted-foreground">
          <span>
            {filtered.length === 0 ? '0 results' : `${(safePage - 1) * perPage + 1}–${Math.min(safePage * perPage, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <SelectRoot value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1) }}>
              <SelectTrigger className="w-[60px] h-7 text-[11px] border-transparent bg-muted/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </SelectRoot>
            <div className="flex items-center">
              <Button size="icon" variant="ghost" className="size-7" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="min-w-10 text-center text-[11px]">{safePage}/{totalPages}</span>
              <Button size="icon" variant="ghost" className="size-7" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <UserDetailDrawer
        user={drawerUser} open={!!drawerUser}
        onClose={() => setDrawerUser(null)}
        onBlock={handleBlock} onUnblock={handleUnblock} onDelete={handleDelete}
        onEdit={(u) => setEditUser(u)}
        onResetPassword={(u) => setResetPwUser(u)}
      />

      <EditUserDialog
        user={editUser} open={!!editUser}
        onClose={() => setEditUser(null)}
        onSave={handleEditSave}
      />

      <ResetPasswordDialog
        user={resetPwUser} open={!!resetPwUser}
        onClose={() => setResetPwUser(null)}
      />
    </>
  )
}

function Th({ children, sortKey: key, currentSort, sortDir, onSort }: {
  children: React.ReactNode
  sortKey: SortKey
  currentSort: SortKey | null
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = currentSort === key
  return (
    <th
      className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active
          ? (sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
          : <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-30" />}
      </span>
    </th>
  )
}
