import { ExternalLink } from "lucide-react";
import { useIframeAuth } from "@/lib/useIframeAuth";

/**
 * Example component demonstrating automatic admin panel login for embedded iframes.
 * 
 * This pattern should be used for any iframe that needs automatic authentication
 * with the admin panel. The useIframeAuth hook handles:
 * - Calling the admin_login RPC
 * - Posting credentials to the iframe via postMessage
 * - Handling iframe load/reload events
 * - Security via origin checking
 * 
 * The embedded application must listen for the IVX_ADMIN_TOKEN message:
 * 
 * ```javascript
 * window.addEventListener('message', (event) => {
 *   if (event.data.type === 'IVX_ADMIN_TOKEN') {
 *     const { token, username, expiresAt } = event.data;
 *     // Use token to authenticate
 *   }
 * });
 * ```
 */
interface EmbeddedIframeProps {
  url: string;
  title: string;
  height?: string;
}

export function EmbeddedIframe({ url, title, height = "calc(100vh-260px)" }: EmbeddedIframeProps) {
  const { iframeRef, handleIframeLoad } = useIframeAuth({
    targetUrl: url,
    enabled: true,
    onError: (error) => {
      console.warn(`Iframe auth failed for ${title}:`, error);
    },
    onSuccess: (result) => {
      console.log(`Iframe auth successful for ${title}:`, result.username);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{title} ({url})</span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open in new tab
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <iframe
          ref={iframeRef}
          title={title}
          src={url}
          className="w-full border-0"
          style={{ height }}
          loading="lazy"
          onLoad={handleIframeLoad}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}

/**
 * Example usage in a page component:
 * 
 * ```tsx
 * import { EmbeddedIframe } from "@/components/EmbeddedIframeExample";
 * 
 * export function MyPage() {
 *   return (
 *     <div>
 *       <h1>My Admin Dashboard</h1>
 *       <EmbeddedIframe
 *         url="https://analytics.example.com"
 *         title="Analytics Dashboard"
 *         height="600px"
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
