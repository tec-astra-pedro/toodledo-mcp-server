export interface ToodledoCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
}
export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
}
export declare class ToodledoClient {
    private readonly baseUrl;
    private client;
    private credentials;
    private accessToken;
    private refreshToken;
    constructor(credentials: ToodledoCredentials);
    /**
     * Ensures we have a valid access token.
     * If not, it attempts to refresh the token using the refresh token.
     */
    private ensureAuthenticated;
    private refreshAccessToken;
    /**
     * A wrapper around axios that automatically handles authentication and retries on 401.
     */
    private request;
    getTasks(): Promise<any>;
    addTask(title: string): Promise<any>;
}
