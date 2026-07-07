"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }): void;
          renderButton(
            element: HTMLElement,
            options: Record<string, string | number>,
          ): void;
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google Identity Services"));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

export function GoogleSignIn({
  onCredential,
  text = "continue_with",
}: {
  onCredential: (credential: string) => void;
  text?: "continue_with" | "signin_with";
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [error, setError] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!clientId || !container.current) return;
    let active = true;
    void loadGoogleScript()
      .then(() => {
        if (!active || !window.google || !container.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callback.current(response.credential),
        });
        container.current.replaceChildren();
        window.google.accounts.id.renderButton(container.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          width: 320,
        });
      })
      .catch(() => setError(true));
    return () => {
      active = false;
    };
  }, [clientId, text]);

  if (!clientId) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Google sign-in is not configured.
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-center text-xs text-destructive">
        Google sign-in could not load.
      </p>
    );
  }
  return <div ref={container} className="flex min-h-10 justify-center" />;
}
