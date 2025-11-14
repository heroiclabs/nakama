# Nakama Docker Deployment Guide for JavaScript ES Modules

This guide shows the correct Docker setup for deploying Nakama with JavaScript ES modules.

---

## The Problem

When you see this error:
```
ReferenceError: require is not defined at index.js:5:26(6)
Failed to eval JavaScript modules
Failed initializing JavaScript runtime provider
```

It means:
1. Your JavaScript files use CommonJS (`require`), not ES modules (`import`)
2. Your modules might not be mounted correctly in Docker
3. Your entry point doesn't have the correct `export default InitModule`

---

## Correct Docker Setup

### Directory Structure

```
/your-nakama-project/
├── docker-compose.yml
├── data/
│   └── modules/
│       ├── index.js              # ESM: export default InitModule
│       ├── my_module.js          # ESM: export function ...
│       └── utils/
│           └── helper.js         # ESM: export function ...
└── .env (optional)
```

### Complete `docker-compose.yml`

```yaml
version: '3'

services:
  # Database (CockroachDB)
  cockroachdb:
    image: cockroachdb/cockroach:latest-v24.1
    command: start-single-node --insecure --store=attrs=ssd,path=/var/lib/cockroach/
    restart: unless-stopped
    volumes:
      - cockroach_data:/var/lib/cockroach
    ports:
      - "26257:26257"  # SQL port
      - "8080:8080"    # Admin UI
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health?ready=1"]
      interval: 3s
      timeout: 3s
      retries: 5
    networks:
      - nakama

  # Nakama Server
  nakama:
    image: heroiclabs/nakama:3.22.0
    entrypoint:
      - "/bin/sh"
      - "-ecx"
      - >
        /nakama/nakama migrate up --database.address root@cockroachdb:26257 &&
        exec /nakama/nakama --name nakama1 --database.address root@cockroachdb:26257 --logger.level DEBUG --session.token_expiry_sec 7200
    restart: unless-stopped
    depends_on:
      cockroachdb:
        condition: service_healthy
    volumes:
      # ✅ CORRECT: Mount your ES modules directory
      - ./data/modules:/nakama/data/modules:ro
    environment:
      # Optional: Set environment variables
      - NAKAMA_DATABASE_ADDRESS=root@cockroachdb:26257
    ports:
      - "7349:7349"  # gRPC API
      - "7350:7350"  # HTTP API
      - "7351:7351"  # Console UI
    healthcheck:
      test: ["CMD", "/nakama/nakama", "healthcheck"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - nakama

networks:
  nakama:
    driver: bridge

volumes:
  cockroach_data:
```

### Key Configuration Points

#### 1. Volume Mounting

```yaml
volumes:
  # ✅ CORRECT: Mount modules directory
  - ./data/modules:/nakama/data/modules:ro
  
  # ❌ WRONG: Don't mount entire project
  - ./:/nakama/data
  
  # ❌ WRONG: Don't mount parent directory
  - ..:/nakama/data
```

**Explanation:**
- `./data/modules` - Your local modules directory
- `/nakama/data/modules` - Where Nakama expects modules inside container
- `:ro` - Read-only (optional, for safety)

#### 2. Module Path in Container

Nakama automatically loads JavaScript from:
```
/nakama/data/modules/
```

So your `index.js` must be at:
```
/nakama/data/modules/index.js
```

#### 3. Logger Level

For debugging, use `DEBUG` level:
```yaml
--logger.level DEBUG
```

For production, use `INFO` or `WARN`:
```yaml
--logger.level INFO
```

---

## Minimal Example Files

### 1. `data/modules/index.js` (Required)

This is your **main entry point**. It MUST export a default InitModule function.

```javascript
// index.js - Main entry point for Nakama JavaScript runtime

// Import your modules
import { rpcTest } from './my_module.js';
import { helperFunction } from './utils/helper.js';

/**
 * Main initialization function
 * This is called by Nakama when the server starts
 */
export default function InitModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Starting Nakama JavaScript Runtime');
    logger.info('========================================');
    
    try {
        // Register RPC functions
        initializer.registerRpc('test', rpcTest);
        logger.info('✅ Registered RPC: test');
        
        logger.info('========================================');
        logger.info('Initialization Complete');
        logger.info('========================================');
    } catch (err) {
        logger.error('❌ Initialization failed: ' + err.message);
        throw err;
    }
}
```

