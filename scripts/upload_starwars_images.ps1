#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Upload Star Wars character images to AWS S3 and update Nakama manifest.

.DESCRIPTION
    This script:
    1. Downloads character images from akabab/starwars-api (Wookieepedia CDN)
    2. Uploads them to your S3 bucket with proper naming
    3. Calls Nakama RPC to update the asset manifest

    Prerequisites:
    - AWS CLI configured (aws configure)
    - Nakama server running with AWS env vars set
    - curl, jq available in PATH

.PARAMETER BucketName
    S3 bucket name (from AWS_S3_BUCKET env var or parameter)

.PARAMETER Region
    AWS region (from AWS_REGION env var or parameter, default: us-east-1)

.PARAMETER NakamaUrl
    Nakama server URL (default: http://localhost:7350)

.PARAMETER HttpKey
    Nakama HTTP key (default: defaultkey)

.PARAMETER DownloadOnly
    Only download images locally, don't upload to S3

.EXAMPLE
    # Upload all Star Wars character images to S3
    ./upload_starwars_images.ps1 -BucketName "my-game-assets"

.EXAMPLE
    # Download images only (for testing)
    ./upload_starwars_images.ps1 -DownloadOnly

.NOTES
    Author: IntelliVerseX Platform
    Version: 1.0.0
#>

param(
    [string]$BucketName = $env:AWS_S3_BUCKET,
    [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }),
    [string]$NakamaUrl = "http://localhost:7350",
    [string]$HttpKey = "defaultkey",
    [switch]$DownloadOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$STARWARS_API_URL = "https://akabab.github.io/starwars-api/api/all.json"
$LOCAL_DIR = Join-Path $PSScriptRoot "starwars_images"
$S3_PREFIX = "starwars/characters"
$CATEGORY = "starwars/characters"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "INFO"    { "Cyan" }
        "SUCCESS" { "Green" }
        "WARN"    { "Yellow" }
        "ERROR"   { "Red" }
        default   { "White" }
    }
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
}

function Normalize-CharacterName {
    param([string]$Name)
    $normalized = $Name.ToLower() -replace "[^a-z0-9]", "_"
    $normalized = $normalized -replace "_+", "_"
    $normalized = $normalized.Trim("_")
    return $normalized
}

function Download-CharacterImages {
    Write-Log "Downloading Star Wars character data from akabab API..."
    
    if (-not (Test-Path $LOCAL_DIR)) {
        New-Item -ItemType Directory -Path $LOCAL_DIR -Force | Out-Null
    }

    try {
        $response = Invoke-RestMethod -Uri $STARWARS_API_URL -Method Get -TimeoutSec 30
        Write-Log "Found $($response.Count) characters in API"
    }
    catch {
        Write-Log "Failed to fetch character data: $_" "ERROR"
        return @()
    }

    $downloaded = @()
    $failed = @()

    foreach ($character in $response) {
        $name = $character.name
        $imageUrl = $character.image

        if ([string]::IsNullOrEmpty($name) -or [string]::IsNullOrEmpty($imageUrl)) {
            continue
        }

        $normalizedName = Normalize-CharacterName -Name $name
        $extension = [System.IO.Path]::GetExtension($imageUrl)
        if ([string]::IsNullOrEmpty($extension)) { $extension = ".png" }
        $filename = "$normalizedName$extension"
        $localPath = Join-Path $LOCAL_DIR $filename

        if (Test-Path $localPath) {
            Write-Log "Skipping (exists): $filename"
            $downloaded += @{
                Name = $name
                NormalizedName = $normalizedName
                Filename = $filename
                LocalPath = $localPath
            }
            continue
        }

        try {
            Write-Log "Downloading: $name -> $filename"
            Invoke-WebRequest -Uri $imageUrl -OutFile $localPath -TimeoutSec 30
            Start-Sleep -Milliseconds 200
            
            $downloaded += @{
                Name = $name
                NormalizedName = $normalizedName
                Filename = $filename
                LocalPath = $localPath
            }
        }
        catch {
            Write-Log "Failed to download $name`: $_" "WARN"
            $failed += $name
        }
    }

    Write-Log "Downloaded $($downloaded.Count) images, $($failed.Count) failed" $(if ($failed.Count -gt 0) { "WARN" } else { "SUCCESS" })
    return $downloaded
}

