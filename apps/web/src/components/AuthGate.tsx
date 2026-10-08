import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { authEnabled, useAuth } from '../lib/auth';
import { SetPasswordPage, SignInPage } from '../pages/auth/AuthScreens';

/**
 * Shows the app only to a signed-in user (when sign-in is configured). Switching or signing out clears every
 * cached query, so one person's data is never shown to the next.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id ?? null;
  const previous = useRef(userId);
  useEffect(() => {
    if (previous.current !== userId) queryClient.clear();
    previous.current = userId;
  }, [userId, queryClient]);

  if (!authEnabled) return <>{children}</>;
  if (!auth.ready) return null;
  if (!auth.session) return <SignInPage />;
  if (auth.needsPassword) return <SetPasswordPage reason={auth.needsPassword} />;
  return <>{children}</>;
}
