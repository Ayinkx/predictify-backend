# Markets API

## `GET /api/markets/recommendations`

Returns personalized market recommendations for the authenticated user.

### Authentication

Requires a bearer JWT accepted by the standard authentication middleware.

```http
Authorization: Bearer <token>
```

### Response

`200 OK`

```json
{
  "data": [
    {
      "id": "market-1",
      "question": "Will BTC close above $100k this quarter?",
      "status": "active",
      "resolutionTime": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

The endpoint excludes markets the user has already predicted on, prefers active
non-archived markets related to terms from the user's prediction history, and
falls back to recent active non-archived markets when there is no usable history
or no related market is found.

### ETag support

`GET /api/markets` supports conditional revalidation through `ETag` and `If-None-Match`.
On a matching revalidation request, the route responds with `304 Not Modified`
and does not return a response body. Clients should treat the response as a
cache revalidation success and reuse the previously cached representation.

### Errors

- `401 Unauthorized` when the bearer token is missing, malformed, invalid, or
  belongs to no known user.
