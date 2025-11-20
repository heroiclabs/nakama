# Unity C# Geolocation Integration Guide

## Overview

This guide shows how to integrate the `check_geo_and_update_profile` RPC endpoint in your Unity game client to validate player locations and enforce regional restrictions.

## Prerequisites

- Nakama Unity SDK installed in your project
- Active Nakama session
- Device location permissions (Android/iOS)

## Unity C# Implementation

### 1. Define Data Structures

```csharp
using Newtonsoft.Json;
using System.Collections.Generic;

[System.Serializable]
public class GeolocationPayload
{
    public float latitude;
    public float longitude;
}

[System.Serializable]
public class GeolocationResponse
{
    public bool allowed;
    public string country;
    public string region;
    public string city;
    public string reason;
}
```

### 2. Create Geolocation Service Class

```csharp
using System;
using System.Threading.Tasks;
using Nakama;
using UnityEngine;
using Newtonsoft.Json;

public class GeolocationService : MonoBehaviour
{
    private const string RPC_CHECK_GEO = "check_geo_and_update_profile";
    
    private IClient _client;
    private ISession _session;
    
    public void Initialize(IClient client, ISession session)
    {
        _client = client;
        _session = session;
    }
    
    /// <summary>
    /// Check player geolocation and update their profile
    /// </summary>
    /// <param name="latitude">GPS latitude (-90 to 90)</param>
    /// <param name="longitude">GPS longitude (-180 to 180)</param>
    /// <returns>GeolocationResponse with allowed status and location details</returns>
    public async Task<GeolocationResponse> CheckGeolocationAndUpdateProfile(float latitude, float longitude)
    {
        try
        {
            // Validate session
            if (_session == null || _session.IsExpired)
            {
                Debug.LogError("GeolocationService: Session is null or expired");
                return null;
            }
            
            // Validate coordinates
            if (latitude < -90 || latitude > 90)
            {
                Debug.LogError($"GeolocationService: Invalid latitude {latitude}. Must be between -90 and 90");
                return null;
            }
            
            if (longitude < -180 || longitude > 180)
            {
                Debug.LogError($"GeolocationService: Invalid longitude {longitude}. Must be between -180 and 180");
                return null;
            }
            
            // Create payload
            var payload = new GeolocationPayload
            {
                latitude = latitude,
                longitude = longitude
            };
            
            var jsonPayload = JsonConvert.SerializeObject(payload);
            
            Debug.Log($"GeolocationService: Checking location at ({latitude}, {longitude})");
            
            // Call RPC
            var rpcResponse = await _client.RpcAsync(_session, RPC_CHECK_GEO, jsonPayload);
            
            if (string.IsNullOrEmpty(rpcResponse.Payload))
            {
                Debug.LogError("GeolocationService: Empty response from server");
                return null;
            }
            
            // Parse response
            var response = JsonConvert.DeserializeObject<GeolocationResponse>(rpcResponse.Payload);
            
            if (response == null)
            {
                Debug.LogError("GeolocationService: Failed to parse response");
                return null;
            }
            
            // Log result
            if (response.allowed)
            {
                Debug.Log($"GeolocationService: Location allowed - {response.city}, {response.region}, {response.country}");
            }
            else
            {
                Debug.LogWarning($"GeolocationService: Location blocked - {response.reason}");
            }
            
            return response;
        }
        catch (Exception ex)
        {
            Debug.LogError($"GeolocationService: Error checking geolocation - {ex.Message}");
            return null;
        }
    }
    
    /// <summary>
    /// Get device GPS coordinates (requires location permissions)
    /// </summary>
    public async Task<(float latitude, float longitude)?> GetDeviceLocation()
    {
        // Check if location services are enabled
        if (!Input.location.isEnabledByUser)
        {
            Debug.LogError("GeolocationService: Location services are not enabled");
            return null;
        }
        
        // Start location service
        Input.location.Start(10f, 0.1f); // 10m accuracy, 0.1m update distance
        
        // Wait for initialization (max 20 seconds)
        int maxWait = 20;
        while (Input.location.status == LocationServiceStatus.Initializing && maxWait > 0)
        {
            await Task.Delay(1000);
            maxWait--;
        }
        
        // Check if service failed to initialize
        if (maxWait < 1)
        {
            Debug.LogError("GeolocationService: Location service initialization timed out");
            Input.location.Stop();
            return null;
        }
        
        // Check for other failures
        if (Input.location.status == LocationServiceStatus.Failed)
        {
            Debug.LogError("GeolocationService: Unable to determine device location");
            Input.location.Stop();
            return null;
        }
        
        // Get location
        float latitude = Input.location.lastData.latitude;
        float longitude = Input.location.lastData.longitude;
        
        Debug.Log($"GeolocationService: Device location - ({latitude}, {longitude})");
        
        // Stop location service to save battery
        Input.location.Stop();
        
        return (latitude, longitude);
    }
}
```

