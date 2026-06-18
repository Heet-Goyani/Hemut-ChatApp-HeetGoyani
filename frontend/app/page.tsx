'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { xhrPost } from '@/lib/xhr';
import { setTokens, setUserId } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import type { TokenResponse } from '@/types';

type Mode = 'login' | 'register';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    display_name: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = mode === 'login'
      ? `${API}/api/auth/login`
      : `${API}/api/auth/register`;

    const payload = mode === 'login'
      ? { username: form.username, password: form.password }
      : { username: form.username, email: form.email, password: form.password, display_name: form.display_name || form.username };

    // ← Required: XHR for form submission
    const result = await xhrPost<TokenResponse>(endpoint, payload);
    setLoading(false);

    if (result.error || !result.data) {
      setError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }

    const { access_token, refresh_token, user } = result.data;
    setTokens(access_token, refresh_token);
    setUserId(user.id);

    // Connect WebSocket immediately after login
    wsClient.connect(user.id, access_token);

    router.push('/chat');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>Hemut-Chat</h1>
          <p className="auth-subtitle">
            {mode === 'login'
              ? 'Sign in to your workspace'
              : 'Create your account'}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <>
              <div className="form-group">
                <label htmlFor="email" className="input-label">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="form-group">
                <label htmlFor="display_name" className="input-label">Display Name (optional)</label>
                <input
                  id="display_name"
                  name="display_name"
                  type="text"
                  className="input"
                  placeholder="Your full name"
                  value={form.display_name}
                  onChange={handleChange}
                  autoComplete="name"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="username" className="input-label">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              className="input"
              placeholder="your_username"
              value={form.username}
              onChange={handleChange}
              required
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="input-label">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button
            id={mode === 'login' ? 'btn-login' : 'btn-register'}
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16 }} />
                {mode === 'login' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              mode === 'login' ? 'Sign In' : 'Create Account'
            )}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <button
                id="btn-switch-register"
                className="btn btn-ghost btn-sm"
                onClick={() => setMode('register')}
                type="button"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                id="btn-switch-login"
                className="btn btn-ghost btn-sm"
                onClick={() => setMode('login')}
                type="button"
              >
                Sign In
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
