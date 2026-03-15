import { useEffect, useRef, useState } from "react";

import {
  AUTH_EXPIRED_EVENT,
  clearAuthSession,
  createAuthSession,
  fetchAuthStatus,
  isAuthError
} from "../api";
import {
  errorMessage,
  type AuthStatusResponse
} from "../../shared/types";

export interface AuthSessionState {
  authStatus: AuthStatusResponse | null;
  authDialogOpen: boolean;
  authBusy: boolean;
  authChecking: boolean;
  authError: string | null;
  authenticated: boolean;
}

export interface AuthSessionActions {
  loadAuthState(preferredConfigId?: string): Promise<void>;
  handleAuthSubmit(credentials: { accessToken: string; haBaseUrl: string }): Promise<void>;
  handleSignOut(): Promise<void>;
  closeAuthDialog(): void;
  openAuthDialog(): void;
  setAuthStatus: React.Dispatch<React.SetStateAction<AuthStatusResponse | null>>;
}

export type AuthSession = AuthSessionState & AuthSessionActions;

export function useAuthSession(deps: {
  loadStudio: (preferredConfigId?: string) => Promise<boolean>;
  resetStudioState: () => void;
  setLoading: (loading: boolean) => void;
  setBlockingError: (error: string | null) => void;
}): AuthSession {
  const { loadStudio, resetStudioState, setLoading, setBlockingError } = deps;

  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const authenticated = Boolean(authStatus?.authenticated);

  const resetStudioStateRef = useRef(resetStudioState);
  resetStudioStateRef.current = resetStudioState;
  const setLoadingRef = useRef(setLoading);
  setLoadingRef.current = setLoading;
  const setBlockingErrorRef = useRef(setBlockingError);
  setBlockingErrorRef.current = setBlockingError;

  function closeAuthDialog(): void {
    setAuthDialogOpen(false);
    setAuthError(null);
  }

  function openAuthDialog(): void {
    setAuthError(null);
    setAuthDialogOpen(true);
  }

  useEffect(() => {
    const handleAuthExpired = () => {
      resetStudioStateRef.current();
      setAuthBusy(false);
      setAuthChecking(false);
      closeAuthDialog();
      setAuthError("Session expired. Enter a Home Assistant token again.");
      setBlockingErrorRef.current(null);
      setLoadingRef.current(false);
      setAuthStatus((current) => ({
        authenticated: false,
        haBaseUrl: null,
        defaultHaBaseUrl: current?.defaultHaBaseUrl ?? null
      }));
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  async function loadAuthState(preferredConfigId?: string): Promise<void> {
    setAuthChecking(true);
    setAuthError(null);
    setBlockingError(null);
    try {
      const nextStatus = await fetchAuthStatus();
      setAuthStatus(nextStatus);
      if (nextStatus.authenticated) {
        await loadStudio(preferredConfigId);
      } else {
        resetStudioState();
        setLoading(false);
      }
    } catch (error) {
      if (isAuthError(error)) {
        return;
      }
      resetStudioState();
      setLoading(false);
      setBlockingError(errorMessage(error));
    } finally {
      setAuthChecking(false);
    }
  }

  async function handleAuthSubmit(credentials: { accessToken: string; haBaseUrl: string }): Promise<void> {
    setAuthBusy(true);
    setAuthError(null);
    setBlockingError(null);
    try {
      const nextStatus = await createAuthSession(credentials);
      setAuthStatus(nextStatus);
      closeAuthDialog();
      await loadStudio();
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
      setAuthChecking(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const nextStatus = await clearAuthSession();
      resetStudioState();
      setAuthStatus(nextStatus);
      closeAuthDialog();
      setLoading(false);
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
      setAuthChecking(false);
    }
  }

  return {
    authStatus,
    authDialogOpen,
    authBusy,
    authChecking,
    authError,
    authenticated,
    loadAuthState,
    handleAuthSubmit,
    handleSignOut,
    closeAuthDialog,
    openAuthDialog,
    setAuthStatus
  };
}
