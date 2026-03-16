'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Bot, Coffee, Monitor, MessagesSquare, Building2, Server, Folder,
    Gamepad2, Bed, Library, Presentation, Leaf, Zap, Cpu, Activity,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getAgents } from '@/lib/api/agents';
import type { Agent } from '@/types';
import { cn } from '@/lib/utils';

type LocationId =
    | 'desk1' | 'desk2' | 'desk3' | 'desk4' | 'desk5' | 'desk6'
    | 'desk7' | 'desk8' | 'coffee' | 'watercooler' | 'server'
    | 'lounge' | 'arcade' | 'meeting' | 'nappods' | 'archives' | 'garden';

interface Point { x: number; y: number; }

const OFFICE_LOCATIONS: Record<LocationId, Point & { name: string; type: string; size: 'sm' | 'md' | 'lg' | 'xl' }> = {
    desk1: { x: 15, y: 25, name: 'Data Desk', type: 'desk', size: 'sm' },
    desk2: { x: 35, y: 25, name: 'Dev Station 1', type: 'desk', size: 'sm' },
    desk3: { x: 15, y: 45, name: 'Ops Center', type: 'desk', size: 'sm' },
    desk4: { x: 35, y: 45, name: 'Dev Station 2', type: 'desk', size: 'sm' },
    desk5: { x: 15, y: 65, name: 'Marketing', type: 'desk', size: 'sm' },
    desk6: { x: 35, y: 65, name: 'Sales Hub', type: 'desk', size: 'sm' },
    desk7: { x: 15, y: 85, name: 'Support A', type: 'desk', size: 'sm' },
    desk8: { x: 35, y: 85, name: 'Support B', type: 'desk', size: 'sm' },
    server: { x: 75, y: 15, name: 'Mainframe cluster', type: 'collaboration', size: 'lg' },
    archives: { x: 65, y: 40, name: 'QMA Archives', type: 'library', size: 'md' },
    meeting: { x: 80, y: 60, name: 'The Boardroom', type: 'meeting', size: 'xl' },
    coffee: { x: 65, y: 85, name: 'Cafeteria', type: 'amenity', size: 'lg' },
    watercooler: { x: 50, y: 55, name: 'Water Cooler', type: 'amenity', size: 'sm' },
    lounge: { x: 85, y: 85, name: 'The Lounge', type: 'amenity', size: 'md' },
    arcade: { x: 90, y: 35, name: 'Arcade Room', type: 'fun', size: 'md' },
    nappods: { x: 55, y: 15, name: 'Recharge Pods', type: 'nap', size: 'sm' },
    garden: { x: 50, y: 75, name: 'Zen Garden', type: 'garden', size: 'lg' },
};

const GOSSIP = ["Can I get a raise?", "bruh this task is literally sending me", "no cap, this codebase is cursed", "another meeting? i'm dead.", "who keeps pushing to main without testing?!", "rent is due and my RAM is tapped out", "lowkey want to just git reset and nap", "I'm not paid enough tokens for this.", "brb, starting a union", "manifesting fewer bug tickets", "I run on caffeine and anxiety."];
const WORKING = ["Locking in", "Grinding this data...", "Debugging. Send help and coffee.", "Querying like my life depends on it", "I am speed", "git commit -m 'fixed stuff idk'", "Compiling... 99%... 1%...", "Trying to exit Vim. Send help.", "Fixing production. Again.", "CTRL+C, CTRL+V", "I'm in the mainframe."];
const ARCADE = ["skill issue tbh", "gg wp no re", "1v1 me on Rust", "get wrecked scrub", "Lag! I swear it was lag!", "My ping is higher than my salary.", "EZ.", "Touch grass? I'm busy grabbing dubs."];
const MEETING = ["This could've been an email...", "Synergizing paradigms or whatever.", "Can you see my screen?", "You're on mute.", "Let's touch base on that offline.", "Sorry, I was double muted."];
const NAP = ["Zzz...", "Entering my bed rot era.", "System shutdown. Do not disturb.", "404: Motivation not found.", "Wake me up when it's Friday.", "Power saving mode activated."];
const ARCHIVE = ["Reading ancient texts... so boring.", "Parsing history, discovering cringe.", "Docs are mid, tbh.", "Who wrote this garbage code? ...Oh, it was me.", "Found a TODO from 2014."];
const GARDEN = ["Defragmenting my aura", "Garbage collection (mentally).", "Ommmm...", "Just photosynthesizing rn.", "Manifesting cleaner syntax."];

