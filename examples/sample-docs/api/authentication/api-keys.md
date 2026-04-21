# API Key Authentication

Simple authentication using API keys.

## Generating Keys

Navigate to Settings > API Keys > Generate New Key.

Choose appropriate permissions:
- `read` - Read-only access
- `write` - Read and modify
- `admin` - Full administrative access

## Using API Keys

Include your key in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

## Key Rotation

We recommend rotating API keys every 90 days for security.

To rotate:
1. Generate a new key
2. Update your applications
3. Revoke the old key once verified
