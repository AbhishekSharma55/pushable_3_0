'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { register as registerApi } from '@/lib/api/auth';
import { getWorkspaces } from '@/lib/api/workspaces';
import { setToken, setUser } from '@/lib/auth';
import { WORKSPACES_KEY, ACTIVE_WORKSPACE_KEY } from '@/lib/constants';
import { GoogleLoginButton } from '@/components/auth/google-login-button';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  });

  const handleAuthSuccess = async (result: {
    token: string;
    user: { id: string; name: string; email: string };
  }) => {
    setToken(result.token);
    setUser(result.user);

    const workspaces = await getWorkspaces();
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));

    if (workspaces.length > 0) {
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(workspaces[0]));
    }

    if (workspaces.length === 0) {
      router.push('/onboarding');
    } else {
      router.push('/');
    }
  };

  const onSubmit = async (data: RegisterFormValues) => {
    setIsSubmitting(true);
    try {
      const result = await registerApi(data);
      await handleAuthSuccess(result);
    } catch (error: any) {
      const message = error?.response?.data?.error?.message || 'Registration failed';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input id="register-name" placeholder="John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input id="register-email" type="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input id="register-password" type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button id="register-submit" type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            'Create Account'
          )}
        </Button>

        <GoogleLoginButton
          onSuccess={handleAuthSuccess}
          label="Sign up with Google"
          disabled={isSubmitting}
        />

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}