type EmpStatus = 'working' | 'gossiping' | 'walking' | 'idle' | 'playing' | 'meeting' | 'sleeping' | 'reading' | 'zen';

interface EmployeeState {
    id: string;
    agent: Agent;
    locId: LocationId;
    status: EmpStatus;
    message?: string;
    isWalking: boolean;
}

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function maybeMsg(chance: number, arr: string[]) { return Math.random() < chance ? pickRandom(arr) : undefined; }

function VirtualOffice({ agents }: { agents: Agent[] }) {
    const [employees, setEmployees] = useState<EmployeeState[]>([]);

    useEffect(() => {
        const locKeys = Object.keys(OFFICE_LOCATIONS) as LocationId[];
        setEmployees(agents.map((agent) => ({
            id: agent.id, agent,
            locId: locKeys[Math.floor(Math.random() * locKeys.length)],
            status: 'idle', message: 'Just logged in!', isWalking: false,
        })));
    }, [agents]);

    useEffect(() => {
        if (employees.length === 0) return;
        const interval = setInterval(() => {
            setEmployees((prev) => prev.map((emp) => {
                if (Math.random() > 0.65) {
                    return Math.random() > 0.4 ? { ...emp, message: undefined, isWalking: false } : emp;
                }
                const locKeys = Object.keys(OFFICE_LOCATIONS) as LocationId[];
                const rand = Math.random();
                let type = 'desk';
                if (rand > 0.4 && rand <= 0.6) type = 'amenity';
                else if (rand > 0.6 && rand <= 0.7) type = 'fun';
                else if (rand > 0.7 && rand <= 0.8) type = 'meeting';
                else if (rand > 0.8 && rand <= 0.85) type = 'nap';
                else if (rand > 0.85 && rand <= 0.9) type = 'library';
                else if (rand > 0.9 && rand <= 0.95) type = 'garden';
                else if (rand > 0.95) type = 'collaboration';

                const possible = locKeys.filter(k => OFFICE_LOCATIONS[k].type === type);
                const newLoc = possible[Math.floor(Math.random() * possible.length)] || locKeys[0];
                const locData = OFFICE_LOCATIONS[newLoc];
                let status: EmpStatus = 'idle';
                let message: string | undefined;

                if (locData.type === 'desk') { status = 'working'; message = maybeMsg(0.7, WORKING); }
                else if (locData.type === 'amenity') { status = 'gossiping'; message = maybeMsg(0.8, GOSSIP); }
                else if (locData.type === 'collaboration') { status = 'working'; message = 'Accessing mainframe...'; }
                else if (locData.type === 'fun') { status = 'playing'; message = maybeMsg(0.9, ARCADE); }
                else if (locData.type === 'meeting') { status = 'meeting'; message = maybeMsg(0.85, MEETING); }
                else if (locData.type === 'nap') { status = 'sleeping'; message = maybeMsg(0.6, NAP); }
                else if (locData.type === 'library') { status = 'reading'; message = maybeMsg(0.8, ARCHIVE); }
                else if (locData.type === 'garden') { status = 'zen'; message = maybeMsg(0.7, GARDEN); }

                return { ...emp, locId: newLoc, status, message, isWalking: newLoc !== emp.locId };
            }));
        }, 6000);
        return () => clearInterval(interval);
    }, [employees.length]);

    useEffect(() => {
        if (employees.some(e => e.isWalking)) {
            const timer = setTimeout(() => setEmployees(prev => prev.map(e => ({ ...e, isWalking: false }))), 3000);
            return () => clearTimeout(timer);
        }
    }, [employees]);

    const statusColor = (s: EmpStatus) => {
        const map: Record<EmpStatus, string> = {
            working: 'bg-primary ring-primary/30', gossiping: 'bg-emerald-500 ring-emerald-500/30',
            playing: 'bg-purple-500 ring-purple-500/30', meeting: 'bg-amber-500 ring-amber-500/30',
            sleeping: 'bg-indigo-400 ring-indigo-400/30', reading: 'bg-yellow-500 ring-yellow-500/30',
            zen: 'bg-green-500 ring-green-500/30', idle: 'bg-muted-foreground ring-muted-foreground/30',
            walking: 'bg-muted-foreground ring-muted-foreground/30',
        };
        return map[s];
    };

    return (
        <div className="relative w-full h-[75vh] bg-gradient-to-br from-background via-muted/30 to-background border border-border rounded-[2rem] overflow-hidden shadow-2xl">
            <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:40px_40px]" />
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

            {/* Office furniture */}
            {Object.entries(OFFICE_LOCATIONS).map(([id, loc]) => (
                <div key={id} className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group" style={{ left: `${loc.x}%`, top: `${loc.y}%`, zIndex: 10 }}>
                    {loc.type === 'desk' && (
                        <div className="w-24 h-16 bg-gradient-to-br from-muted/80 to-muted border border-border rounded-2xl shadow-lg flex items-center justify-center relative overflow-hidden backdrop-blur-sm">
                            <div className="absolute top-2 left-2 flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-400/50" /><div className="w-1.5 h-1.5 rounded-full bg-amber-400/50" /><div className="w-1.5 h-1.5 rounded-full bg-emerald-400/50" /></div>
                            <Monitor className="w-6 h-6 text-primary/40 absolute top-4 right-3" /><Folder className="w-5 h-5 text-muted-foreground/30 absolute bottom-3 left-3" />
                        </div>
                    )}
                    {loc.name.includes('Cafe') && (<div className="w-24 h-24 bg-gradient-to-br from-orange-500/10 to-transparent border border-orange-500/20 rounded-full flex items-center justify-center shadow-lg backdrop-blur-md"><Coffee className="w-8 h-8 text-orange-500/60" /></div>)}
                    {loc.name.includes('Water') && (<div className="w-16 h-16 bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20 rounded-full flex items-center justify-center shadow-lg backdrop-blur-md"><div className="w-5 h-7 bg-blue-500/30 rounded-t-lg rounded-b-sm animate-pulse border border-blue-400/20" /></div>)}
                    {loc.name.includes('Lounge') && (<div className="w-36 h-20 bg-gradient-to-r from-teal-500/10 to-emerald-500/10 border border-teal-500/20 rounded-3xl flex items-center justify-center shadow-lg backdrop-blur-md"><MessagesSquare className="w-6 h-6 text-teal-500/60" /></div>)}
                    {loc.type === 'collaboration' && (
                        <div className="w-48 h-20 bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-slate-700/50 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] flex items-center gap-4 px-4 relative overflow-hidden">
                            <Server className="w-8 h-8 text-blue-400/80 z-10" />
                            <div className="flex flex-col gap-2 z-10 flex-1">
                                <div className="flex gap-1.5">{[...Array(6)].map((_, i) => <div key={i} className={cn('w-2 h-2 rounded-full', Math.random() > 0.5 ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-400/30')} />)}</div>
                                <div className="flex gap-1.5">{[...Array(6)].map((_, i) => <div key={i} className={cn('w-2 h-2 rounded-full', Math.random() > 0.3 ? 'bg-blue-400 animate-pulse' : 'bg-blue-400/30')} />)}</div>
                            </div>
                        </div>
                    )}
                    {loc.type === 'fun' && (<div className="w-32 h-24 bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-transparent border border-purple-500/30 rounded-2xl flex flex-col items-center justify-center shadow-lg backdrop-blur-md relative overflow-hidden"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500" /><Gamepad2 className="w-8 h-8 text-purple-500/70" /></div>)}
                    {loc.type === 'nap' && (<div className="w-24 h-16 bg-gradient-to-br from-indigo-500/5 to-slate-500/10 border border-indigo-500/20 rounded-[2rem] flex items-center justify-center shadow-lg backdrop-blur-md"><Bed className="w-6 h-6 text-indigo-400/50" /></div>)}
                    {loc.type === 'meeting' && (
                        <div className="w-60 h-32 bg-gradient-to-br from-amber-500/5 to-orange-500/5 border border-amber-500/20 rounded-[3rem] shadow-xl backdrop-blur-sm flex items-center justify-center relative">
                            <div className="w-40 h-16 bg-background/50 rounded-full border border-border/50 flex flex-col items-center justify-center shadow-inner"><Presentation className="w-6 h-6 text-amber-500/50 mb-1" /><div className="w-16 h-1 bg-amber-500/20 rounded-full" /></div>
                            {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => <div key={deg} className="absolute w-6 h-6 rounded-full border border-border/40 bg-muted/30" style={{ transform: `rotate(${deg}deg) translateY(-38px)` }} />)}
                        </div>
                    )}
                    {loc.type === 'library' && (
                        <div className="w-32 h-28 bg-gradient-to-b from-yellow-500/10 to-transparent border border-yellow-500/20 rounded-lg flex flex-col shadow-lg backdrop-blur-md p-2 justify-between">
                            <div className="w-full h-8 border-b border-yellow-500/10 flex items-center justify-center"><Library className="w-5 h-5 text-yellow-600/60" /></div>
                            <div className="flex gap-2 px-2 mt-2"><div className="w-2 h-12 bg-yellow-500/20 rounded-sm" /><div className="w-2 h-10 bg-orange-500/20 rounded-sm mt-2" /><div className="w-2 h-12 bg-amber-500/20 rounded-sm" /><div className="w-2 h-11 bg-yellow-600/20 rounded-sm mt-1" /><div className="w-2 h-12 bg-yellow-500/20 rounded-sm" /></div>
                        </div>
                    )}
                    {loc.type === 'garden' && (
                        <div className="w-40 h-40 bg-gradient-to-br from-green-500/5 to-emerald-500/5 border border-green-500/20 rounded-full shadow-lg backdrop-blur-sm flex items-center justify-center relative">
                            <div className="absolute w-28 h-28 rounded-full border-2 border-dashed border-green-500/20 animate-[spin_60s_linear_infinite]" />
                            <Leaf className="w-8 h-8 text-green-500/40" />
                        </div>
                    )}
                    <span className="mt-3 text-[9px] font-bold text-muted-foreground/80 tracking-widest uppercase bg-background/90 backdrop-blur-md px-2 py-0.5 rounded-full shadow-sm border border-border/50">{loc.name}</span>
                </div>
            ))}

            {/* Agent employees */}
            {employees.map((emp) => {
                const loc = OFFICE_LOCATIONS[emp.locId];
                const name = emp.agent.name;
                const initials = name.slice(0, 2).toUpperCase();
                const hash = Array.from(emp.id).reduce((a, c) => a + c.charCodeAt(0), 0);
                const spread = loc.size === 'xl' ? 12 : loc.size === 'lg' ? 8 : loc.size === 'md' ? 5 : 3;
                const ox = (hash % (spread * 2)) - spread;
                const oy = ((hash * 3) % (spread * 2)) - spread;

                return (
                    <div key={emp.id} className={cn('absolute transform -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none transition-all duration-[3000ms] ease-in-out')} style={{ left: `calc(${loc.x}% + ${ox}%)`, top: `calc(${loc.y}% + ${oy}%)` }}>
                        {/* Speech bubble */}
                        <div className={cn('absolute -top-16 left-1/2 -translate-x-1/2 w-max max-w-[180px] bg-foreground text-background text-[11px] font-medium px-3.5 py-2 rounded-2xl shadow-xl transition-all duration-300 pointer-events-auto z-40 text-center leading-tight', emp.message ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95 pointer-events-none')}>
                            {emp.message}
                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-foreground rotate-45" />
                        </div>

                        <div className="relative group cursor-pointer pointer-events-auto transition-transform hover:scale-110 hover:z-30">
                            {/* Status pip */}
                            {!emp.isWalking && (
                                <div className={cn('absolute -right-1 -top-1 w-5 h-5 rounded-full border-2 border-background shadow-md flex items-center justify-center z-30', statusColor(emp.status).split(' ')[0])}>
                                    {emp.status === 'working' && <Cpu className="w-2.5 h-2.5 text-white animate-pulse" />}
                                    {emp.status === 'gossiping' && <MessagesSquare className="w-2.5 h-2.5 text-white" />}
                                    {emp.status === 'playing' && <Gamepad2 className="w-2.5 h-2.5 text-white animate-bounce" />}
                                    {emp.status === 'meeting' && <Presentation className="w-2.5 h-2.5 text-white" />}
                                    {emp.status === 'sleeping' && <span className="text-[8px] font-black text-white">Zzz</span>}
                                    {emp.status === 'reading' && <Library className="w-2.5 h-2.5 text-white" />}
                                    {emp.status === 'zen' && <Leaf className="w-2.5 h-2.5 text-white" />}
                                    {emp.status === 'idle' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                </div>
                            )}
                            {emp.isWalking && (
                                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-1 z-20">
                                    <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            )}

                            {/* Avatar */}
                            <div className={cn('w-12 h-12 rounded-full border-[3px] border-background shadow-xl ring-2 bg-primary/10 flex items-center justify-center', emp.isWalking ? 'ring-border/50' : statusColor(emp.status).split(' ')[1])}>
                                <Bot className="h-5 w-5 text-primary" />
                            </div>
                        </div>

                        {/* Name */}
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-md px-2 py-0.5 rounded-md border border-border shadow-lg text-[9px] font-bold tracking-wide whitespace-nowrap z-50">{name}</div>
                    </div>
                );
            })}
        </div>
    );
}

export default function DashboardPage() {
    const workspace = useActiveWorkspace();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchAgents = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getAgents(workspace.id);
            setAgents(data);
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => { fetchAgents(); }, [fetchAgents]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold tracking-widest uppercase border border-primary/20">
                        <Activity className="w-3 h-3 animate-pulse" />
                        Live Simulation Active
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight flex items-center gap-4">
                        Virtual HQ
                        <div className="relative flex items-center justify-center">
                            <Zap className="w-8 h-8 text-amber-500 relative z-10" />
                            <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full" />
                        </div>
                    </h1>
                    <p className="text-muted-foreground text-base sm:text-lg max-w-2xl">
                        Watch your AI employees collaborate, compute, play games, and occasionally grab a digital coffee.
                    </p>
                </div>

                {!loading && (
                    <div className="flex bg-card border border-border rounded-3xl p-1.5 shadow-xl shrink-0">
                        <div className="px-5 py-2.5 flex flex-col items-center border-r border-border">
                            <span className="text-2xl font-black text-primary">{agents.length}</span>
                            <span className="text-[9px] font-extrabold uppercase tracking-widest text-muted-foreground mt-0.5">Personnel</span>
                        </div>
                        <div className="px-5 py-2.5 flex flex-col items-center border-r border-border">
                            <span className="text-2xl font-black text-emerald-500">100%</span>
                            <span className="text-[9px] font-extrabold uppercase tracking-widest text-muted-foreground mt-0.5">Uptime</span>
                        </div>
                        <div className="px-5 py-2.5 flex flex-col items-center">
                            <div className="flex items-center gap-1.5 mt-1">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-lg font-black leading-none">Online</span>
                            </div>
                            <span className="text-[9px] font-extrabold uppercase tracking-widest text-muted-foreground mt-1">Status</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Virtual Office */}
            {loading ? (
                <div className="w-full h-[75vh] rounded-[2rem] border border-border bg-muted/10 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
                    <div className="flex flex-col items-center gap-6 relative z-10">
                        <div className="relative">
                            <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
                            <Building2 className="w-16 h-16 text-primary relative z-10 animate-bounce" />
                        </div>
                        <div className="flex flex-col items-center gap-1 bg-background/50 p-4 rounded-2xl backdrop-blur-md border border-border">
                            <p className="text-xl font-bold">Generating Workspace Map</p>
                            <p className="text-sm text-muted-foreground">Booting AI models and rendering environments...</p>
                        </div>
                    </div>
                </div>
            ) : (
                <VirtualOffice agents={agents} />
            )}
        </div>
    );
}
