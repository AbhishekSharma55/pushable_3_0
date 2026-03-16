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
import { Label } from '@/components/ui/label';
import { createWorkflow, updateWorkflow } from '@/lib/api/workflows';
import type { Workflow } from '@/types';

const workflowSchema = z.object({
    name: z.string().min(1, 'Name is required'),
});

type WorkflowFormData = z.infer<typeof workflowSchema>;

interface CreateWorkflowSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    workflow?: Workflow | null;
    onSuccess: () => void;
}

export function CreateWorkflowSheet({
    open,
    onOpenChange,
    workspaceId,
    workflow,
    onSuccess,
}: CreateWorkflowSheetProps) {
    const isEdit = !!workflow;

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<WorkflowFormData>({
        resolver: zodResolver(workflowSchema),
        defaultValues: { name: '' },
    });

    useEffect(() => {
        if (workflow) {
            reset({ name: workflow.name });
        } else {
            reset({ name: '' });
        }
    }, [workflow, reset]);

    const onSubmit = async (data: WorkflowFormData) => {
        try {
            if (isEdit && workflow) {
                await updateWorkflow(workspaceId, workflow.id, { name: data.name });
                toast.success('Workflow updated successfully');
            } else {
                await createWorkflow(workspaceId, { name: data.name });
                toast.success('Workflow created successfully');
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
                        {isEdit ? 'Edit Workflow' : 'Create Workflow'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your workflow name.'
                            : 'Create a new multi-step workflow.'}
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                    <div className="space-y-2">
                        <Label htmlFor="workflow-name">Name</Label>
                        <Input
                            id="workflow-name"
                            placeholder="e.g. Daily Report Pipeline"
                            {...register('name')}
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name.message}</p>
                        )}
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={isSubmitting}
                    >
                        {isSubmitting
                            ? isEdit ? 'Updating...' : 'Creating...'
                            : isEdit ? 'Update Workflow' : 'Create Workflow'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    );
}
