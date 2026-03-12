import { randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { StudioConfig } from "./config.js";

const SESSION_COOKIE = "switch_manager_studio_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 24;

interface StudioAuthSession {
  id: string;
  haBaseUrl: string;
  accessToken: string;
  createdAt: number;
  lastUsedAt: number;
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseCookieHeader(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) {
        return cookies;
      }
      cookies[entry.slice(0, separator)] = decodeURIComponent(entry.slice(separator + 1));
      return cookies;
    }, {});
}

function serializeCookie(name: string, value: string, expiresImmediately = false): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (expiresImmediately) {
    parts.push("Max-Age=0");
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  return parts.join("; ");
}

export class StudioAuthManager {
  private readonly sessions = new Map<string, StudioAuthSession>();

  clearSession(request: FastifyRequest, reply: FastifyReply): void {
    const session = this.getSession(request);
    if (session) {
      this.sessions.delete(session.id);
    }
    reply.header("Set-Cookie", serializeCookie(SESSION_COOKIE, "", true));
  }

  createSession(
    reply: FastifyReply,
    credentials: {
      accessToken: string;
      haBaseUrl: string;
    }
  ): StudioAuthSession {
    this.purgeExpired();
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
      if (!oldest) {
        break;
      }
      this.sessions.delete(oldest.id);
    }

    const session: StudioAuthSession = {
      id: randomBytes(24).toString("base64url"),
      haBaseUrl: cleanBaseUrl(credentials.haBaseUrl),
      accessToken: credentials.accessToken.trim(),
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };
    this.sessions.set(session.id, session);
    reply.header("Set-Cookie", serializeCookie(SESSION_COOKIE, session.id));
    return session;
  }

  getSession(request: FastifyRequest): StudioAuthSession | null {
    this.purgeExpired();
    const sessionId = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
    if (!sessionId) {
      return null;
    }
    const session = this.sessions.get(sessionId) ?? null;
    if (!session) {
      return null;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  status(request: FastifyRequest, config: StudioConfig): {
    authenticated: boolean;
    defaultHaBaseUrl: string | null;
    haBaseUrl: string | null;
  } {
    const session = this.getSession(request);
    return {
      authenticated: Boolean(session),
      haBaseUrl: session?.haBaseUrl ?? null,
      defaultHaBaseUrl: config.defaultHaBaseUrl
    };
  }

  unauthorized(reply: FastifyReply): { error: string } {
    reply.code(401);
    return {
      error: "Authentication required. Enter a Home Assistant base URL and long-lived access token."
    };
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastUsedAt < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
