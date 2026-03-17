'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
    Sunrise,
    Sunset,
    Sun,
    Calendar,
    Repeat,
    Clock,
    CalendarCheck,
    Zap,
    Pencil,
    Loader2,
    Check,
    ChevronDown,
    ChevronRight,
    MessageSquare,
    Sparkles,
    Terminal,
} from 'lucide-react';
import {
    createSchedule,
    updateSchedule,
    getPresets,
    previewSchedule,
} from '@/lib/api/schedules';
import { getTasks } from '@/lib/api/tasks';
import { getWorkflows } from '@/lib/api/workflows';
import type { Schedule, SchedulePreset, Task, Workflow } from '@/types';
import type { PreviewResult } from '@/lib/api/schedules';

const ICON_MAP: Record<string, React.ElementType> = {
    sunrise: Sunrise,
    sunset: Sunset,
    sun: Sun,
    calendar: Calendar,
    repeat: Repeat,
    clock: Clock,
    'calendar-check': CalendarCheck,
    zap: Zap,
    pencil: Pencil,
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

    // Step 1 state
    const [scheduleType, setScheduleType] = useState<'preset' | 'natural' | 'custom' | null>(null);
    const [presets, setPresets] = useState<SchedulePreset[]>([]);
    const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(null);
    const [naturalInput, setNaturalInput] = useState('');
    const [cronInput, setCronInput] = useState('');
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');

    // Step 2 state
    const [name, setName] = useState('');
    const [targetType, setTargetType] = useState<'task' | 'workflow'>('task');
    const [targetId, setTargetId] = useState('');
    const [timezone, setTimezone] = useState(
        typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
    );
    const [tasks, setTasks] = useState<Task[]>([]);
    const [workflows, setWorkflows] = useState<Workflow[]>([]);

    // Step 3 state
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [humanizeDelay, setHumanizeDelay] = useState(0);
    const [humanizeEnabled, setHumanizeEnabled] = useState(false);
    const [businessHoursOnly, setBusinessHoursOnly] = useState(false);
    const [workStartHour, setWorkStartHour] = useState(9);
    const [workEndHour, setWorkEndHour] = useState(18);
    const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5]);

    const [submitting, setSubmitting] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load presets and targets
    useEffect(() => {
        if (!open) return;
        getPresets(workspaceId).then(setPresets).catch(() => {});
        Promise.all([getTasks(workspaceId), getWorkflows(workspaceId)])
            .then(([t, w]) => { setTasks(t); setWorkflows(w); })
            .catch(() => {});
    }, [open, workspaceId]);

    // Reset form on open
    useEffect(() => {
        if (!open) return;
        if (isEdit && schedule) {
            setScheduleType(schedule.scheduleType === 'natural' ? 'natural' : schedule.scheduleType === 'preset' ? 'preset' : 'custom');
            setSelectedPresetKey(schedule.presetKey);
            setNaturalInput(schedule.naturalLanguage || '');
            setCronInput(schedule.cron);
            setName(schedule.name);
            setTargetType(schedule.targetType);
            setTargetId(schedule.targetId);
            setTimezone(schedule.timezone);
            setHumanizeDelay(schedule.humanizeDelay);
            setHumanizeEnabled(schedule.humanizeDelay > 0);
            setBusinessHoursOnly(schedule.businessHoursOnly);
            setWorkStartHour(schedule.workStartHour);
            setWorkEndHour(schedule.workEndHour);
            setWorkDays(schedule.workDays);
            setShowAdvanced(schedule.humanizeDelay > 0 || schedule.businessHoursOnly);
        } else {
            setScheduleType(null);
            setSelectedPresetKey(null);
            setNaturalInput('');
            setCronInput('');
            setName('');
            setTargetType('task');
            setTargetId('');
            setTimezone(typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
            setHumanizeDelay(0);
            setHumanizeEnabled(false);
            setBusinessHoursOnly(false);
            setWorkStartHour(9);
            setWorkEndHour(18);
            setWorkDays([1, 2, 3, 4, 5]);
            setShowAdvanced(false);
            setPreview(null);
            setPreviewError('');
        }
    }, [open, schedule, isEdit]);

    // Debounced NL preview
    const fetchPreview = useCallback((text: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (text.trim().length < 3) {
            setPreview(null);
            setPreviewError('');
            return;
        }
        debounceRef.current = setTimeout(async () => {
            setPreviewLoading(true);
            setPreviewError('');
            try {
                const result = await previewSchedule(workspaceId, text, timezone);
                setPreview(result);
            } catch {
                setPreviewError("Couldn't understand — try being more specific");
                setPreview(null);
            } finally {
                setPreviewLoading(false);
            }
        }, 800);
    }, [workspaceId, timezone]);

    const handleNaturalInputChange = (val: string) => {
        setNaturalInput(val);
        fetchPreview(val);
    };

    const handlePresetSelect = (preset: SchedulePreset) => {
        setSelectedPresetKey(preset.key);
        setScheduleType('preset');
        setHumanizeDelay(preset.humanizeDelay);
        setHumanizeEnabled(preset.humanizeDelay > 0);
        if (!name) setName(preset.label);
    };

    const toggleWorkDay = (day: number) => {
        setWorkDays((prev) =>
            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
        );
    };

    const handleSubmit = async () => {
        if (!name.trim() || !targetId) {
            toast.error('Name and target are required');
            return;
        }

        setSubmitting(true);
        try {
            if (isEdit && schedule) {
                await updateSchedule(workspaceId, schedule.id, { name, cron: cronInput || schedule.cron });
                toast.success('Schedule updated');
            } else {
                const payload: Parameters<typeof createSchedule>[1] = {
                    name: name.trim(),
                    targetType,
                    targetId,
                    enabled: true,
                    scheduleType: scheduleType === 'preset' ? 'preset' : scheduleType === 'natural' ? 'natural' : 'custom',
                    timezone,
                    humanizeDelay: humanizeEnabled ? humanizeDelay : 0,
                    businessHoursOnly,
                    workStartHour,
                    workEndHour,
                    workDays,
                };

                if (scheduleType === 'preset') {
                    payload.presetKey = selectedPresetKey || undefined;
                } else if (scheduleType === 'natural') {
                    payload.naturalLanguage = naturalInput;
                } else {
                    payload.cronExpression = cronInput;
                }

                await createSchedule(workspaceId, payload);
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

    const targetOptions = targetType === 'task' ? tasks : workflows;
    const selectedPreset = presets.find((p) => p.key === selectedPresetKey);

    // Build summary
    let summary = '';
    if (scheduleType === 'preset' && selectedPreset) {
        summary = selectedPreset.label;
    } else if (scheduleType === 'natural' && preview) {
        summary = preview.humanReadable;
    } else if (scheduleType === 'custom' && cronInput) {
        summary = cronInput;
    }
    if (humanizeEnabled && humanizeDelay > 0) summary += ` (±${humanizeDelay}min)`;
    if (timezone !== 'UTC') summary += ` · ${timezone.split('/').pop()?.replace('_', ' ')}`;

    const canSubmit = name.trim() && targetId && (
        (scheduleType === 'preset' && selectedPresetKey) ||
        (scheduleType === 'natural' && preview) ||
        (scheduleType === 'custom' && cronInput.trim())
    );

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-2xl overflow-y-auto px-6">
                <SheetHeader>
                    <SheetTitle className="text-xl font-semibold">
                        {isEdit ? 'Edit Schedule' : 'Create Schedule'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit ? 'Update your schedule.' : 'Schedule a recurring task for your agent.'}
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6 mt-6 px-1">
                    {/* Step 1 — How to schedule */}
                    {!isEdit && (
                        <>
                            <div>
                                <Label className="text-sm font-semibold mb-3 block">How would you like to schedule?</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                                            scheduleType === 'preset' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 hover:bg-muted/50'
                                        }`}
                                        onClick={() => setScheduleType('preset')}
                                    >
                                        <Sparkles className="h-5 w-5 text-amber-500" />
                                        <span className="text-xs font-medium">Use a Preset</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                                            scheduleType === 'natural' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 hover:bg-muted/50'
                                        }`}
                                        onClick={() => setScheduleType('natural')}
                                    >
                                        <MessageSquare className="h-5 w-5 text-blue-500" />
                                        <span className="text-xs font-medium">Plain English</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                                            scheduleType === 'custom' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 hover:bg-muted/50'
                                        }`}
                                        onClick={() => setScheduleType('custom')}
                                    >
                                        <Terminal className="h-5 w-5 text-green-500" />
                                        <span className="text-xs font-medium">Custom Cron</span>
                                    </button>
                                </div>
                            </div>

                            {/* Presets grid */}
                            {scheduleType === 'preset' && (
                                <div className="grid grid-cols-2 gap-2">
                                    {presets.filter((p) => p.key !== 'custom').map((preset) => {
                                        const Icon = ICON_MAP[preset.icon] || Clock;
                                        const selected = selectedPresetKey === preset.key;
                                        return (
                                            <button
                                                key={preset.key}
                                                type="button"
                                                className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-all ${
                                                    selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                                                }`}
                                                onClick={() => handlePresetSelect(preset)}
                                            >
                                                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium">{preset.label}</p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">{preset.description}</p>
                                                </div>
                                                {selected && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Natural language input */}
                            {scheduleType === 'natural' && (
                                <div className="space-y-3">
                                    <Input
                                        placeholder="e.g. Every weekday morning, Twice a week on Tuesdays..."
                                        value={naturalInput}
                                        onChange={(e) => handleNaturalInputChange(e.target.value)}
                                    />
                                    {previewLoading && (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            Understanding...
                                        </div>
                                    )}
                                    {previewError && (
                                        <p className="text-xs text-destructive">{previewError}</p>
                                    )}
                                    {preview && (
                                        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{preview.humanReadable}</p>
                                            </div>
                                            {preview.nextRuns.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-[11px] text-muted-foreground font-medium">Next runs:</p>
                                                    {preview.nextRuns.map((run, i) => (
                                                        <p key={i} className="text-xs text-muted-foreground">{run}</p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Custom cron */}
                            {scheduleType === 'custom' && (
                                <div className="space-y-2">
                                    <Input
                                        placeholder="* * * * * (min hour dom month dow)"
                                        value={cronInput}
                                        onChange={(e) => setCronInput(e.target.value)}
                                        className="font-mono"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        5-field cron: minute (0-59) hour (0-23) day-of-month (1-31) month (1-12) day-of-week (0-6)
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    {/* Step 2 — Details (always shown when type selected) */}
                    {(scheduleType || isEdit) && (
                        <>
                            <div className="space-y-2">
                                <Label>Schedule Name</Label>
                                <Input
                                    placeholder="e.g. Morning standup report"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>

                            {!isEdit && (
                                <>
                                    <div className="space-y-2">
                                        <Label>Target Type</Label>
                                        <Select value={targetType} onValueChange={(v: 'task' | 'workflow') => { setTargetType(v); setTargetId(''); }}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="task">Task</SelectItem>
                                                <SelectItem value="workflow">Workflow</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Target</Label>
                                        <Select value={targetId} onValueChange={setTargetId}>
                                            <SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger>
                                            <SelectContent>
                                                {targetOptions.map((item) => (
                                                    <SelectItem key={item.id} value={item.id}>
                                                        {targetType === 'task' ? (item as Task).title : (item as Workflow).name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Timezone</Label>
                                        <Input
                                            value={timezone}
                                            onChange={(e) => setTimezone(e.target.value)}
                                            placeholder="e.g. Asia/Kolkata"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            IANA timezone. Detected: {typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'}
                                        </p>
                                    </div>
                                </>
                            )}

                            {/* Step 3 — Advanced options */}
                            {!isEdit && (
                                <div className="rounded-lg border border-border/60">
                                    <button
                                        type="button"
                                        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                                        onClick={() => setShowAdvanced(!showAdvanced)}
                                    >
                                        <span>Smart Options</span>
                                        {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>

                                    {showAdvanced && (
                                        <div className="px-4 pb-4 space-y-5 border-t border-border/40 pt-4">
                                            {/* Humanize delay */}
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <Label className="text-sm">Humanize timing</Label>
                                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                                            Add random delay to feel less robotic
                                                        </p>
                                                    </div>
                                                    <Switch checked={humanizeEnabled} onCheckedChange={(v) => { setHumanizeEnabled(v); if (!v) setHumanizeDelay(0); else setHumanizeDelay(10); }} />
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
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <Label className="text-sm">Business hours only</Label>
                                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                                            Skip runs outside work hours
                                                        </p>
                                                    </div>
                                                    <Switch checked={businessHoursOnly} onCheckedChange={setBusinessHoursOnly} />
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
                                                            <Select value={String(workStartHour)} onValueChange={(v) => setWorkStartHour(Number(v))}>
                                                                <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {Array.from({ length: 24 }, (_, i) => (
                                                                        <SelectItem key={i} value={String(i)}>{i.toString().padStart(2, '0')}:00</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            <span className="text-xs text-muted-foreground">to</span>
                                                            <Select value={String(workEndHour)} onValueChange={(v) => setWorkEndHour(Number(v))}>
                                                                <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {Array.from({ length: 24 }, (_, i) => (
                                                                        <SelectItem key={i} value={String(i)}>{i.toString().padStart(2, '0')}:00</SelectItem>
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
                            )}

                            {/* Summary + Submit */}
                            {summary && (
                                <div className="rounded-lg bg-muted/50 border border-border/40 px-4 py-3">
                                    <p className="text-xs text-muted-foreground">{summary}</p>
                                </div>
                            )}

                            <Button
                                className="w-full"
                                disabled={submitting || (!isEdit && !canSubmit)}
                                onClick={handleSubmit}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        {isEdit ? 'Updating...' : 'Creating...'}
                                    </>
                                ) : (
                                    isEdit ? 'Update Schedule' : 'Schedule'
                                )}
                            </Button>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
