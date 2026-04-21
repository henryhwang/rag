# API Reference

Complete reference for all available endpoints.

## Base URL

All API requests should be made to:

```
https://api.example.com/v1
```

## Rate Limiting

- Free tier: 100 requests per minute
- Pro tier: 1000 requests per minute
- Enterprise: Custom limits

## Response Format

All responses are returned as JSON with the following structure:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "abc123",
    "timestamp": 1234567890
  }
}
```
