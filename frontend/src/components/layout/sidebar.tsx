'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard,
    Bot,
    BookOpen,
    Zap,
    Wrench,
    CheckSquare,
    GitBranch,
    Clock,
    CreditCard,
    Radio,
    ChevronDown,
    Plus,
    Blocks,
    Globe,
    PlugZap,
    KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WORKSPACES_KEY, ACTIVE_WORKSPACE_KEY } from '@/lib/constants';
import { createWorkspace } from '@/lib/api/workspaces';
import type { Workspace } from '@/types';

const navItems = [
    { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Agents', href: '/agents', icon: Bot },
    {label: 'Integrations', href: '/integrations', icon: Blocks },
    { label: 'Browser', href: '/browser-profiles', icon: Globe },
    { label: 'Extension', href: '/extension-settings', icon: PlugZap },
    { label: 'Secrets', href: '/secrets', icon: KeyRound },
    { label: 'Knowledge Base', href: '/kb', icon: BookOpen },
    { label: 'Skills', href: '/skills', icon: Zap },
    { label: 'Tools', href: '/tools', icon: Wrench },
    { label: 'Tasks', href: '/tasks', icon: CheckSquare },
    { label: 'Workflows', href: '/workflows', icon: GitBranch },
    { label: 'Schedules', href: '/schedules', icon: Clock },
    { label: 'Credits', href: '/credits', icon: CreditCard },
    { label: 'Channels', href: '/channels', icon: Radio },
];

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const [showNewDialog, setShowNewDialog] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);

    // Get workspaces from localStorage
    const getWorkspacesFromStorage = (): Workspace[] => {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(WORKSPACES_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    };

    const getActiveWorkspace = (): Workspace | null => {
        if (typeof window === 'undefined') return null;
        try {
            const raw = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    };

    const [workspaces, setWorkspaces] = useState<Workspace[]>(
        getWorkspacesFromStorage
    );
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(
        getActiveWorkspace
    );

    const switchWorkspace = (ws: Workspace) => {
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(ws));
        window.location.href = '/';
    };

    const handleCreateWorkspace = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            const ws = await createWorkspace({ name: newName.trim() });
            const updated = [...workspaces, ws];
            setWorkspaces(updated);
            localStorage.setItem(WORKSPACES_KEY, JSON.stringify(updated));
            switchWorkspace(ws);
            setShowNewDialog(false);
            setNewName('');
            toast.success('Workspace created!');
        } catch {
            toast.error('Failed to create workspace');
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <aside className="fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-border/50 bg-sidebar">
                {/* Logo */}
                <div className="flex h-14 items-center gap-2 border-b border-border/50 px-4">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <Bot className="h-4 w-4" />
                    </div>
                    <span className="text-lg font-bold tracking-tight">Pushable AI</span>
                </div>

                {/* Workspace Switcher */}
                <div className="border-b border-border/50 p-3">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                id="workspace-switcher"
                                variant="outline"
                                className="w-full justify-between text-left font-normal"
                            >
                                <span className="truncate">
                                    {activeWorkspace?.name || 'Select workspace'}
                                </span>
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-56" align="start">
                            {workspaces.map((ws) => (
                                <DropdownMenuItem
                                    key={ws.id}
                                    onClick={() => switchWorkspace(ws)}
                                    className={cn(
                                        'cursor-pointer',
                                        ws.id === activeWorkspace?.id && 'bg-accent'
                                    )}
                                >
                                    {ws.name}
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => setShowNewDialog(true)}
                                className="cursor-pointer"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                New Workspace
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Nav */}
                <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
                    {navItems.map((item) => {
                        const isActive =
                            pathname === item.href ||
                            (item.href !== '/' && pathname.startsWith(item.href));
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                                    isActive
                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                )}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
            </aside>

            {/* Create workspace dialog */}
            <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New Workspace</DialogTitle>
                        <DialogDescription>
                            Add a new workspace to organize your AI agents
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="workspace-name">Workspace name</Label>
                            <Input
                                id="workspace-name"
                                placeholder="My Workspace"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowNewDialog(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            id="create-workspace-submit"
                            onClick={handleCreateWorkspace}
                            disabled={creating || !newName.trim()}
                        >
                            {creating ? 'Creating...' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
