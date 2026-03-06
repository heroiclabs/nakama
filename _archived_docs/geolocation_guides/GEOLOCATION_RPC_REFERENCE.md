# Geolocation RPC - Quick Reference

## RPC Endpoint

**Name**: `check_geo_and_update_profile`

**Purpose**: Validates player GPS coordinates, resolves location using Google Maps Geocoding API, applies regional restrictions, and updates player metadata.

## Request

### Payload Structure

```json
{
  "latitude": 29.7604,
  "longitude": -95.3698
}
```

### Fields

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `latitude` | float | Yes | -90 to 90 | GPS latitude coordinate |
| `longitude` | float | Yes | -180 to 180 | GPS longitude coordinate |

## Response

### Success (Allowed)

```json
{
  "allowed": true,
  "country": "US",
  "region": "Texas",
  "city": "Houston",
  "reason": null
}
```

### Success (Blocked)

```json
{
  "allowed": false,
  "country": "DE",
  "region": "Berlin",
  "city": "Berlin",
  "reason": "Region not supported"
}
```

### Error Response

```json
{
  "success": false,
  "error": "latitude and longitude must be numeric values"
}
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | boolean | Whether the player's location is allowed |
| `country` | string | ISO country code (e.g., "US", "DE", "FR") |
| `region` | string | State/province/region name |
| `city` | string | City name |
| `reason` | string\|null | Reason for blocking (if blocked) |

## Error Cases

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `Authentication required` | No valid session | Authenticate before calling RPC |
| `latitude is required` | Missing latitude field | Include latitude in payload |
| `longitude is required` | Missing longitude field | Include longitude in payload |
| `latitude and longitude must be numeric values` | Non-numeric values | Use float/number types |
| `latitude must be between -90 and 90` | Invalid latitude range | Use valid GPS coordinates |
| `longitude must be between -180 and 180` | Invalid longitude range | Use valid GPS coordinates |
| `Geocoding service not configured` | Missing API key | Set GOOGLE_MAPS_API_KEY env var |
| `Failed to connect to geocoding service` | Network error | Check network connectivity |
| `Could not determine location from coordinates` | Invalid coordinates or API error | Verify coordinates are valid |

## Blocked Countries

- France (FR)
- Germany (DE)

## Curl Examples

### Test with Houston, TX (Allowed)

```bash
curl -X POST http://localhost:7350/v2/rpc/check_geo_and_update_profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude":29.7604,"longitude":-95.3698}'
```

### Test with Berlin, Germany (Blocked)

```bash
curl -X POST http://localhost:7350/v2/rpc/check_geo_and_update_profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude":52.5200,"longitude":13.4050}'
```

### Test with Paris, France (Blocked)

```bash
curl -X POST http://localhost:7350/v2/rpc/check_geo_and_update_profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude":48.8566,"longitude":2.3522}'
```

## Player Metadata Updates

The RPC automatically updates the following fields in player metadata:

```json
{
  "latitude": 29.7604,
  "longitude": -95.3698,
  "country": "United States",
  "region": "Texas",
  "city": "Houston",
  "location_updated_at": "2024-01-15T10:30:00Z"
}
```

## Implementation Details

### Google Maps API Integration

- **API**: Google Maps Reverse Geocoding API
- **Endpoint**: `https://maps.googleapis.com/maps/api/geocode/json`
- **Method**: GET
- **Authentication**: API key from environment variable

### Location Extraction Logic

From Google Maps API response `address_components`:
- **Country**: Component with type `"country"` → `short_name` for code, `long_name` for full name
- **Region**: Component with type `"administrative_area_level_1"` → `long_name`
- **City**: Component with type `"locality"` → `long_name`

### Business Logic

```javascript
const blockedCountries = ['FR', 'DE'];
const allowed = !blockedCountries.includes(countryCode);
const reason = allowed ? null : "Region not supported";
```

## Configuration

### Environment Variables

Set in `docker-compose.yml`:

```yaml
environment:
  - GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
```

### Security Notes

- ✅ API key stored in environment variable (not hardcoded)
- ✅ Comprehensive input validation
- ✅ Error handling for all network requests
- ✅ Safe JSON parsing
- ✅ No SQL injection risks (using Nakama storage API)

## Unity C# Example

```csharp
public async Task<GeolocationResponse> CheckLocation(float lat, float lng)
{
    var payload = new GeolocationPayload { latitude = lat, longitude = lng };
    var jsonPayload = JsonConvert.SerializeObject(payload);
    var rpcResponse = await _client.RpcAsync(_session, "check_geo_and_update_profile", jsonPayload);
    return JsonConvert.DeserializeObject<GeolocationResponse>(rpcResponse.Payload);
}
```

## Testing Coordinates

| Location | Latitude | Longitude | Expected Result |
|----------|----------|-----------|-----------------|
| Houston, TX | 29.7604 | -95.3698 | Allowed (US) |
| New York, NY | 40.7128 | -74.0060 | Allowed (US) |
| Berlin, Germany | 52.5200 | 13.4050 | Blocked (DE) |
| Paris, France | 48.8566 | 2.3522 | Blocked (FR) |
| London, UK | 51.5074 | -0.1278 | Allowed (GB) |
| Tokyo, Japan | 35.6762 | 139.6503 | Allowed (JP) |

## Notes

- Location data is stored in both storage metadata and account metadata
- Subsequent calls will update the location fields
- The RPC requires an authenticated session
- Rate limiting may apply based on Google Maps API quotas
