import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authHeaders,
  clearToken,
  getToken,
  handleUnauthorized,
  setToken,
  setUnauthorizedHandler,
} from './token';

afterEach(() => {
  clearToken();
  setUnauthorizedHandler(null);
});

describe('token store', () => {
  it('persists, reads, and clears the token', () => {
    expect(getToken()).toBeNull();
    setToken('abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('builds an Authorization header only when a token is present', () => {
    expect(authHeaders()).toEqual({});
    setToken('jwt123');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer jwt123' });
  });

  it('handleUnauthorized clears the token and invokes the handler', () => {
    const handler = vi.fn();
    setToken('jwt123');
    setUnauthorizedHandler(handler);
    handleUnauthorized();
    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
  });
});