### 2. `data/modules/my_module.js`

```javascript
// my_module.js - Example RPC module

import { helperFunction } from './utils/helper.js';

/**
 * RPC: Simple test function
 * @param {object} ctx - Nakama context (userId, username, etc.)
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON string from client
 * @returns {string} JSON response
 */
export function rpcTest(ctx, logger, nk, payload) {
    logger.info('rpcTest called by user: ' + ctx.userId);
    
    try {
        // Parse input
        const input = payload ? JSON.parse(payload) : {};
        const message = input.message || 'Hello from Nakama!';
        
        // Use helper function
        const timestamp = helperFunction();
        
        // Return response
        return JSON.stringify({
            success: true,
            message: message,
            timestamp: timestamp,
            userId: ctx.userId
        });
    } catch (err) {
        logger.error('rpcTest error: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}
```

### 3. `data/modules/utils/helper.js`

```javascript
// utils/helper.js - Utility functions

/**
 * Get current timestamp
 * @returns {string} ISO timestamp
 */
export function helperFunction() {
    return new Date().toISOString();
}

/**
 * Validate user input
 * @param {string} input - Input to validate
 * @returns {boolean} True if valid
 */
export function validateInput(input) {
    return typeof input === 'string' && input.length > 0;
}
```

---

## Running Locally

### Step 1: Create Directory Structure

```bash
mkdir -p /path/to/your/project/data/modules/utils
cd /path/to/your/project
```

### Step 2: Create Files

Create the three files shown above:
- `data/modules/index.js`
- `data/modules/my_module.js`
- `data/modules/utils/helper.js`

### Step 3: Create `docker-compose.yml`

Use the complete example from above.

### Step 4: Start Services

```bash
docker-compose up
```

Or in detached mode:
```bash
docker-compose up -d
```

### Step 5: Check Logs

```bash
docker-compose logs -f nakama
```

---

## Expected Successful Logs

When everything works correctly, you should see:

```json
{"level":"info","ts":"2024-01-15T10:00:00.000Z","msg":"Nakama starting"}
{"level":"info","ts":"2024-01-15T10:00:00.100Z","msg":"Database connection verified"}
{"level":"info","ts":"2024-01-15T10:00:00.200Z","msg":"Loading JavaScript modules"}
{"level":"info","ts":"2024-01-15T10:00:00.300Z","msg":"========================================"}
{"level":"info","ts":"2024-01-15T10:00:00.301Z","msg":"Starting Nakama JavaScript Runtime"}
{"level":"info","ts":"2024-01-15T10:00:00.302Z","msg":"========================================"}
{"level":"info","ts":"2024-01-15T10:00:00.303Z","msg":"✅ Registered RPC: test"}
{"level":"info","ts":"2024-01-15T10:00:00.304Z","msg":"========================================"}
{"level":"info","ts":"2024-01-15T10:00:00.305Z","msg":"Initialization Complete"}
{"level":"info","ts":"2024-01-15T10:00:00.306Z","msg":"========================================"}
{"level":"info","ts":"2024-01-15T10:00:00.400Z","msg":"Startup done"}
{"level":"info","ts":"2024-01-15T10:00:00.500Z","msg":"API server listening","port":7350}
```

**Key indicators of success:**
- ✅ "Loading JavaScript modules"
- ✅ Your custom log messages from InitModule
- ✅ "Registered RPC: test"
- ✅ "Startup done"
- ✅ "API server listening"

---

## Testing Your RPC

### 1. Access Nakama Console

Open browser to: http://localhost:7351

Default credentials:
- Username: `admin`
- Password: `password`

### 2. Create Test User

In console, go to "Users" → "Create User"

Or use cURL:
```bash
curl -X POST http://localhost:7350/v2/account/authenticate/device \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "test-device-123",
    "create": true,
    "username": "testuser"
  }'
```

