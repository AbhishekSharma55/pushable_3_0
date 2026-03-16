import { RegisterForm } from '@/components/auth/register-form';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';

export default function RegisterPage() {
    return (
        <Card className="border-border/50 shadow-xl">
            <CardHeader className="space-y-1 text-center">
                <CardTitle className="text-2xl font-bold">
                    Create your account
                </CardTitle>
                <CardDescription>
                    Get started with Pushable AI for free
                </CardDescription>
            </CardHeader>
            <CardContent>
                <RegisterForm />
            </CardContent>
        </Card>
    );
}
