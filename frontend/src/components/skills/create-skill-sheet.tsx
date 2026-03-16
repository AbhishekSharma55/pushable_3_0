'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { FileText } from 'lucide-react';
import { createSkill, updateSkill } from '@/lib/api/skills';
import type { Skill } from '@/types';

const skillSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    origin: z.string().optional(),
    instructions: z.string().min(1, 'Instructions are required'),
});

type SkillFormData = z.infer<typeof skillSchema>;

/** Parse YAML-like frontmatter from markdown */
function parseFrontmatter(content: string): {
    metadata: Record<string, string>;
    body: string;
} | null {
    const trimmed = content.trim();
    if (!trimmed.startsWith('---')) return null;
    const endIndex = trimmed.indexOf('---', 3);
    if (endIndex === -1) return null;

    const frontmatterBlock = trimmed.slice(3, endIndex).trim();
    const body = trimmed.slice(endIndex + 3).trim();

    const metadata: Record<string, string> = {};
    for (const line of frontmatterBlock.split('\n')) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        if (key && value) metadata[key] = value;
    }

    return { metadata, body };
}

interface CreateSkillSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    skill?: Skill | null;
    onSuccess: () => void;
}

export function CreateSkillSheet({
    open,
    onOpenChange,
    workspaceId,
    skill,
    onSuccess,
}: CreateSkillSheetProps) {
    const isEdit = !!skill;
    const [pasteMode, setPasteMode] = useState(false);
    const [rawPaste, setRawPaste] = useState('');
    const [detected, setDetected] = useState(false);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<SkillFormData>({
        resolver: zodResolver(skillSchema),
        defaultValues: { name: '', description: '', origin: '', instructions: '' },
    });

    useEffect(() => {
        if (skill) {
            reset({
                name: skill.name,
                description: skill.description ?? '',
                origin: skill.origin ?? '',
                instructions: skill.instructions,
            });
        } else {
            reset({ name: '', description: '', origin: '', instructions: '' });
        }
        setPasteMode(false);
        setRawPaste('');
        setDetected(false);
    }, [skill, reset]);

    const handleRawPasteChange = (value: string) => {
        setRawPaste(value);

        const parsed = parseFrontmatter(value);
        if (parsed && Object.keys(parsed.metadata).length > 0) {
            setDetected(true);
            if (parsed.metadata.name) setValue('name', parsed.metadata.name);
            if (parsed.metadata.description) setValue('description', parsed.metadata.description);
            if (parsed.metadata.origin) setValue('origin', parsed.metadata.origin);
            if (parsed.body) setValue('instructions', parsed.body);
        } else {
            setDetected(false);
        }
    };

    const applyPaste = () => {
        const parsed = parseFrontmatter(rawPaste);
        if (parsed) {
            if (parsed.metadata.name) setValue('name', parsed.metadata.name);
            if (parsed.metadata.description) setValue('description', parsed.metadata.description);
            if (parsed.metadata.origin) setValue('origin', parsed.metadata.origin);
            if (parsed.body) setValue('instructions', parsed.body);
            toast.success('Frontmatter parsed and applied');
        } else {
            // No frontmatter — use entire content as instructions
            setValue('instructions', rawPaste);
        }
        setPasteMode(false);
    };

    const onSubmit = async (data: SkillFormData) => {
        try {
            if (isEdit && skill) {
                await updateSkill(workspaceId, skill.id, data);
                toast.success('Skill updated');
            } else {
                await createSkill(workspaceId, data);
                toast.success('Skill created');
            }
            onOpenChange(false);
            onSuccess();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Something went wrong');
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-lg overflow-y-auto px-6">
                <SheetHeader>
                    <SheetTitle className="text-xl font-semibold">
                        {isEdit ? 'Edit Skill' : 'Create Skill'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your skill configuration.'
                            : 'Define a new skill for agents to use.'}
                    </SheetDescription>
                </SheetHeader>

                {/* Paste mode toggle */}
                {!isEdit && (
                    <div className="mt-4 px-1">
                        <Button
                            type="button"
                            variant={pasteMode ? 'default' : 'outline'}
                            size="sm"
                            className="gap-1.5 w-full"
                            onClick={() => setPasteMode(!pasteMode)}
                        >
                            <FileText className="h-3.5 w-3.5" />
                            {pasteMode ? 'Switch to Form' : 'Paste Skill File (with frontmatter)'}
                        </Button>
                    </div>
                )}

                {pasteMode ? (
                    <div className="space-y-4 mt-4 px-1">
                        <div className="space-y-2">
                            <Label>Paste skill content</Label>
                            <Textarea
                                placeholder={`---\nname: My Skill\ndescription: What this skill does\norigin: Source\n---\n\n# Instructions\n\nYour markdown instructions here...`}
                                rows={14}
                                className="resize-none font-mono text-sm"
                                value={rawPaste}
                                onChange={(e) => handleRawPasteChange(e.target.value)}
                            />
                            {detected && (
                                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                    <p className="text-xs font-medium text-emerald-600 mb-1.5">
                                        Frontmatter detected
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(() => {
                                            const parsed = parseFrontmatter(rawPaste);
                                            if (!parsed) return null;
                                            return Object.entries(parsed.metadata).map(([key, val]) => (
                                                <Badge key={key} variant="outline" className="text-[11px] font-mono bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                                                    {key}: {val.length > 30 ? val.slice(0, 30) + '...' : val}
                                                </Badge>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                        <Button type="button" className="w-full" onClick={applyPaste} disabled={!rawPaste.trim()}>
                            Apply & Continue to Form
                        </Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                        <div className="space-y-2">
                            <Label htmlFor="skill-name">Name</Label>
                            <Input
                                id="skill-name"
                                placeholder="e.g. Professional Tone"
                                {...register('name')}
                            />
                            {errors.name && (
                                <p className="text-sm text-destructive">{errors.name.message}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="skill-description">Description</Label>
                            <Input
                                id="skill-description"
                                placeholder="Brief description of what this skill does"
                                {...register('description')}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="skill-origin">Origin</Label>
                            <Input
                                id="skill-origin"
                                placeholder="e.g. ECC, Internal, Custom"
                                {...register('origin')}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="skill-instructions">Instructions</Label>
                            <Textarea
                                id="skill-instructions"
                                placeholder="Describe what this skill does and how the agent should apply it..."
                                rows={8}
                                className="resize-none font-mono text-sm"
                                {...register('instructions')}
                            />
                            {errors.instructions && (
                                <p className="text-sm text-destructive">{errors.instructions.message}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Supports markdown formatting. You can also paste a full skill file with frontmatter above.
                            </p>
                        </div>

                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting
                                ? isEdit ? 'Updating...' : 'Creating...'
                                : isEdit ? 'Update Skill' : 'Create Skill'}
                        </Button>
                    </form>
                )}
            </SheetContent>
        </Sheet>
    );
}
