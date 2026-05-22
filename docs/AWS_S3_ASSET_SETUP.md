# AWS S3 Asset Storage Setup for Nakama

This guide walks through setting up AWS S3 for secure asset delivery via Nakama. This is the recommended approach for serving game assets like Star Wars character images, quiz media, and other binary content.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Unity Client  │────▶│  Nakama Server  │────▶│    AWS S3       │
│                 │     │                 │     │  (Private)      │
│  1. Request     │     │  2. Validate    │     │                 │
│     asset       │     │     user        │     │  3. Generate    │
│                 │◀────│                 │◀────│     pre-signed  │
│  5. Download    │     │  4. Return URL  │     │     URL         │
│     from S3     │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Step 1: Create an S3 Bucket

### Via AWS Console

1. Go to [AWS S3 Console](https://s3.console.aws.amazon.com/)
2. Click **Create bucket**
3. Configuration:
   - **Bucket name**: `intelliverse-x-assets` (or your preferred name)
   - **AWS Region**: `us-east-1` (or closest to your users)
   - **Object Ownership**: ACLs disabled (recommended)
   - **Block Public Access**: ✅ Block *all* public access
   - **Bucket Versioning**: Disabled (optional)
   - **Default encryption**: SSE-S3 (recommended)
4. Click **Create bucket**

### Via AWS CLI

```bash
# Create bucket
aws s3 mb s3://intelliverse-x-assets --region us-east-1

# Block all public access
aws s3api put-public-access-block \
    --bucket intelliverse-x-assets \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

## Step 2: Create IAM Policy

Create a policy that grants only the necessary permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "NakamaAssetAccess",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::intelliverse-x-assets",
                "arn:aws:s3:::intelliverse-x-assets/*"
            ]
        }
    ]
}
```

### Via AWS Console

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Policies** → **Create policy**
3. Select **JSON** tab and paste the policy above
4. Name it: `NakamaS3AssetPolicy`
5. Click **Create policy**

## Step 3: Create IAM User

1. Go to **IAM** → **Users** → **Add users**
2. **User name**: `nakama-asset-service`
3. **Access type**: ✅ Access key - Programmatic access
4. Click **Next: Permissions**
5. Select **Attach existing policies directly**
6. Search for and select `NakamaS3AssetPolicy`
7. Click through to **Create user**
8. **IMPORTANT**: Copy the **Access key ID** and **Secret access key**

## Step 4: Configure Nakama

Add credentials to your `.env` file:

```env
# AWS S3 Asset Storage
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
AWS_S3_BUCKET=intelliverse-x-assets
AWS_PRESIGNED_URL_EXPIRY=3600
```

## Step 5: Organize Assets in S3

Recommended folder structure:

```
intelliverse-x-assets/
├── starwars/
│   ├── characters/
│   │   ├── luke_skywalker.png
│   │   ├── darth_vader.png
│   │   ├── yoda.png
│   │   └── ...
│   ├── planets/
│   │   ├── tatooine.png
│   │   └── ...
│   └── ships/
│       ├── millennium_falcon.png
│       └── ...
├── quizverse/
│   ├── categories/
│   │   ├── science.png
│   │   └── ...
│   └── characters/
│       ├── quizzy.png
│       └── ...
└── shared/
    └── icons/
        └── ...
```

## Step 6: Upload Assets

### Via AWS CLI

```bash
# Upload a single file
aws s3 cp luke_skywalker.png s3://intelliverse-x-assets/starwars/characters/

# Upload entire folder
aws s3 sync ./starwars-images/ s3://intelliverse-x-assets/starwars/characters/

# List uploaded files
aws s3 ls s3://intelliverse-x-assets/starwars/characters/
```

### Via Upload Script (Recommended)

Use the provided PowerShell script:

```powershell
# From nakama directory
.\scripts\upload-s3-assets.ps1 -SourceFolder ".\assets\starwars" -Category "starwars/characters"
```

## Using the Asset System

### From Unity Client

```csharp
// Get download URL for a Star Wars character image
var response = await client.RpcAsync(session, "s3_asset_download", JsonUtility.ToJson(new {
    category = "starwars/characters",
    name = "luke_skywalker.png"
}));

var result = JsonUtility.FromJson<AssetDownloadResponse>(response.Payload);
// result.downloadUrl contains a pre-signed S3 URL valid for 1 hour

// Download the image
using var request = UnityWebRequestTexture.GetTexture(result.downloadUrl);
await request.SendWebRequest();
var texture = DownloadHandlerTexture.GetContent(request);
```

### List Assets in a Category

```csharp
var response = await client.RpcAsync(session, "s3_asset_list", JsonUtility.ToJson(new {
    category = "starwars/characters"
}));

var result = JsonUtility.FromJson<AssetListResponse>(response.Payload);
// result.assets contains array of { name, downloadUrl }
```

## Security Best Practices

1. **Never expose AWS credentials to clients** - All S3 access goes through Nakama
2. **Use short-lived pre-signed URLs** - Default 1 hour, max 24 hours
3. **Enable S3 access logging** for audit trails
4. **Rotate IAM credentials** periodically
5. **Use bucket policies** to restrict access by IP if needed

## Cost Estimation

| Resource | Free Tier | After Free Tier |
|----------|-----------|-----------------|
| S3 Storage | 5 GB/month | $0.023/GB/month |
| GET requests | 20,000/month | $0.0004 per 1,000 |
| PUT requests | 2,000/month | $0.005 per 1,000 |
| Data transfer out | 100 GB/month | $0.09/GB |

For a typical quiz game with ~100 character images (~5 MB total), monthly cost is essentially **$0** under free tier, or **< $1/month** otherwise.

## Troubleshooting

### "Access Denied" errors

- Verify IAM policy is attached to the user
- Check bucket name matches exactly (case-sensitive)
- Ensure region is correct

### "InvalidAccessKeyId"

- Verify AWS_ACCESS_KEY_ID is correct
- Check for trailing whitespace in .env

### Pre-signed URLs expire too quickly

- Increase `AWS_PRESIGNED_URL_EXPIRY` in .env (max: 604800 = 7 days)
- Client should cache images locally after first download

### CORS errors from Unity WebGL

Add CORS configuration to your S3 bucket:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```
