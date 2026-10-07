export declare const REDIRECT_URI = "http://127.0.0.1:8765/callback";
/** Run the loopback PKCE login, persisting the resulting tokens. Returns the access token. */
export declare function login(): Promise<string>;
/** Return a valid access token, refreshing or prompting login as needed. */
export declare function getAccessToken(): Promise<string>;
//# sourceMappingURL=auth.d.ts.map