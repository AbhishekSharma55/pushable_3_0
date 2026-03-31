# Authentication

Pushable AI uses a custom JWT-based authentication system. This document covers the complete auth flow, workspace-based multi-tenancy, role system, and agent permissions.

---

## Overview

| Aspect | Implementation |
|--------|---------------|
| **Strategy** | Custom JWT (JSON Web Tokens) |
| **Backend** | Fastify with `@fastify/jwt` plugin |
| **Frontend** | Axios interceptors + localStorage |
| **Password hashing** | bcryptjs (12 salt rounds) |
| **Validation** | Zod schemas |
| **Token storage** | Browser localStorage |
| **Multi-tenancy** | Workspace-scoped via `x-workspace-id` header |

---

## Backend Auth Setup

### JWT Plugin Registration

The JWT plugin is registered in the server entry point (`backend/src/index.ts`):

```typescript
import jwtPlugin from "@fastify/jwt";

await app.register(jwtPlugin, { secret: process.env.JWT_SECRET! });
```

The `JWT_SECRET` environment variable must be at least 32 characters.

### JWT Payload

Every issued token contains:

```typescript
interface JWTPayload {
  userId: string;   // UUID
  email: string;    // User's email address
}
```

Defined in `backend/src/lib/jwt.ts`.

---

## API Endpoints

### POST `/api/auth/register`

Creates a new user account, default workspace, and returns a JWT token.

**Request body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "minimum8chars"
}
```

**Validation (Zod):**
- `name` -- required, minimum 1 character
- `email` -- valid email format
- `password` -- minimum 8 characters

**What happens on registration:**

1. Check that the email is not already taken (throws `409 Conflict` if duplicate)
2. Hash the password with bcryptjs (12 salt rounds)
3. Create the user record in the `users` table
4. Generate a workspace slug from the user's name (e.g., `john-doe-4821`)
5. Create a default workspace named `"{Name}'s Workspace"`
6. Add the user as `owner` in `workspace_members`
7. Create a `credits` row for the new workspace (initial balance)
8. Sign and return a JWT token

**Response (201):**

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

### POST `/api/auth/login`

Authenticates an existing user and returns a JWT token.

**Request body:**

```json
{
  "email": "john@example.com",
  "password": "minimum8chars"
}
```

**What happens on login:**

1. Find the user by email (throws `401 Unauthorized` if not found)
2. Compare the provided password against the stored hash
3. If valid, sign and return a JWT token

**Response (200):**

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

---

## Route Protection

### Protected Routes (Require JWT)

All API routes except auth, blogs, contact, and health require a valid JWT. Protection is applied via a Fastify `onRequest` hook inside each route plugin:

```typescript
fastify.addHook("onRequest", async (request) => {
    try {
        await request.jwtVerify();
    } catch {
        throw new UnauthorizedError("Invalid or expired token");
    }
});
```

Protected routes also require the `x-workspace-id` header to scope all queries to the current workspace:

```
GET /api/agents
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
x-workspace-id: 550e8400-e29b-41d4-a716-446655440000
```

### Public Routes (No JWT)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/register` | POST | User registration |
| `/api/auth/login` | POST | User login |
| `/api/blogs` | GET | Public blog listings |
| `/api/blogs/:slug` | GET | Individual blog post |
| `/api/public/contact` | POST | Contact form submission |
| `/health` | GET | Health check |
| `/webhooks/*` | POST | External webhook receivers (Slack, Telegram) |

---

## Frontend Auth Flow

### Token Storage

The frontend stores auth state in browser `localStorage` using these keys (defined in `frontend/src/lib/constants.ts`):

| Key | Content |
|-----|---------|
| `pushable_token` | JWT token string |
| `pushable_user` | JSON-serialized user object `{id, name, email}` |
| `pushable_workspaces` | JSON array of user's workspaces |
| `pushable_active_workspace` | JSON object of the currently selected workspace |

Helper functions in `frontend/src/lib/auth.ts`:

```typescript
getToken()    // Returns token string or null
setToken()    // Stores token
removeToken() // Clears token

getUser()     // Returns parsed User object or null
setUser()     // Stores user
removeUser()  // Clears user
```

### Axios Client Interceptors

The API client (`frontend/src/lib/api/client.ts`) automatically handles auth:

**Request interceptor** -- Attaches the JWT token to every outgoing request:

```typescript
apiClient.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});
```

**Response interceptor** -- Handles 401 responses globally:

```typescript
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            removeToken();
            removeUser();
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);
```

If any API call returns a 401, the user is automatically logged out and redirected to `/login`.

### Login Flow

```
User enters email + password
  → POST /api/auth/login
  → Store token in localStorage (pushable_token)
  → Store user in localStorage (pushable_user)
  → GET /api/workspaces (fetch user's workspaces)
  → Store workspaces in localStorage
  → Set first workspace as active (if none selected)
  → Redirect to dashboard (/) or onboarding (/onboarding)
```

