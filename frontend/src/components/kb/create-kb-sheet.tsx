'use client';

import { useEffect } from 'react';
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
import { createKB, updateKB } from '@/lib/api/kb';
import type { KnowledgeBase } from '@/types';

const kbSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
});

type KBFormData = z.infer<typeof kbSchema>;

interface CreateKBSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    kb?: KnowledgeBase | null;
    onSuccess: () => void;
}

export function CreateKBSheet({
    open,
    onOpenChange,
    workspaceId,
    kb,
    onSuccess,
}: CreateKBSheetProps) {
    const isEdit = !!kb;

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<KBFormData>({
        resolver: zodResolver(kbSchema),
        defaultValues: { name: '', description: '' },
    });

    useEffect(() => {
        if (kb) {
            reset({ name: kb.name, description: kb.description ?? '' });
        } else {
            reset({ name: '', description: '' });
        }
    }, [kb, reset]);

    const onSubmit = async (data: KBFormData) => {
        try {
            if (isEdit && kb) {
                await updateKB(workspaceId, kb.id, data);
                toast.success('Knowledge base updated');
            } else {
                await createKB(workspaceId, data);
                toast.success('Knowledge base created');
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
                        {isEdit ? 'Edit Knowledge Base' : 'Create Knowledge Base'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your knowledge base details.'
                            : 'Create a new knowledge base to store documents.'}
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                    <div className="space-y-2">
                        <Label htmlFor="kb-name">Name</Label>
                        <Input
                            id="kb-name"
                            placeholder="e.g. Product Documentation"
                            {...register('name')}
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="kb-description">Description</Label>
                        <Textarea
                            id="kb-description"
                            placeholder="What documents will this knowledge base contain?"
                            rows={3}
                            className="resize-none"
                            {...register('description')}
                        />
                    </div>

                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting
                            ? isEdit ? 'Updating...' : 'Creating...'
                            : isEdit ? 'Update Knowledge Base' : 'Create Knowledge Base'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    );
}
