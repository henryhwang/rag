# OAuth 2.0 Authentication

Configure OAuth 2.0 for secure third-party integrations.

## Supported Flows

- Authorization Code Flow (recommended for web apps)
- Client Credentials Flow (for server-to-server)
- Refresh Token Flow (for maintaining sessions)

## Setting Up OAuth

1. Register your application in the developer portal
2. Note your Client ID and Client Secret
3. Configure authorized redirect URIs
4. Implement the callback handler

## Security Best Practices

- Never expose client secrets in frontend code
- Always validate state parameter
- Use PKCE for public clients
- Rotate credentials periodically
