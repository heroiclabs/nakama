# Automatic Admin Panel Login for Embedded Iframes

## Overview

All embedded iframes in the Nakama admin panel now support automatic authentication via the `useIframeAuth` hook. This eliminates the need for users to manually log in to embedded dashboards and tools.

## Architecture

### Admin Panel Side

The admin panel uses the `useIframeAuth` hook to automatically post authentication credentials to embedded iframes:

1. When an iframe loads, the hook calls the `admin_login` RPC
2. The RPC returns a JWT token with admin credentials
3. The token is posted to the iframe via `postMessage` with type `IVX_ADMIN_TOKEN`
4. Security is enforced via origin checking

### Embedded Application Side

Applications embedded in iframes must listen for the authentication message:

```javascript
window.addEventListener('message', (event) => {
  // Verify the message is from a trusted origin
  if (event.origin !== 'https://admin.intelli-verse-x.ai') {
    return;
  }

  if (event.data.type === 'IVX_ADMIN_TOKEN') {
    const { token, username, expiresAt } = event.data;
    
    // Store the token
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_username', username);
    
    // Redirect to authenticated view or refresh
    window.location.reload();
  }
});

// Send ready signal (optional)
window.parent.postMessage({ type: 'IFRAME_READY' }, '*');
```

## Usage

### Basic Usage

```tsx
import { useIframeAuth } from "@/lib/useIframeAuth";

function MyDashboardPage() {
  const { iframeRef, handleIframeLoad } = useIframeAuth({
    targetUrl: 'https://dashboard.example.com',
    enabled: true,
  });

  return (
    <iframe
      ref={iframeRef}
      src="https://dashboard.example.com"
      onLoad={handleIframeLoad}
      title="My Dashboard"
    />
  );
}
```

### Advanced Usage with Error Handling

```tsx
import { useIframeAuth } from "@/lib/useIframeAuth";
import { useState } from "react";

function MyDashboardPage() {
  const [authError, setAuthError] = useState<string | null>(null);
  
  const { iframeRef, handleIframeLoad, postToken } = useIframeAuth({
    targetUrl: 'https://dashboard.example.com',
    enabled: true,
    onError: (error) => {
      setAuthError('Authentication failed');
      console.error('Iframe auth error:', error);
    },
    onSuccess: (result) => {
      console.log('Authenticated as:', result.username);
      setAuthError(null);
    },
  });

  return (
    <div>
      {authError && (
        <div className="error-banner">
          {authError}
          <button onClick={postToken}>Retry</button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="https://dashboard.example.com"
        onLoad={handleIframeLoad}
        title="My Dashboard"
      />
    </div>
  );
}
```

### Using the Reusable Component

For simple cases, use the `EmbeddedIframe` component:

```tsx
import { EmbeddedIframe } from "@/components/EmbeddedIframeExample";

function MyPage() {
  return (
    <EmbeddedIframe
      url="https://analytics.example.com"
      title="Analytics Dashboard"
      height="600px"
    />
  );
}
```

## API Reference

### `useIframeAuth` Hook

```typescript
interface UseIframeAuthOptions {
  targetUrl: string;           // URL of the embedded iframe
  enabled?: boolean;            // Enable/disable auth (default: true)
  onError?: (error: unknown) => void;    // Error callback
  onSuccess?: (result: AdminLoginResult) => void;  // Success callback
}

interface UseIframeAuthResult {
  iframeRef: React.RefObject<HTMLIFrameElement>;  // Ref to attach to iframe
  handleIframeLoad: () => void;                    // Handler for onLoad event
  postToken: () => Promise<void>;                  // Manual token posting
  isTokenSent: boolean;                            // Token sent status
}
```

### Message Format

The admin panel posts messages with this structure:

```typescript
interface IVXAdminTokenMessage {
  type: "IVX_ADMIN_TOKEN";
  token: string;           // JWT token
  username: string;        // Admin username
  expiresAt: number | null; // Token expiration (unix timestamp)
}
```

## Security Considerations

1. **Origin Validation**: The hook validates the target origin before posting credentials
2. **Token Scope**: Tokens are admin-scoped and should not be exposed to untrusted contexts
3. **HTTPS Required**: All embedded dashboards must use HTTPS in production
4. **Iframe Sandbox**: Consider using appropriate sandbox attributes

```tsx
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  // ...
/>
```

## Troubleshooting

### Token Not Received

If the embedded app doesn't receive the token:

1. Check browser console for `postMessage` errors
2. Verify the iframe `src` matches the `targetUrl` in the hook
3. Ensure the embedded app is listening for messages before the token is sent
4. Check CORS and CSP headers on both sides

### Authentication Fails

If `admin_login` RPC fails:

1. Verify the admin panel session is valid
2. Check server logs for RPC errors
3. Ensure the `serverKeyAuth()` is properly configured
4. The iframe will fall back to its own login screen

### Multiple Iframes

If you have multiple iframes on one page, each needs its own hook instance:

```tsx
const analytics = useIframeAuth({ targetUrl: ANALYTICS_URL });
const metrics = useIframeAuth({ targetUrl: METRICS_URL });

return (
  <>
    <iframe ref={analytics.iframeRef} onLoad={analytics.handleIframeLoad} />
    <iframe ref={metrics.iframeRef} onLoad={metrics.handleIframeLoad} />
  </>
);
```

## Migration Guide

### Before (Manual Authentication)

```tsx
function OldDashboard() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenSentRef = useRef(false);

  const postTokenToIframe = useCallback(async () => {
    if (tokenSentRef.current) return;
    try {
      const result = await callRpc("admin_login", {}, serverKeyAuth());
      if (result?.token && iframeRef.current?.contentWindow) {
        tokenSentRef.current = true;
        iframeRef.current.contentWindow.postMessage(
          { type: "IVX_ADMIN_TOKEN", token: result.token },
          new URL(DASHBOARD_URL).origin,
        );
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handleIframeLoad = useCallback(() => {
    tokenSentRef.current = false;
    postTokenToIframe();
  }, [postTokenToIframe]);

  return <iframe ref={iframeRef} onLoad={handleIframeLoad} />;
}
```

### After (Using Hook)

```tsx
function NewDashboard() {
  const { iframeRef, handleIframeLoad } = useIframeAuth({
    targetUrl: DASHBOARD_URL,
    enabled: true,
  });

  return <iframe ref={iframeRef} onLoad={handleIframeLoad} />;
}
```

## Examples in Codebase

- **AnalyticsPage**: Embeds standalone analytics dashboard with automatic auth
- **EmbeddedIframeExample**: Reference implementation and documentation

## Future Enhancements

- [ ] Token refresh before expiration
- [ ] Bidirectional handshake (iframe confirms receipt)
- [ ] Support for multiple authentication schemes
- [ ] Automatic retry on auth failure
- [ ] Token revocation handling