### 3. Usage Example in Game Manager

```csharp
using System;
using UnityEngine;
using Nakama;

public class GameManager : MonoBehaviour
{
    [SerializeField] private GeolocationService _geolocationService;
    
    private IClient _client;
    private ISession _session;
    
    private async void Start()
    {
        // Initialize Nakama client (example)
        _client = new Client("http", "localhost", 7350, "defaultkey");
        
        // Authenticate (example - device ID)
        _session = await _client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);
        
        // Initialize geolocation service
        _geolocationService.Initialize(_client, _session);
        
        // Check player location on game start
        await CheckPlayerLocation();
    }
    
    private async Task CheckPlayerLocation()
    {
        try
        {
            // Option 1: Use device GPS
            var location = await _geolocationService.GetDeviceLocation();
            
            if (location.HasValue)
            {
                var response = await _geolocationService.CheckGeolocationAndUpdateProfile(
                    location.Value.latitude,
                    location.Value.longitude
                );
                
                if (response != null)
                {
                    HandleGeolocationResponse(response);
                }
            }
            
            // Option 2: Use manual coordinates (for testing)
            // var response = await _geolocationService.CheckGeolocationAndUpdateProfile(29.7604f, -95.3698f);
            // HandleGeolocationResponse(response);
        }
        catch (Exception ex)
        {
            Debug.LogError($"GameManager: Error checking location - {ex.Message}");
        }
    }
    
    private void HandleGeolocationResponse(GeolocationResponse response)
    {
        if (response.allowed)
        {
            // Player is in an allowed region - continue with game
            Debug.Log($"Welcome! You're playing from {response.city}, {response.region}, {response.country}");
            StartGame();
        }
        else
        {
            // Player is in a blocked region - show message
            Debug.LogWarning($"Access denied: {response.reason}");
            ShowRegionBlockedMessage(response);
        }
    }
    
    private void StartGame()
    {
        // Start your game logic here
        Debug.Log("Game started!");
    }
    
    private void ShowRegionBlockedMessage(GeolocationResponse response)
    {
        // Show UI message to player
        string message = $"Sorry, this game is not available in {response.country}.\n{response.reason}";
        
        // Display in UI (implement your own UI logic)
        Debug.LogWarning(message);
        
        // Optionally: Exit game or show alternative content
    }
}
```

## Platform-Specific Setup

### Android Setup

Add the following permissions to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

### iOS Setup

Add the following keys to `Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to verify regional availability</string>
<key>NSLocationAlwaysUsageDescription</key>
<string>We need your location to verify regional availability</string>
```

## Testing

### Test Cases

1. **Allowed Region (US - Houston)**
```csharp
var response = await _geolocationService.CheckGeolocationAndUpdateProfile(29.7604f, -95.3698f);
// Expected: allowed = true, country = "US", region = "Texas", city = "Houston"
```

2. **Blocked Region (Germany - Berlin)**
```csharp
var response = await _geolocationService.CheckGeolocationAndUpdateProfile(52.5200f, 13.4050f);
// Expected: allowed = false, country = "DE", reason = "Region not supported"
```

3. **Blocked Region (France - Paris)**
```csharp
var response = await _geolocationService.CheckGeolocationAndUpdateProfile(48.8566f, 2.3522f);
// Expected: allowed = false, country = "FR", reason = "Region not supported"
```

### Error Handling

The service handles the following error cases:
- Invalid coordinates (out of range)
- Missing or expired session
- Network errors
- Location service failures
- Invalid server responses

## Player Metadata Structure

After calling `check_geo_and_update_profile`, the player's metadata is updated with:

```json
{
  "role": "guest",
  "email": "guest@example.com",
  "game_id": "your-game-uuid",
  "first_name": "Guest",
  "last_name": "User",
  "latitude": 29.7604,
  "longitude": -95.3698,
  "country": "United States",
  "region": "Texas",
  "city": "Houston",
  "location_updated_at": "2024-01-15T10:30:00Z"
}
```

## Best Practices

1. **Privacy**: Always request location permissions explicitly and explain why
2. **Caching**: Cache geolocation results to avoid repeated API calls
3. **Offline Mode**: Handle cases where location services are unavailable
4. **User Experience**: Provide clear messaging when access is denied
5. **Testing**: Test with VPN or location spoofing tools during development

## Blocked Countries

Currently blocked countries (can be modified in server code):
- France (FR)
- Germany (DE)

To modify the blocked countries list, update the `blockedCountries` array in the server's `rpcCheckGeoAndUpdateProfile` function.

## API Response Reference

### Success Response
```json
{
  "allowed": true,
  "country": "US",
  "region": "Texas",
  "city": "Houston",
  "reason": null
}
```

### Blocked Response
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
