import type { User, UserMode } from '../../types';

const DEFAULT_AUTH_API_URL = 'http://localhost:8081';
const REQUEST_TIMEOUT_MS = 10_000;

export type UserServiceRole = 'rider' | 'driver' | 'admin';
export type UserServiceAccountStatus = 'active' | 'deactivated' | 'deleted';

export interface UserServiceUser {
  id: string;
  email: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  role: UserServiceRole;
  is_active: boolean;
  is_verified: boolean;
  account_status?: UserServiceAccountStatus;
  terms_version?: string;
  terms_accepted_at?: string;
  profile_image?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserServiceSession {
  id: string;
  remember_me: boolean;
  device_name?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  current: boolean;
}

export interface RegisterUserRequest {
  email: string;
  password: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  role: 'rider';
  terms_version: string;
}

export interface LoginUserRequest {
  email: string;
  password: string;
  remember_me: boolean;
  device_name: string;
}

export interface LoginUserResponse {
  user: UserServiceUser;
  token: string;
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  session: UserServiceSession;
}

export interface UpdateUserProfileRequest {
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  profile_image?: string | null;
  current_password?: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface RecoveryCodeResetRequest {
  email: string;
  recovery_code: string;
  new_password: string;
}

export interface ReactivateAccountRequest {
  email: string;
  password: string;
  remember_me: boolean;
  device_name: string;
}

interface MessageResponse {
  message: string;
}

interface RecoveryCodesResponse {
  recovery_codes: string[];
}

interface UserServiceEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: number;
    error_code?: string;
    message?: string;
  };
  correlation_id?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
}

export class UserServiceError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;

  constructor(message: string, status = 0, code?: string, correlationId?: string) {
    super(message);
    this.name = 'UserServiceError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

export const getUserServiceBaseUrl = (): string => {
  const configuredUrl = process.env.EXPO_PUBLIC_AUTH_API_URL?.trim();
  const resolvedUrl = (configuredUrl || DEFAULT_AUTH_API_URL).replace(/\/+$/, '');
  const isDevelopment = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

  if (!isDevelopment && !resolvedUrl.startsWith('https://')) {
    throw new UserServiceError(
      'The production user-service URL must use HTTPS.',
      0,
      'INSECURE_API_URL',
    );
  }

  return resolvedUrl;
};

export const mapUserServiceUser = (
  user: UserServiceUser,
): { user: User; mode: UserMode } => {
  if (user.role !== 'rider') {
    throw new UserServiceError(
      'This account cannot enter Patient Mode. Driver access requires a separately approved driver profile.',
      403,
      'UNSUPPORTED_ROLE',
    );
  }

  const mode: UserMode = 'user';
  const firstName = user.first_name.trim();
  const lastName = user.last_name.trim();

  return {
    mode,
    user: {
      id: user.id,
      auth_source: 'user-service',
      full_name: [firstName, lastName].filter(Boolean).join(' '),
      first_name: firstName,
      last_name: lastName,
      email: user.email,
      phone: user.phone_number,
      avatar_url: user.profile_image || undefined,
      is_verified: user.is_verified,
      mode,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
  };
};

const parseEnvelope = <T>(rawBody: string, status: number): UserServiceEnvelope<T> => {
  try {
    const parsed = JSON.parse(rawBody) as UserServiceEnvelope<T> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.success !== 'boolean') {
      throw new Error('Invalid response envelope');
    }
    return parsed;
  } catch {
    throw new UserServiceError(
      `User service returned an invalid response (${status}).`,
      status,
      'INVALID_RESPONSE',
    );
  }
};

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  try {
    const response = await fetch(`${getUserServiceBaseUrl()}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const envelope = parseEnvelope<T>(await response.text(), response.status);

    if (!response.ok || !envelope.success || envelope.data == null) {
      throw new UserServiceError(
        envelope.error?.message || `User service request failed (${response.status}).`,
        response.status,
        envelope.error?.error_code,
        envelope.correlation_id,
      );
    }

    return envelope.data;
  } catch (error) {
    if (error instanceof UserServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UserServiceError('User service request timed out.', 0, 'REQUEST_TIMEOUT');
    }
    throw new UserServiceError(
      'Could not reach the user service. Check the API URL and your connection.',
      0,
      'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const userService = {
  register(input: RegisterUserRequest): Promise<UserServiceUser> {
    return request<UserServiceUser>('/api/v1/auth/register', { method: 'POST', body: input });
  },

  login(input: LoginUserRequest): Promise<LoginUserResponse> {
    return request<LoginUserResponse>('/api/v1/auth/login', { method: 'POST', body: input });
  },

  refresh(refreshToken: string): Promise<LoginUserResponse> {
    return request<LoginUserResponse>('/api/v1/auth/token/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
  },

  reactivate(input: ReactivateAccountRequest): Promise<LoginUserResponse> {
    return request<LoginUserResponse>('/api/v1/auth/account/reactivate', {
      method: 'POST',
      body: input,
    });
  },

  resetPasswordWithRecoveryCode(input: RecoveryCodeResetRequest): Promise<MessageResponse> {
    return request<MessageResponse>('/api/v1/auth/password/reset/recovery-code', {
      method: 'POST',
      body: input,
    });
  },

  logout(token: string): Promise<MessageResponse> {
    return request<MessageResponse>('/api/v1/auth/logout', { method: 'POST', token });
  },

  getProfile(token: string): Promise<UserServiceUser> {
    return request<UserServiceUser>('/api/v1/auth/profile', { token });
  },

  updateProfile(token: string, input: UpdateUserProfileRequest): Promise<UserServiceUser> {
    return request<UserServiceUser>('/api/v1/auth/profile', {
      method: 'PATCH',
      body: input,
      token,
    });
  },

  listSessions(token: string): Promise<UserServiceSession[]> {
    return request<UserServiceSession[]>('/api/v1/auth/sessions', { token });
  },

  revokeSession(token: string, sessionId: string): Promise<MessageResponse> {
    return request<MessageResponse>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      token,
    });
  },

  revokeAllSessions(token: string, currentPassword: string): Promise<MessageResponse> {
    return request<MessageResponse>('/api/v1/auth/sessions/revoke-all', {
      method: 'POST',
      body: { current_password: currentPassword },
      token,
    });
  },

  changePassword(token: string, input: ChangePasswordRequest): Promise<MessageResponse> {
    return request<MessageResponse>('/api/v1/auth/password/change', {
      method: 'POST',
      body: input,
      token,
    });
  },

  regenerateRecoveryCodes(token: string, currentPassword: string): Promise<string[]> {
    return request<RecoveryCodesResponse>('/api/v1/auth/recovery-codes/regenerate', {
      method: 'POST',
      body: { current_password: currentPassword },
      token,
    }).then((response) => response.recovery_codes);
  },

  deactivateAccount(token: string, currentPassword: string): Promise<MessageResponse> {
    return request<MessageResponse>('/api/v1/auth/account/deactivate', {
      method: 'POST',
      body: { current_password: currentPassword },
      token,
    });
  },

  deleteAccount(token: string, currentPassword: string): Promise<MessageResponse> {
    return request<MessageResponse>('/api/v1/auth/account', {
      method: 'DELETE',
      body: { current_password: currentPassword },
      token,
    });
  },
};
