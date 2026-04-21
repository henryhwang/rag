# Available Endpoints

## GET /users

Retrieve a list of users.

### Query Parameters

| Parameter | Type   | Description           |
|-----------|--------|-----------------------|
| page      | number | Page number (default: 1) |
| limit     | number | Items per page (max: 100) |
| sort      | string | Sort field            |

### Example

```http
GET /users?page=1&limit=10 HTTP/1.1
Host: api.example.com
Authorization: Bearer TOKEN
```
