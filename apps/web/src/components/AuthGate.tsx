import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { authEnabled, useAuth } from '../lib/auth';
import { inDemo } from '../lib/demoSession';
import { SetPasswordPage, SignInPage } from '../pages/auth/AuthScreens';
import { PrivacyPage } from '../pages/PrivacyPage';

/**
 * Shows the app only to a signed-in user (when sign-in is configured). Switching or signing out clears every
 * cached query, so one person's data is never shown to the next.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id ?? null;
  // The user the cache was last cleared for. The app isn't shown for a new user until the cache is cleared:
  // clearing it under pages that are already loading cancels their requests for good, and the page stays blank.
  const [clearedFor, setClearedFor] = useState(userId);
  useEffect(() => {
    if (clearedFor === userId) return;
    queryClient.clear();
    setClearedFor(userId);
  }, [userId, clearedFor, queryClient]);

  // The privacy page is for anyone, signed in or not.
  if (window.location.pathname === '/privacy') return <PrivacyPage />;
  // A demo visitor uses the demo's own token, signed in or not.
  if (!authEnabled || inDemo()) return <>{children}</>;
  if (!auth.ready) return null;
  if (!auth.session) return <SignInPage />;
  if (auth.needsPassword) return <SetPasswordPage reason={auth.needsPassword} />;
  if (clearedFor !== userId) return null;
  return <>{children}</>;
}