Save the `token` from response.

### 3. Call Your RPC

```bash
curl -X POST http://localhost:7350/v2/rpc/test \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from client!"}'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Hello from client!",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "userId": "00000000-0000-0000-0000-000000000000"
}
```

---

## Advanced Docker Configuration

### With PostgreSQL Instead of CockroachDB

```yaml
version: '3'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nakama
      POSTGRES_USER: nakama
      POSTGRES_PASSWORD: localdb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nakama"]
      interval: 5s
      timeout: 5s
      retries: 5

  nakama:
    image: heroiclabs/nakama:3.22.0
    entrypoint:
      - "/bin/sh"
      - "-ecx"
      - >
        /nakama/nakama migrate up --database.address postgres:localdb@postgres:5432/nakama &&
        exec /nakama/nakama --database.address postgres:localdb@postgres:5432/nakama
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./data/modules:/nakama/data/modules:ro
    ports:
      - "7350:7350"
      - "7351:7351"

volumes:
  postgres_data:
```

### With Environment File

Create `.env`:
```env
# Database
DB_ADDRESS=root@cockroachdb:26257

# Nakama
NAKAMA_NAME=nakama1
NAKAMA_LOG_LEVEL=DEBUG
NAKAMA_SESSION_TOKEN_EXPIRY_SEC=7200

# Ports
NAKAMA_HTTP_PORT=7350
NAKAMA_CONSOLE_PORT=7351
NAKAMA_GRPC_PORT=7349
```

Update `docker-compose.yml`:
```yaml
services:
  nakama:
    image: heroiclabs/nakama:3.22.0
    env_file:
      - .env
    command: >
      --database.address ${DB_ADDRESS}
      --logger.level ${NAKAMA_LOG_LEVEL}
      --session.token_expiry_sec ${NAKAMA_SESSION_TOKEN_EXPIRY_SEC}
```

### With Custom Nakama Config File

Create `data/nakama-config.yml`:
```yaml
name: nakama1
database:
  address:
    - "root@cockroachdb:26257"
logger:
  level: "DEBUG"
session:
  token_expiry_sec: 7200
console:
  port: 7351
  username: "admin"
  password: "password"
socket:
  port: 7350
runtime:
  js_entrypoint: "index.js"
```

Update `docker-compose.yml`:
```yaml
services:
  nakama:
    image: heroiclabs/nakama:3.22.0
    volumes:
      - ./data/modules:/nakama/data/modules:ro
      - ./data/nakama-config.yml:/nakama/data/local.yml:ro
    command: --config /nakama/data/local.yml
```

---

## Troubleshooting

### Error: "require is not defined"

**Problem:** Still using CommonJS syntax.

**Solution:** 
1. Check all `.js` files use `import`/`export`, not `require`
2. Verify `index.js` has `export default function InitModule`
3. Make sure all imports include `.js` extension

### Error: "Failed to load JavaScript modules"

**Problem:** Modules not mounted correctly.

**Solution:**
```yaml
# Check your docker-compose.yml has:
volumes:
  - ./data/modules:/nakama/data/modules
```

### Error: "Cannot find module"

**Problem:** Import path is wrong.

**Solution:**
```javascript
// ✅ CORRECT (with .js extension)
import { x } from './my_module.js';

// ❌ WRONG (missing .js)
import { x } from './my_module';

// ✅ CORRECT (relative path)
import { x } from '../utils/helper.js';

// ❌ WRONG (absolute path)
import { x } from '/utils/helper.js';
```

### No Logs Appear

**Problem:** Logger level too high.

**Solution:** Set `--logger.level DEBUG` in docker-compose.yml.

### Nakama Container Keeps Restarting

**Problem:** Database not ready or InitModule throws error.

**Solution:**
1. Check database health: `docker-compose ps`
2. View logs: `docker-compose logs nakama`
3. Add error handling in InitModule:
```javascript
try {
    initializer.registerRpc('test', rpcTest);
} catch (err) {
    logger.error('Failed to register RPC: ' + err.message);
    // Don't throw - continue initialization
}
```

