# Community Backend

A multi-tenant discussion platform backend with Auth0 integration, user management, and tenant isolation.

## Features

- Multi-tenant architecture with tenant isolation
- Auth0 integration for authentication
- Role-based access control (RBAC)
- User management with profiles and preferences
- Session management with JWT
- Tenant management with activation workflows

## Prerequisites

- Node.js 18+
- MongoDB 6+
- Redis 7+ (optional, but recommended for sessions and caching)
- Auth0 account with a tenant and a Machine-to-Machine app

## Setup

1. Clone the repository
```bash
git clone <repository-url>
cd community-backend
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
# Copy the example env file
cp .env.example .env

# Edit the .env file with your own settings
nano .env
```

4. Start the development server
```bash
npm run dev
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `MONGODB_URI`: MongoDB connection URI
- `REDIS_URL`: Redis connection URI
- `JWT_SECRET`: Secret key for signing JWTs
- `JWT_ACCESS_TTL`: Access token time-to-live in seconds
- `JWT_REFRESH_TTL`: Refresh token time-to-live in seconds
- `AUTH0_DOMAIN`: Your Auth0 domain
- `AUTH0_AUDIENCE`: API audience for Auth0
- `AUTH0_CLIENT_ID`: Auth0 M2M client ID
- `AUTH0_CLIENT_SECRET`: Auth0 M2M client secret
- `AUTH0_ISSUER`: Auth0 issuer URL
- `AUTH0_TENANT_CLAIM`: Custom claim namespace for tenant ID

## API Routes

### Authentication
- `POST /api/auth/token`: Exchange Auth0 token for platform JWT
- `POST /api/auth/refresh`: Refresh access token
- `POST /api/auth/logout`: Logout (revoke session)
- `POST /api/auth/validate`: Validate platform JWT

### Tenant Management
- `POST /api/tenants/register`: Register a new tenant
- `POST /api/tenants/:tenantId/verify`: Verify a tenant
- `POST /api/tenants/:tenantId/activate`: Activate a tenant
- `GET /api/tenants/:tenantId`: Get tenant details
- `GET /api/tenants`: List tenants (super_admin only)
- `PUT /api/tenants/:tenantId`: Update tenant
- `POST /api/tenants/:tenantId/suspend`: Suspend tenant
- `POST /api/tenants/:tenantId/resume`: Resume tenant
- `POST /api/tenants/:tenantId/archive`: Archive tenant
- `POST /api/tenants/:tenantId/admins`: Add tenant admin
- `DELETE /api/tenants/:tenantId/admins/:userId`: Remove tenant admin

### User Management
- `POST /api/tenants/:tenantId/users/upsert`: Upsert a user
- `GET /api/tenants/:tenantId/users`: List users
- `GET /api/tenants/:tenantId/users/:userId`: Get user by ID
- `PUT /api/tenants/:tenantId/users/me`: Update self
- `PUT /api/tenants/:tenantId/users/:userId`: Update user (admin)
- `POST /api/tenants/:tenantId/users/:userId/roles`: Assign roles
- `DELETE /api/tenants/:tenantId/users/:userId/roles/:role`: Remove role
- `POST /api/tenants/:tenantId/users/:userId/deactivate`: Deactivate user
- `POST /api/tenants/:tenantId/users/:userId/reactivate`: Reactivate user
- `POST /api/tenants/:tenantId/users/:userId/block`: Block user in Auth0
- `POST /api/tenants/:tenantId/users/:userId/unblock`: Unblock user in Auth0
- `POST /api/tenants/:tenantId/users/invite`: Invite user
- `POST /api/tenants/:tenantId/users/sync`: Sync user from Auth0

### Session Management
- `GET /api/tenants/:tenantId/auth/sessions`: Get sessions
- `POST /api/tenants/:tenantId/auth/sessions/revoke`: Revoke session
- `POST /api/tenants/:tenantId/auth/sessions/revoke-all`: Revoke all sessions

## License

[License details]
