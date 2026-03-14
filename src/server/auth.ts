import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { StudioConfig } from "./config.js";

const SESSION_COOKIE = "switch_manager_studio_session";
const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years — internal tool, no expiry
const MAX_SESSIONS = 24;
const SESSION_PERSIST_INTERVAL_MS = 60 * 1000;

interface StudioAuthSession {
  id: string;
  haBaseUrl: string;
  accessToken: string;
  createdAt: number;
  lastUsedAt: number;
}

interface SessionStoreFile {
  sessions: StudioAuthSession[];
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
  } else {
    parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    parts.push(`Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString()}`);
  }
  return parts.join("; ");
}

export class StudioAuthManager {
  private readonly sessions = new Map<string, StudioAuthSession>();
  private readonly sessionStorePath: string;
  private dirty = false;
  private lastPersistedAt = 0;

  constructor(config: StudioConfig) {
    this.sessionStorePath = config.authSessionStorePath;
    this.loadPersistedSessions();
  }

  clearSession(request: FastifyRequest, reply: FastifyReply): void {
    const session = this.getSession(request);
    if (session) {
      this.sessions.delete(session.id);
      this.markDirty();
    }
    this.persistSessions(true);
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
    this.markDirty();
    this.persistSessions(true);
    reply.header("Set-Cookie", serializeCookie(SESSION_COOKIE, session.id));
    return session;
  }

  getSession(request: FastifyRequest, reply?: FastifyReply): StudioAuthSession | null {
    this.purgeExpired();
    const sessionId = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
    if (sessionId) {
      const session = this.sessions.get(sessionId) ?? null;
      if (session) {
        session.lastUsedAt = Date.now();
        this.markDirty();
        this.persistSessions();
        return session;
      }
    }
    // No valid cookie — auto-assign the most recently used session if one exists.
    // This means any browser on the LAN is automatically authenticated once the token
    // has been configured. The auth screen only appears during initial onboarding when
    // no session exists yet.
    if (this.sessions.size > 0) {
      const session = [...this.sessions.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
      if (session) {
        session.lastUsedAt = Date.now();
        this.markDirty();
        this.persistSessions();
        if (reply) {
          reply.header("Set-Cookie", serializeCookie(SESSION_COOKIE, session.id));
        }
        return session;
      }
    }
    return null;
  }

  status(request: FastifyRequest, reply: FastifyReply, config: StudioConfig): {
    authenticated: boolean;
    defaultHaBaseUrl: string | null;
    haBaseUrl: string | null;
  } {
    const session = this.getSession(request, reply);
    return {
      authenticated: Boolean(session),
      haBaseUrl: session?.haBaseUrl ?? null,
      defaultHaBaseUrl: config.haBaseUrl
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
    let removed = false;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastUsedAt < cutoff) {
        this.sessions.delete(sessionId);
        removed = true;
      }
    }
    if (removed) {
      this.markDirty();
      this.persistSessions(true);
    }
  }

  private loadPersistedSessions(): void {
    if (!existsSync(this.sessionStorePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.sessionStorePath, "utf8")) as Partial<SessionStoreFile>;
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      for (const rawSession of sessions) {
        if (
          typeof rawSession?.id !== "string" ||
          typeof rawSession?.haBaseUrl !== "string" ||
          typeof rawSession?.accessToken !== "string" ||
          typeof rawSession?.createdAt !== "number" ||
          typeof rawSession?.lastUsedAt !== "number"
        ) {
          continue;
        }
        this.sessions.set(rawSession.id, {
          accessToken: rawSession.accessToken,
          createdAt: rawSession.createdAt,
          haBaseUrl: cleanBaseUrl(rawSession.haBaseUrl),
          id: rawSession.id,
          lastUsedAt: rawSession.lastUsedAt
        });
      }
      this.dirty = false;
      this.lastPersistedAt = Date.now();
      this.purgeExpired();
    } catch (error) {
      console.warn("Could not load persisted auth sessions:", error);
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private persistSessions(force = false): void {
    if (!this.dirty) {
      return;
    }
    if (!force && Date.now() - this.lastPersistedAt < SESSION_PERSIST_INTERVAL_MS) {
      return;
    }

    const payload: SessionStoreFile = {
      sessions: [...this.sessions.values()]
    };
    const directory = dirname(this.sessionStorePath);
    const tempPath = `${this.sessionStorePath}.tmp`;

    mkdirSync(directory, { recursive: true });

    if (payload.sessions.length === 0) {
      if (existsSync(this.sessionStorePath)) {
        unlinkSync(this.sessionStorePath);
      }
      this.dirty = false;
      this.lastPersistedAt = Date.now();
      return;
    }

    writeFileSync(tempPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, this.sessionStorePath);
    try {
      chmodSync(this.sessionStorePath, 0o600);
    } catch {
      // Ignore platforms that do not support chmod semantics here.
    }
    this.dirty = false;
    this.lastPersistedAt = Date.now();
  }
}
