'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="bg-destructive/10 text-destructive p-4 rounded-full mb-6">
        <AlertTriangle className="w-12 h-12" />
      </div>
      
      <h2 className="text-2xl font-bold tracking-tight mb-2">
        {/* We use hardcoded fallback as well in case translation fails */}
        {t('error') || 'عذراً، حدث خطأ غير متوقع'}
      </h2>
      
      <p className="text-muted-foreground max-w-md mx-auto mb-6">
        نعتذر عن هذا الخلل. يبدو أن هناك مشكلة في الخادم أو أن الموارد استُنفذت (مثل استهلاك وظائف Vercel).
      </p>

      {error.digest && (
        <div className="bg-muted px-3 py-2 rounded-md mb-8">
          <p className="text-xs text-muted-foreground font-mono">
            Error ID: {error.digest}
          </p>
        </div>
      )}

      <Button 
        onClick={() => reset()}
        className="gap-2"
        size="lg"
      >
        <RefreshCcw className="w-4 h-4" />
        إعادة المحاولة
      </Button>
    </div>
  );
}
