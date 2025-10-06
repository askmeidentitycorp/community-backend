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

## Env values 
PORT=3000
MONGODB_URI=
REDIS_URL=
JWT_SECRET=devsecret
JWT_ACCESS_TTL=3600
JWT_REFRESH_TTL=604800
AUTH0_DOMAIN=
AUTH0_AUDIENCE=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_ISSUER=
AUTH0_TENANT_CLAIM=
FRONTEND_BASE_URL=
BACKEND_BASE_URL=
AWS_REGION=us-east-1
CHIME_APP_INSTANCE_ARN=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=


## License

[License details]

# Production Environment Variables for Cloud Run
# Copy this to .env.production and fill in your actual values

# Application Configuration
NODE_ENV=production
PORT=8080

# Tenant Configuration
TENANT_ID=tenant1
TENANT_NAME=Tenant 1
MONGODB_DATABASE=tenant1_discussion

# Database Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net
# Alternative: MONGODB_URI=mongodb://username:password@host:port

# Redis Configuration
REDIS_URL=redis://username:password@host:port
REDIS_SESSION_TTL=86400
REDIS_CACHE_TTL=3600

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here
JWT_ACCESS_TTL=3600
JWT_REFRESH_TTL=604800
JWT_ACCESS_TOKEN_LIFETIME=3600
JWT_REFRESH_TOKEN_LIFETIME=604800

# Auth0 Configuration
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_AUDIENCE=your-audience
AUTH0_ISSUER=https://your-domain.auth0.com/
AUTH0_TENANT_CLAIM=https://app.example.com/tenantId

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Application URLs
BACKEND_BASE_URL=https://your-service-name-hash-region.a.run.app
FRONTEND_BASE_URL=https://your-frontend-domain.com

# CORS Configuration (for production)
CORS_ORIGIN=https://your-frontend-domain.com
