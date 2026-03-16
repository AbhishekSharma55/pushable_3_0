'use client';

import { useRouter } from 'next/navigation';
import { LogOut, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getUser, removeToken, removeUser } from '@/lib/auth';
import {
    WORKSPACES_KEY,
    ACTIVE_WORKSPACE_KEY,
} from '@/lib/constants';

export function Topbar() {
    const router = useRouter();
    const user = getUser();

    const handleLogout = () => {
        removeToken();
        removeUser();
        localStorage.removeItem(WORKSPACES_KEY);
        localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
        router.push('/login');
    };

    const initials = user?.name
        ? user.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : '?';

    return (
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end border-b border-border/50 bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        id="user-menu"
                        variant="ghost"
                        className="flex items-center gap-2 px-2"
                    >
                        <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <span className="hidden text-sm font-medium sm:inline-block">
                            {user?.name || 'User'}
                        </span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem disabled className="cursor-default opacity-50">
                        <User className="mr-2 h-4 w-4" />
                        Profile
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        id="logout-button"
                        onClick={handleLogout}
                        className="cursor-pointer text-destructive focus:text-destructive"
                    >
                        <LogOut className="mr-2 h-4 w-4" />
                        Log out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}
