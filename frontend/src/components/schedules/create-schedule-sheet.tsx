'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    ChevronDown,
    ChevronRight,
    Calendar,
} from 'lucide-react';
import {
    createSchedule,
    updateSchedule,
} from '@/lib/api/schedules';
import { getAgents } from '@/lib/api/agents';
import type { Schedule, Agent } from '@/types';

type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'every_weekday' | 'monthly' | 'yearly' | 'custom';

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
    { value: 'once', label: 'Once' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'every_weekday', label: 'Every weekday' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'custom', label: 'Custom cron' },
];

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function generateTimeOptions(): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            const value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            const period = h >= 12 ? 'PM' : 'AM';
            const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const label = `${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
            options.push({ value, label });
        }
    }
    return options;
}

const TIME_OPTIONS = generateTimeOptions();

function generateCron(
    frequency: ScheduleFrequency,
    time: string,
    opts: { dayOfWeek?: number; dayOfMonth?: number; month?: number; date?: string },
): string {
    const [hours, minutes] = time.split(':').map(Number);
    switch (frequency) {
        case 'once': {
            if (opts.date) {
                const d = new Date(opts.date + 'T00:00:00');
                return `${minutes} ${hours} ${d.getDate()} ${d.getMonth() + 1} *`;
            }
            return `${minutes} ${hours} * * *`;
        }
        case 'daily':
            return `${minutes} ${hours} * * *`;
        case 'weekly':
            return `${minutes} ${hours} * * ${opts.dayOfWeek ?? 0}`;
        case 'every_weekday':
            return `${minutes} ${hours} * * 1-5`;
        case 'monthly':
            return `${minutes} ${hours} ${opts.dayOfMonth ?? 1} * *`;
        case 'yearly':
            return `${minutes} ${hours} ${opts.dayOfMonth ?? 1} ${opts.month ?? 1} *`;
        default:
            return '';
    }
}

function parseCronToFrequency(cron: string): {
    frequency: ScheduleFrequency;
    time: string;
    dayOfWeek: number;
    dayOfMonth: number;
    month: number;
} {
    const defaults = {
        frequency: 'custom' as ScheduleFrequency,
        time: '09:00',
        dayOfWeek: 1,
        dayOfMonth: 1,
        month: 1,
    };
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return defaults;

    const [minute, hour, dom, mon, dow] = parts;
    if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return defaults;

    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

    if (dow === '1-5' && dom === '*' && mon === '*') {
        return { frequency: 'every_weekday', time, dayOfWeek: 1, dayOfMonth: 1, month: 1 };
    }
    if (dow !== '*' && dom === '*' && mon === '*') {
        return { frequency: 'weekly', time, dayOfWeek: parseInt(dow) || 0, dayOfMonth: 1, month: 1 };
    }
    if (mon !== '*' && dom !== '*' && dow === '*') {
        return { frequency: 'yearly', time, dayOfMonth: parseInt(dom) || 1, month: parseInt(mon) || 1, dayOfWeek: 1 };
    }
    if (dom !== '*' && mon === '*' && dow === '*') {
        return { frequency: 'monthly', time, dayOfMonth: parseInt(dom) || 1, dayOfWeek: 1, month: 1 };
    }
    if (dom === '*' && mon === '*' && dow === '*') {
        return { frequency: 'daily', time, dayOfWeek: 1, dayOfMonth: 1, month: 1 };
    }

    return defaults;
}

interface CreateScheduleSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    schedule?: Schedule | null;
    onSuccess: () => void;
}

export function CreateScheduleSheet({
    open,
    onOpenChange,
    workspaceId,
    schedule,
    onSuccess,
}: CreateScheduleSheetProps) {
    const isEdit = !!schedule;

    const [name, setName] = useState('');
    const [agentId, setAgentId] = useState('');
    const [prompt, setPrompt] = useState('');
    const [agents, setAgents] = useState<Agent[]>([]);

    const [frequency, setFrequency] = useState<ScheduleFrequency>('daily');
    const [selectedTime, setSelectedTime] = useState('09:00');
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedDayOfWeek, setSelectedDayOfWeek] = useState(1);
    const [selectedDayOfMonth, setSelectedDayOfMonth] = useState(1);
    const [selectedMonth, setSelectedMonth] = useState(1);
    const [cronInput, setCronInput] = useState('');

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [timezone, setTimezone] = useState(
        typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    );
    const [humanizeEnabled, setHumanizeEnabled] = useState(false);
    const [humanizeDelay, setHumanizeDelay] = useState(0);
    const [businessHoursOnly, setBusinessHoursOnly] = useState(false);
    const [workStartHour, setWorkStartHour] = useState(9);
    const [workEndHour, setWorkEndHour] = useState(18);
    const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5]);

    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        getAgents(workspaceId).then(setAgents).catch(() => {});
    }, [open, workspaceId]);

    useEffect(() => {
        if (!open) return;
        if (isEdit && schedule) {
            setName(schedule.name);
            setAgentId(schedule.agentId);
            setPrompt(schedule.prompt);
            setTimezone(schedule.timezone);
            setHumanizeDelay(schedule.humanizeDelay);
            setHumanizeEnabled(schedule.humanizeDelay > 0);
            setBusinessHoursOnly(schedule.businessHoursOnly);
            setWorkStartHour(schedule.workStartHour);
            setWorkEndHour(schedule.workEndHour);
            setWorkDays(schedule.workDays);
            setShowAdvanced(schedule.humanizeDelay > 0 || schedule.businessHoursOnly);

            const parsed = parseCronToFrequency(schedule.cron);
            setFrequency(parsed.frequency);
            setSelectedTime(parsed.time);
            setSelectedDayOfWeek(parsed.dayOfWeek);
            setSelectedDayOfMonth(parsed.dayOfMonth);
            setSelectedMonth(parsed.month);
            if (parsed.frequency === 'custom') {
                setCronInput(schedule.cron);
            }
        } else {
            setName('');
            setAgentId('');
            setPrompt('');
            setFrequency('daily');
            setSelectedTime('09:00');
            setSelectedDate('');
            setSelectedDayOfWeek(1);
            setSelectedDayOfMonth(1);
            setSelectedMonth(1);
            setCronInput('');
            setTimezone(
                typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
            );
            setHumanizeDelay(0);
            setHumanizeEnabled(false);
            setBusinessHoursOnly(false);
            setWorkStartHour(9);
            setWorkEndHour(18);
            setWorkDays([1, 2, 3, 4, 5]);
            setShowAdvanced(false);
        }
    }, [open, schedule, isEdit]);

    const toggleWorkDay = (day: number) => {
        setWorkDays((prev) =>
            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
        );
    };

    const handleSubmit = async () => {
        if (!name.trim() || !agentId || !prompt.trim()) {
            toast.error('Name, agent, and instructions are required');
            return;
        }
        if (frequency === 'once' && !selectedDate) {
            toast.error('Please select a date');
            return;
        }
        if (frequency === 'custom' && !cronInput.trim()) {
            toast.error('Please enter a cron expression');
            return;
        }

        const cronExpression =
            frequency === 'custom'
                ? cronInput.trim()
                : generateCron(frequency, selectedTime, {
                      dayOfWeek: selectedDayOfWeek,
                      dayOfMonth: selectedDayOfMonth,
                      month: selectedMonth,
                      date: selectedDate,
                  });

        setSubmitting(true);
        try {
            if (isEdit && schedule) {
                await updateSchedule(workspaceId, schedule.id, {
                    name,
                    prompt,
                    cron: cronExpression,
                    timezone,
                    humanizeDelay: humanizeEnabled ? humanizeDelay : 0,
                    businessHoursOnly,
                    workStartHour,
                    workEndHour,
                    workDays,
                });
                toast.success('Schedule updated');
            } else {
                await createSchedule(workspaceId, {
                    name: name.trim(),
                    agentId,
                    prompt: prompt.trim(),
                    enabled: true,
                    scheduleType: 'custom',
                    cronExpression,
                    timezone,
                    humanizeDelay: humanizeEnabled ? humanizeDelay : 0,
                    businessHoursOnly,
                    workStartHour,
                    workEndHour,
                    workDays,
                });
                toast.success('Schedule created');
            }
            onOpenChange(false);
            onSuccess();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    const canSubmit =
        name.trim() &&
        agentId &&
        prompt.trim() &&
        (frequency === 'custom' ? cronInput.trim() : frequency === 'once' ? selectedDate : true);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Schedule' : 'Scheduled task'}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {isEdit ? 'Update your scheduled task.' : 'Create a new scheduled task.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    {/* Instructions */}
                    <div className="space-y-1.5">
                        <Label className="text-sm text-muted-foreground">Instructions</Label>
                        <div className="relative">
                            <Textarea
                                placeholder="Enter your prompt for the agent..."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
                                rows={3}
                                className="resize-none pr-16"
                            />
                            <span className="absolute bottom-2 right-3 text-[11px] text-muted-foreground">
                                {prompt.length}/2000
                            </span>
                        </div>
                    </div>

                    {/* Agent */}
                    {!isEdit && (
                        <div className="space-y-1.5">
                            <Label className="text-sm text-muted-foreground">Agent</Label>
                            <Select value={agentId} onValueChange={setAgentId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select an agent" />
                                </SelectTrigger>
                                <SelectContent>
                                    {agents.map((agent) => (
                                        <SelectItem key={agent.id} value={agent.id}>
                                            {agent.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Name */}
                    <div className="space-y-1.5">
                        <Label className="text-sm text-muted-foreground">Name</Label>
                        <Input
                            placeholder="e.g. Morning standup report"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    {/* Schedule frequency */}
                    <div className="space-y-1.5">
                        <Label className="text-sm text-muted-foreground">Schedule</Label>
                        <div className="flex gap-2">
                            <Select
                                value={frequency}
                                onValueChange={(v) => setFrequency(v as ScheduleFrequency)}
                            >
                                <SelectTrigger
                                    className={
                                        frequency === 'custom' ? 'flex-1' : 'w-[150px]'
                                    }
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FREQUENCY_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Once: date + time */}
                            {frequency === 'once' && (
                                <>
                                    <div className="relative flex-1">
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                        <Input
                                            type="date"
                                            value={selectedDate}
                                            onChange={(e) => setSelectedDate(e.target.value)}
                                            className="pl-9"
                                        />
                                    </div>
                                    <Select value={selectedTime} onValueChange={setSelectedTime}>
                                        <SelectTrigger className="w-[120px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {TIME_OPTIONS.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </>
                            )}

                            {/* Daily: time */}
                            {frequency === 'daily' && (
                                <Select value={selectedTime} onValueChange={setSelectedTime}>
                                    <SelectTrigger className="flex-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-60">
                                        {TIME_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {/* Weekly: day + time */}
                            {frequency === 'weekly' && (
                                <>
                                    <Select
                                        value={String(selectedDayOfWeek)}
                                        onValueChange={(v) => setSelectedDayOfWeek(Number(v))}
                                    >
                                        <SelectTrigger className="flex-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {DAYS_OF_WEEK.map((day, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {day}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={selectedTime} onValueChange={setSelectedTime}>
                                        <SelectTrigger className="w-[120px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {TIME_OPTIONS.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </>
                            )}

                            {/* Every weekday: time */}
                            {frequency === 'every_weekday' && (
                                <Select value={selectedTime} onValueChange={setSelectedTime}>
                                    <SelectTrigger className="flex-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-60">
                                        {TIME_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {/* Monthly: day + time */}
                            {frequency === 'monthly' && (
                                <>
                                    <Select
                                        value={String(selectedDayOfMonth)}
                                        onValueChange={(v) => setSelectedDayOfMonth(Number(v))}
                                    >
                                        <SelectTrigger className="w-[80px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {Array.from({ length: 31 }, (_, i) => (
                                                <SelectItem key={i + 1} value={String(i + 1)}>
                                                    {i + 1}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={selectedTime} onValueChange={setSelectedTime}>
                                        <SelectTrigger className="flex-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {TIME_OPTIONS.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </>
                            )}

                            {/* Yearly: month + day + time */}
                            {frequency === 'yearly' && (
                                <>
                                    <Select
                                        value={String(selectedMonth)}
                                        onValueChange={(v) => setSelectedMonth(Number(v))}
                                    >
                                        <SelectTrigger className="flex-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {MONTHS.map((month, i) => (
                                                <SelectItem key={i} value={String(i + 1)}>
                                                    {month}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select
                                        value={String(selectedDayOfMonth)}
                                        onValueChange={(v) => setSelectedDayOfMonth(Number(v))}
                                    >
                                        <SelectTrigger className="w-[70px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {Array.from({ length: 31 }, (_, i) => (
                                                <SelectItem key={i + 1} value={String(i + 1)}>
                                                    {i + 1}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={selectedTime} onValueChange={setSelectedTime}>
                                        <SelectTrigger className="w-[110px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {TIME_OPTIONS.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </>
                            )}
                        </div>

                        {/* Custom cron input */}
                        {frequency === 'custom' && (
                            <div className="mt-2 space-y-1.5">
                                <Input
                                    placeholder="* * * * * (min hour dom month dow)"
                                    value={cronInput}
                                    onChange={(e) => setCronInput(e.target.value)}
                                    className="font-mono"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    5-field cron: minute (0-59) hour (0-23) day-of-month (1-31) month
                                    (1-12) day-of-week (0-6)
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Advanced options */}
                    <div className="rounded-lg border border-border/60">
                        <button
                            type="button"
                            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                        >
                            <span>Advanced options</span>
                            {showAdvanced ? (
                                <ChevronDown className="h-4 w-4" />
                            ) : (
                                <ChevronRight className="h-4 w-4" />
                            )}
                        </button>

                        {showAdvanced && (
                            <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-4">
                                {/* Timezone */}
                                <div className="space-y-1.5">
                                    <Label className="text-sm">Timezone</Label>
                                    <Input
                                        value={timezone}
                                        onChange={(e) => setTimezone(e.target.value)}
                                        placeholder="e.g. Asia/Kolkata"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        Detected:{' '}
                                        {typeof window !== 'undefined'
                                            ? Intl.DateTimeFormat().resolvedOptions().timeZone
                                            : 'UTC'}
                                    </p>
                                </div>

                                {/* Humanize */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label className="text-sm">Humanize timing</Label>
                                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                                Add random delay to feel less robotic
                                            </p>
                                        </div>
                                        <Switch
                                            checked={humanizeEnabled}
                                            onCheckedChange={(v) => {
                                                setHumanizeEnabled(v);
                                                if (!v) setHumanizeDelay(0);
                                                else setHumanizeDelay(10);
                                            }}
                                        />
                                    </div>
                                    {humanizeEnabled && (
                                        <div className="space-y-2">
                                            <Slider
                                                value={[humanizeDelay]}
                                                onValueChange={([v]) => setHumanizeDelay(v)}
                                                min={1}
                                                max={30}
                                                step={1}
                                            />
                                            <p className="text-xs text-muted-foreground text-center">
                                                Up to {humanizeDelay} minutes of random delay
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Business hours */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label className="text-sm">Business hours only</Label>
                                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                                Skip runs outside work hours
                                            </p>
                                        </div>
                                        <Switch
                                            checked={businessHoursOnly}
                                            onCheckedChange={setBusinessHoursOnly}
                                        />
                                    </div>
                                    {businessHoursOnly && (
                                        <div className="space-y-3">
                                            <div className="flex gap-1">
                                                {DAY_LABELS.map((label, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                                                            workDays.includes(i)
                                                                ? 'bg-primary text-primary-foreground'
                                                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                                        }`}
                                                        onClick={() => toggleWorkDay(i)}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Select
                                                    value={String(workStartHour)}
                                                    onValueChange={(v) => setWorkStartHour(Number(v))}
                                                >
                                                    <SelectTrigger className="w-24 h-8 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {Array.from({ length: 24 }, (_, i) => (
                                                            <SelectItem key={i} value={String(i)}>
                                                                {i.toString().padStart(2, '0')}:00
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <span className="text-xs text-muted-foreground">to</span>
                                                <Select
                                                    value={String(workEndHour)}
                                                    onValueChange={(v) => setWorkEndHour(Number(v))}
                                                >
                                                    <SelectTrigger className="w-24 h-8 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {Array.from({ length: 24 }, (_, i) => (
                                                            <SelectItem key={i} value={String(i)}>
                                                                {i.toString().padStart(2, '0')}:00
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button disabled={submitting || !canSubmit} onClick={handleSubmit}>
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {isEdit ? 'Updating...' : 'Saving...'}
                            </>
                        ) : (
                            'Save'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