### Registration Flow

```
User enters name + email + password
  → POST /api/auth/register
  → Store token in localStorage
  → Store user in localStorage
  → GET /api/workspaces
  → No workspaces yet? → Redirect to /onboarding
  → Has workspaces? → Redirect to /
```

### Dashboard Protection

The dashboard layout (`frontend/src/app/(dashboard)/layout.tsx`) runs an auth check on every page load:

```
On mount:
  1. Check for token in localStorage
     → No token? Redirect to /login
  2. Fetch workspaces from API
     → API error (invalid token)? Redirect to /login
  3. No workspaces and not on /onboarding? → Redirect to /onboarding
  4. Has workspaces and on /onboarding? → Redirect to /
  5. Set first workspace as active if none selected
  6. Render dashboard
```

While this check runs, a loading spinner is shown ("Loading workspace...").

---

## Workspace-Based Multi-Tenancy

### How It Works

Every user can belong to multiple workspaces. All data (agents, sessions, knowledge bases, tools, etc.) is scoped to a workspace.

**Workspace selection:** The frontend stores the active workspace in localStorage. Every API call includes the `x-workspace-id` header, and the backend uses this to filter all database queries.

### Workspace Schema

```
workspaces
  ├── id (UUID, primary key)
  ├── name (text)           -- "John's Workspace"
  ├── slug (text, unique)   -- "john-doe-4821"
  ├── ownerId (UUID, FK)    -- references users.id
  ├── extensionApiKey (text) -- API key for Chrome extension auth
  ├── createdAt
  └── updatedAt
```

### Workspace Creation

Workspaces are created:
1. **Automatically** on user registration (one default workspace)
2. **Manually** via the workspace creation dialog in the sidebar

When a workspace is created:
- A `workspace_members` record is added with `role: "owner"`
- A `credits` record is created with the initial balance

---

## Role-Based Access Control

### Workspace Member Roles

| Role | Description |
|------|-------------|
| `owner` | Full control. Created automatically when a user creates a workspace. |
| `admin` | Administrative access. Can manage workspace settings and members. |
| `member` | Basic access. Can create agents, sessions, and use platform features. |

```
workspace_members
  ├── id (UUID)
  ├── workspaceId (UUID, FK → workspaces)
  ├── userId (UUID, FK → users)
  ├── role (enum: owner, admin, member)
  └── createdAt
```

### Agent-Level Permissions

Beyond workspace roles, each agent has granular permissions that control what it can do:

#### System Permissions

Boolean flags on the `agents` table:

| Permission | Default | Description |
|------------|---------|-------------|
| `systemLevelAccess` | `false` | Enables system-level operations |
| `canManageKB` | `false` | Agent can create/update/delete knowledge bases |
| `canManageSkills` | `false` | Agent can create/update/delete skills |
| `canManageTools` | `false` | Agent can create/update/delete tools |
| `canManageSchedules` | `false` | Agent can create/update/delete schedules |
| `canManageChannels` | `false` | Agent can manage channel connections |
| `canManageAgents` | `false` | Agent can create/modify other agents |
| `canManageBucket` | `false` | Agent can manage file storage |
| `canExecutePython` | `true` | Agent can run Python code in sandbox |
| `requireApprovalForAll` | `false` | All tool calls require user approval (HITL) |
| `browserEnabled` | `true` | Agent can use browser automation |

#### Resource Permissions

Fine-grained control over which specific resources an agent can access:

```
agent_permissions
  ├── id (UUID)
  ├── workspaceId (UUID, FK → workspaces)
  ├── agentId (UUID, FK → agents)
  ├── resourceType (enum: tool, kb, skill, agent)
  ├── resourceId (UUID)    -- ID of the specific resource
  ├── allowed (boolean)    -- true = permitted
  └── createdAt
```

This allows you to:
- Grant Agent A access to only Knowledge Base #1 and #2
- Allow Agent B to use Tool X but not Tool Y
- Let Agent C delegate work to Agent D but not Agent E

#### Permissions API

```
GET  /api/agents/:agentId/permissions   -- Fetch all permissions for an agent
POST /api/agents/:agentId/permissions   -- Set/update agent permissions
```

---

## Error Handling

The auth system uses structured error classes (`backend/src/lib/errors.ts`):

| Error Class | HTTP Status | Code | When Thrown |
|-------------|-------------|------|------------|
| `AppError` | 400 | `APP_ERROR` | Generic application error |
| `NotFoundError` | 404 | `NOT_FOUND` | Resource doesn't exist |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | Invalid/missing token, wrong password |
| `ForbiddenError` | 403 | `FORBIDDEN` | Insufficient permissions |
| `ConflictError` | 409 | `CONFLICT` | Email already taken |