function Upload-ToS3 {
    param([array]$Images)

    if ([string]::IsNullOrEmpty($BucketName)) {
        Write-Log "BucketName not specified. Set AWS_S3_BUCKET env var or -BucketName parameter." "ERROR"
        return $false
    }

    Write-Log "Uploading $($Images.Count) images to s3://$BucketName/$S3_PREFIX/"

    $uploaded = @()
    $failed = @()

    foreach ($img in $Images) {
        $s3Key = "$S3_PREFIX/$($img.Filename)"
        
        try {
            Write-Log "Uploading: $($img.Filename)"
            aws s3 cp $img.LocalPath "s3://$BucketName/$s3Key" --region $Region --quiet
            $uploaded += $img.Filename
        }
        catch {
            Write-Log "Failed to upload $($img.Filename): $_" "WARN"
            $failed += $img.Filename
        }
    }

    Write-Log "Uploaded $($uploaded.Count) images, $($failed.Count) failed" $(if ($failed.Count -gt 0) { "WARN" } else { "SUCCESS" })
    return ($failed.Count -eq 0)
}

function Update-NakamaManifest {
    param([array]$Filenames)

    Write-Log "Updating Nakama asset manifest..."

    $payload = @{
        category = $CATEGORY
        assets = $Filenames
    } | ConvertTo-Json -Compress

    $url = "$NakamaUrl/v2/rpc/s3_asset_manifest_update?http_key=$HttpKey"

    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30
        
        if ($response.success -or $response.data.success) {
            Write-Log "Manifest updated with $($Filenames.Count) assets" "SUCCESS"
            return $true
        }
        else {
            Write-Log "Manifest update failed: $($response | ConvertTo-Json)" "ERROR"
            return $false
        }
    }
    catch {
        Write-Log "Failed to update manifest: $_" "ERROR"
        return $false
    }
}

function Main {
    Write-Log "═══════════════════════════════════════════════════════════" "INFO"
    Write-Log "  Star Wars Character Image Uploader for S3" "INFO"
    Write-Log "═══════════════════════════════════════════════════════════" "INFO"
    Write-Log ""

    Write-Log "Configuration:"
    Write-Log "  Bucket: $BucketName"
    Write-Log "  Region: $Region"
    Write-Log "  Nakama: $NakamaUrl"
    Write-Log "  Local:  $LOCAL_DIR"
    Write-Log "  Mode:   $(if ($DownloadOnly) { 'Download Only' } else { 'Full Upload' })"
    Write-Log ""

    $images = Download-CharacterImages

    if ($images.Count -eq 0) {
        Write-Log "No images downloaded. Exiting." "ERROR"
        exit 1
    }

    if ($DownloadOnly) {
        Write-Log "Download-only mode. Skipping S3 upload and manifest update." "INFO"
        Write-Log ""
        Write-Log "Downloaded $($images.Count) images to: $LOCAL_DIR" "SUCCESS"
        return
    }

    $uploadSuccess = Upload-ToS3 -Images $images
    if (-not $uploadSuccess) {
        Write-Log "Some uploads failed. Continuing with manifest update..." "WARN"
    }

    $filenames = $images | ForEach-Object { $_.Filename }
    $manifestSuccess = Update-NakamaManifest -Filenames $filenames

    Write-Log ""
    Write-Log "═══════════════════════════════════════════════════════════" "INFO"
    if ($manifestSuccess) {
        Write-Log "  Complete! Star Wars images available via s3_starwars_character_images RPC" "SUCCESS"
    }
    else {
        Write-Log "  Upload complete but manifest update failed. Run script again." "WARN"
    }
    Write-Log "═══════════════════════════════════════════════════════════" "INFO"
}

Main