---

## Production Deployment

### 1. Use Read-Only Mounts

```yaml
volumes:
  - ./data/modules:/nakama/data/modules:ro
```

### 2. Set Restart Policy

```yaml
restart: unless-stopped
```

### 3. Use Specific Image Version

```yaml
# ✅ GOOD (pinned version)
image: heroiclabs/nakama:3.22.0

# ❌ BAD (floating tag)
image: heroiclabs/nakama:latest
```

### 4. Enable TLS

```yaml
nakama:
  command: >
    --database.address root@db:26257
    --socket.ssl_certificate /nakama/data/cert.pem
    --socket.ssl_private_key /nakama/data/key.pem
  volumes:
    - ./certs/cert.pem:/nakama/data/cert.pem:ro
    - ./certs/key.pem:/nakama/data/key.pem:ro
```

### 5. Health Monitoring

```yaml
healthcheck:
  test: ["CMD", "/nakama/nakama", "healthcheck"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

---

## Complete Working Example

### File: `data/modules/index.js`

```javascript
import { rpcTest } from './my_module.js';

export default function InitModule(ctx, logger, nk, initializer) {
    logger.info('🚀 Nakama JavaScript Runtime Starting');
    initializer.registerRpc('test', rpcTest);
    logger.info('✅ RPC registered: test');
    logger.info('🎉 Initialization complete');
}
```

### File: `data/modules/my_module.js`

```javascript
export function rpcTest(ctx, logger, nk, payload) {
    logger.info('rpcTest called');
    return JSON.stringify({
        success: true,
        message: 'Hello from Nakama ES Modules!',
        userId: ctx.userId,
        timestamp: new Date().toISOString()
    });
}
```

### File: `docker-compose.yml`

```yaml
version: '3'
services:
  cockroachdb:
    image: cockroachdb/cockroach:latest-v24.1
    command: start-single-node --insecure
    volumes:
      - data:/var/lib/cockroach
    ports:
      - "26257:26257"
  
  nakama:
    image: heroiclabs/nakama:3.22.0
    command: >
      --database.address root@cockroachdb:26257
      --logger.level INFO
    depends_on:
      - cockroachdb
    volumes:
      - ./data/modules:/nakama/data/modules
    ports:
      - "7350:7350"
      - "7351:7351"

volumes:
  data:
```

### Run It

```bash
docker-compose up
```

### Test It

```bash
# Authenticate (get token)
TOKEN=$(curl -s -X POST http://localhost:7350/v2/account/authenticate/device \
  -H 'Content-Type: application/json' \
  -d '{"id":"device-123","create":true}' | jq -r '.token')

# Call RPC
curl -X POST http://localhost:7350/v2/rpc/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Output:**
```json
{
  "success": true,
  "message": "Hello from Nakama ES Modules!",
  "userId": "...",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Summary

✅ **Directory Structure:**
```
project/
├── docker-compose.yml
└── data/
    └── modules/
        ├── index.js (export default InitModule)
        └── my_module.js (export function rpcTest)
```

✅ **docker-compose.yml:**
```yaml
volumes:
  - ./data/modules:/nakama/data/modules
```

✅ **index.js:**
```javascript
export default function InitModule(ctx, logger, nk, initializer) {
    // Register RPCs here
}
```

✅ **RPC modules:**
```javascript
export function rpcTest(ctx, logger, nk, payload) {
    // RPC implementation
}
```

✅ **Start:**
```bash
docker-compose up
```

✅ **Verify:**
- Check logs for "Initialization complete"
- Test RPC with curl or console

---

## Next Steps

1. Create your directory structure
2. Copy the minimal example files
3. Run `docker-compose up`
4. Check logs for successful initialization
5. Test your RPC endpoints
6. Build your game features!

See also:
- [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](./NAKAMA_JAVASCRIPT_ESM_GUIDE.md) - Complete ESM guide
- [NAKAMA_TYPESCRIPT_ESM_BUILD.md](./NAKAMA_TYPESCRIPT_ESM_BUILD.md) - TypeScript setup