**Zod validation errors** return 400 with detailed field-level messages:

```json
{
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "path": ["password"],
        "message": "Password must be at least 8 characters"
      }
    ]
  }
}
```

---

## Admin Panel Authentication

The admin panel (`admin-panel/`) uses a **separate authentication system** from the main platform:

- Uses the `jose` library for JWT operations (not `@fastify/jwt`)
- Has its own login page at `/login`
- Uses server actions (`loginAction`, `logoutAction`) instead of REST API calls
- Stores session in cookies (not localStorage)
- Directly queries the database (not via backend API)
- Has `AUTH_SECRET` and `ADMIN_COOKIE_SECURE` environment variables

This separation means admin credentials and sessions are independent from regular user accounts.

---

## Security Considerations

### Current Implementation

- **Password hashing:** bcryptjs with 12 salt rounds (strong, slow by design)
- **JWT secret:** Environment variable, must be 32+ characters
- **CORS:** Configured to allow credentials and specific headers (`Content-Type`, `Authorization`, `x-workspace-id`)
- **Input validation:** Zod schemas on all auth endpoints
- **Error messages:** Generic "Invalid email or password" (doesn't reveal which field is wrong)
- **Workspace isolation:** All queries filtered by `workspaceId` to prevent cross-tenant data access

### Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| Refresh tokens | Not implemented | Tokens don't expire by default |
| Password reset | Not implemented | No "forgot password" flow |
| Email verification | Not implemented | Accounts are active immediately |
| OAuth / Social login | Not implemented | Only email/password |
| Rate limiting | Not implemented | No brute-force protection on login endpoint |
| 2FA / MFA | Not implemented | No multi-factor authentication |
| Token expiration | Uses Fastify defaults | Consider setting explicit expiry |

### Token in localStorage

The JWT is stored in `localStorage`, which is accessible to JavaScript. This is simpler than httpOnly cookies but has trade-offs:

- **Pro:** Works easily with SPA architecture and multiple API endpoints
- **Con:** Vulnerable to XSS attacks (if an attacker can execute JavaScript, they can steal the token)

For enhanced security in production, consider migrating to httpOnly cookies with CSRF protection.

---

## Database Schema Reference

### users

```sql
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### workspaces

```sql
CREATE TABLE workspaces (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL UNIQUE,
    owner_id          UUID NOT NULL REFERENCES users(id),
    extension_api_key TEXT,
    created_at        TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at        TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### workspace_members

```sql
CREATE TABLE workspace_members (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         member_role DEFAULT 'member' NOT NULL,  -- enum: owner, admin, member
    created_at   TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### agent_permissions

```sql
CREATE TABLE agent_permissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    resource_type resource_type NOT NULL,  -- enum: tool, kb, skill, agent
    resource_id   UUID NOT NULL,
    allowed       BOOLEAN DEFAULT TRUE NOT NULL,
    created_at    TIMESTAMP DEFAULT NOW() NOT NULL
);
```

---

## Complete Auth Flow Diagram

```
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
        │  /login   │ │/register│ │ /dashboard │
        └─────┬─────┘ └───┬───┘ └─────┬─────┘
              │            │            │
              │ POST       │ POST       │ Check localStorage
              │ /auth/login│ /auth/register│ for token
              ▼            ▼            │
        ┌──────────────────────┐       │ No token?
        │     Backend API      │       │───────────→ Redirect to /login
        │  ┌────────────────┐  │       │
        │  │ Zod validation │  │       │ Has token?
        │  └───────┬────────┘  │       │───→ GET /api/workspaces
        │          │           │       │         │
        │  ┌───────▼────────┐  │       │    ┌────▼────┐
        │  │ bcrypt compare  │  │       │    │ Valid?  │
        │  │ or hash+create │  │       │    └────┬────┘
        │  └───────┬────────┘  │       │    Yes  │  No
        │          │           │       │    │    └──→ Clear localStorage
        │  ┌───────▼────────┐  │       │    │        → Redirect to /login
        │  │  JWT sign       │  │       │    │
        │  │  {userId,email} │  │       │    ▼
        │  └───────┬────────┘  │       │  Has workspaces?
        │          │           │       │  No → /onboarding
        └──────────┼───────────┘       │  Yes → Render dashboard
                   │                   │
                   ▼                   │
            ┌──────────────┐           │
            │  Frontend    │           │
            │  stores in   │◀──────────┘
            │  localStorage│
            │  • token     │
            │  • user      │
            │  • workspaces│
            └──────────────┘
```

---

## Next Steps

- [Agent System](./04-agent-system.md) -- How agents are created, configured, and executed
- [Chat & Conversations](./05-chat-conversations.md) -- Real-time chat with streaming
