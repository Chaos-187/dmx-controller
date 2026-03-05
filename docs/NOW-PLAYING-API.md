# Now Playing API

This API allows external applications (like a DMX controller) to send the currently playing track information to MobileDJay, which will be displayed to customers on the main request page.

## Base URL

```
http://localhost:3000
```

## Event Support

The API supports event-specific "Now Playing" tracks. You can associate a track with a specific event using either:
- `eventId` - The numeric event ID from the database
- `eventSlug` - The URL-friendly event identifier (e.g., "saturday-night-party")

If no event is specified, tracks are stored globally and shown to all events. Event-specific tracks take priority over global tracks.

## Endpoints

### Send Now Playing Track

Updates the currently playing track information.

**Endpoint:** `POST /api/now-playing`

**Content-Type:** `application/json`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | **Yes** | Track title |
| `artist` | string | No | Artist name |
| `album` | string | No | Album name |
| `duration` | number | No | Track duration in seconds |
| `elapsed` | number | No | Elapsed time in seconds |
| `artwork` | string | No | URL to album artwork image |
| `eventId` | number | No | Event ID to associate track with |
| `eventSlug` | string | No | Event slug to associate track with |

**Example Request (Global):**

```json
{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "album": "After Hours",
  "duration": 200,
  "elapsed": 45,
  "artwork": "https://example.com/cover.jpg"
}
```

**Example Request (Event-Specific):**

```json
{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "eventSlug": "saturday-night-party"
}
```

**Example Response:**

```json
{
  "success": true,
  "nowPlaying": {
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "duration": 200,
    "elapsed": 45,
    "artwork": "https://example.com/cover.jpg",
    "eventId": 1,
    "eventSlug": "saturday-night-party",
    "updatedAt": "2026-03-05T20:30:00.000Z"
  }
}
```

**cURL Example (Global):**

```bash
curl -X POST http://localhost:3000/api/now-playing \
  -H "Content-Type: application/json" \
  -d '{"title": "Blinding Lights", "artist": "The Weeknd"}'
```

**cURL Example (Event-Specific):**

```bash
curl -X POST http://localhost:3000/api/now-playing \
  -H "Content-Type: application/json" \
  -d '{"title": "Blinding Lights", "artist": "The Weeknd", "eventSlug": "saturday-night-party"}'
```

**PowerShell Example:**

```powershell
$body = @{
    title = "Blinding Lights"
    artist = "The Weeknd"
    album = "After Hours"
    eventSlug = "saturday-night-party"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/now-playing" -Method Post -Body $body -ContentType "application/json"
```

---

### Get Now Playing Track

Retrieves the currently playing track information.

**Endpoint:** `GET /api/now-playing`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | number | No | Get track for specific event ID |
| `eventSlug` | string | No | Get track for specific event slug |

If an event is specified but has no track, the API falls back to the global track.

**Example Response (track playing):**

```json
{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "album": "After Hours",
  "duration": 200,
  "elapsed": 45,
  "artwork": "https://example.com/cover.jpg",
  "eventId": 1,
  "eventSlug": "saturday-night-party",
  "updatedAt": "2026-03-05T20:30:00.000Z"
}
```

**Example Response (no track):**

```json
{
  "title": null,
  "artist": null,
  "album": null,
  "duration": null,
  "elapsed": null,
  "artwork": null,
  "eventId": null,
  "eventSlug": null,
  "updatedAt": null
}
```

**cURL Example (Global):**

```bash
curl http://localhost:3000/api/now-playing
```

**cURL Example (Event-Specific):**

```bash
curl "http://localhost:3000/api/now-playing?eventSlug=saturday-night-party"
```

---

### Clear Now Playing

Clears the now playing information (use when playback stops).

**Endpoint:** `DELETE /api/now-playing`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | number | No | Clear track for specific event ID |
| `eventSlug` | string | No | Clear track for specific event slug |

**Example Response:**

```json
{
  "success": true
}
```

**cURL Example (Global):**

```bash
curl -X DELETE http://localhost:3000/api/now-playing
```

**cURL Example (Event-Specific):**

```bash
curl -X DELETE "http://localhost:3000/api/now-playing?eventSlug=saturday-night-party"
```

**PowerShell Example:**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/now-playing?eventSlug=saturday-night-party" -Method Delete
```

---

## Integration Notes

- The MobileDJay frontend polls the `/api/now-playing` endpoint every 3 seconds
- When viewing an event page (`/event/{slug}`), the frontend automatically requests event-specific tracks
- Event-specific tracks take priority over global tracks
- If no event-specific track exists, the global track is shown as fallback
- When a new track is received, it displays in an animated card below the hero section
- The display automatically hides when `title` is null or the endpoint returns empty data
- Only `title` is required; all other fields are optional
- The `updatedAt` timestamp is set automatically by the server

## Track Priority

1. **Event-specific track** - If `eventId` or `eventSlug` is provided and a track exists for that event
2. **Global track** - Falls back to global track if no event-specific track exists
3. **Empty** - Shows nothing if no tracks exist

## Typical Usage Flow

### Single Event / Single DJ

1. **Track starts playing:** Send `POST /api/now-playing` with track details (no event needed)
2. **Track changes:** Send `POST /api/now-playing` with new track details
3. **Playback stops:** Send `DELETE /api/now-playing` to clear the display

### Multiple Events / Multiple DJs

1. **Track starts for Event A:** Send `POST /api/now-playing` with `eventSlug: "event-a"` and track details
2. **Track starts for Event B:** Send `POST /api/now-playing` with `eventSlug: "event-b"` and track details
3. **Track changes for Event A:** Send `POST /api/now-playing` with `eventSlug: "event-a"` and new track
4. **Playback stops for Event B:** Send `DELETE /api/now-playing?eventSlug=event-b`

## Error Responses

**400 Bad Request** - Missing required `title` field:

```json
{
  "error": "Title is required"
}
```

**404 Not Found** - Invalid event slug:

```json
{
  "error": "Event not found"
}
```
