import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '../config/env';
import type { AuthUser } from '../types/quiz';

const TOKEN_STORAGE_KEY = 'glassquiz_auth_token';
const USER_STORAGE_KEY = 'glassquiz_auth_user';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY));
  const user = ref<AuthUser | null>(loadStoredUser());
  const isLoading = ref(false);
  const authError = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(token.value && user.value));

  function loadStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  function setSession(newToken: string, newUser: AuthUser) {
    token.value = newToken;
    user.value = newUser;
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
  }

  function clearSession() {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  }

  async function verifySession() {
    if (!token.value) return;
    try {
      const res = await apiFetch<{ user: AuthUser }>('/auth/me', {}, token.value);
      if (res.user) {
        user.value = res.user;
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(res.user));
      }
    } catch {
      clearSession();
    }
  }

  async function register(email: string, password: string, displayName: string): Promise<boolean> {
    isLoading.value = true;
    authError.value = null;
    try {
      const res = await apiFetch<{ accessToken: string; user: AuthUser }>(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName }),
        },
      );
      setSession(res.accessToken, res.user);
      return true;
    } catch (err: unknown) {
      authError.value = err instanceof Error ? err.message : 'Registration failed.';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  async function login(email: string, password: string): Promise<boolean> {
    isLoading.value = true;
    authError.value = null;
    try {
      const res = await apiFetch<{ accessToken: string; user: AuthUser }>(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      );
      setSession(res.accessToken, res.user);
      return true;
    } catch (err: unknown) {
      authError.value = err instanceof Error ? err.message : 'Sign-in failed.';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  function logout() {
    clearSession();
    authError.value = null;
  }

  return {
    token,
    user,
    isLoading,
    authError,
    isAuthenticated,
    verifySession,
    register,
    login,
    logout,
  };
});
