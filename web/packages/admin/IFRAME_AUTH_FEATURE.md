# Automatic Admin Panel Login for Embedded Iframes - Feature Summary

## What Was Implemented

Added automatic authentication for all embedded iframe content in the Nakama admin panel. Users no longer need to manually log in to embedded dashboards, analytics tools, or other iframe-based content.

## Files Added

### Core Implementation
- **`src/lib/useIframeAuth.ts`** - Reusable React hook for iframe authentication
  - Calls `admin_login` RPC to get JWT token
  - Posts credentials to iframe via `postMessage`
  - Handles iframe load/reload events
  - Validates target origins for security

- **`src/lib/index.ts`** - Central exports for lib utilities
  - Exports `useIframeAuth` hook and types
  - Exports existing `cn` utility

### Components & Examples
- **`src/components/EmbeddedIframeExample.tsx`** - Reusable iframe component
  - Drop-in component for embedding authenticated iframes
  - Includes comprehensive JSDoc documentation
  - Shows best practices for iframe embedding

- **`src/components/index.ts`** - Central exports for components
  - Exports `EmbeddedIframe` component
  - Exports existing components

### Documentation
- **`docs/IFRAME_AUTHENTICATION.md`** - Complete feature documentation
  - Architecture overview
  - Usage examples (basic & advanced)
  - API reference
  - Security considerations
  - Troubleshooting guide
  - Migration guide from manual auth
  - Future enhancement ideas

## Files Modified

- **`src/pages/AnalyticsPage.tsx`**
  - Refactored `StandaloneDashboardTab` to use `useIframeAuth` hook
  - Removed 40+ lines of boilerplate authentication code
  - Cleaner, more maintainable implementation
  - Added error handling callback

## How It Works

### Admin Panel Flow

1. Admin panel embeds an iframe with the `useIframeAuth` hook
2. When iframe loads, hook calls `admin_login` RPC
3. RPC returns JWT token with admin credentials
4. Token is posted to iframe via secure `postMessage`
5. Iframe receives credentials and authenticates automatically

### Embedded App Requirements

Embedded applications must listen for the authentication message:

```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'IVX_ADMIN_TOKEN') {
    const { token, username, expiresAt } = event.data;
    // Store token and authenticate
    localStorage.setItem('admin_token', token);
    window.location.reload();
  }
});
```

## Usage

### Simple Usage

```tsx
import { useIframeAuth } from "@/lib/useIframeAuth";

function MyPage() {
  const { iframeRef, handleIframeLoad } = useIframeAuth({
    targetUrl: 'https://dashboard.example.com',
  });

  return (
    <iframe
      ref={iframeRef}
      src="https://dashboard.example.com"
      onLoad={handleIframeLoad}
    />
  );
}
```

### Using the Component

```tsx
import { EmbeddedIframe } from "@/components";

function MyPage() {
  return (
    <EmbeddedIframe
      url="https://dashboard.example.com"
      title="My Dashboard"
      height="600px"
    />
  );
}
```

## Security

- ✅ Origin validation prevents token leakage
- ✅ JWT tokens with expiration
- ✅ Secure `postMessage` API
- ✅ Fallback to manual login if auth fails
- ✅ HTTPS enforcement in production

## Current Implementations

- **AnalyticsPage** - Standalone analytics dashboard (`analytics.html`)

## Future Enhancements

- Token refresh before expiration
- Bidirectional handshake (iframe confirms receipt)
- Support for multiple authentication schemes
- Automatic retry on auth failure
- Monitoring and analytics for auth success rates

## Testing

To test the implementation:

1. Navigate to Analytics page in admin panel
2. Switch to "Dashboard" tab
3. Verify the embedded analytics dashboard loads without login prompt
4. Check browser console for auth messages (if debugging enabled)

## Rollout Plan

1. ✅ Core implementation (useIframeAuth hook)
2. ✅ Refactor AnalyticsPage to use hook
3. ✅ Documentation and examples
4. 🔲 Apply to other iframe embeds as they are added
5. 🔲 Monitor auth success rates
6. 🔲 Add telemetry for debugging

## Migration Checklist

When adding new iframe embeds:

- [ ] Use `useIframeAuth` hook or `EmbeddedIframe` component
- [ ] Provide proper `targetUrl` for origin validation
- [ ] Add error handling for auth failures
- [ ] Test iframe receives and handles `IVX_ADMIN_TOKEN` message
- [ ] Verify fallback login works if auth fails
- [ ] Document the embedded app in this README

## Questions?

See `docs/IFRAME_AUTHENTICATION.md` for complete documentation, API reference, and troubleshooting guide.
