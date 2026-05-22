#!/bin/bash
# upload_starwars_images.sh - Upload Star Wars character images to AWS S3
#
# Usage:
#   ./upload_starwars_images.sh                  # Full upload
#   ./upload_starwars_images.sh --download-only  # Download only
#
# Environment variables:
#   AWS_S3_BUCKET - S3 bucket name (required)
#   AWS_REGION    - AWS region (default: us-east-1)
#   NAKAMA_URL    - Nakama server URL (default: http://localhost:7350)
#   HTTP_KEY      - Nakama HTTP key (default: defaultkey)

set -e

# Configuration
BUCKET_NAME="${AWS_S3_BUCKET:-}"
REGION="${AWS_REGION:-us-east-1}"
NAKAMA_URL="${NAKAMA_URL:-http://localhost:7350}"
HTTP_KEY="${HTTP_KEY:-defaultkey}"
DOWNLOAD_ONLY=false

STARWARS_API_URL="https://akabab.github.io/starwars-api/api/all.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIR="$SCRIPT_DIR/starwars_images"
S3_PREFIX="starwars/characters"
CATEGORY="starwars/characters"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --download-only)
            DOWNLOAD_ONLY=true
            shift
            ;;
        --bucket)
            BUCKET_NAME="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        INFO)    echo -e "\033[36m[$timestamp] [INFO] $message\033[0m" ;;
        SUCCESS) echo -e "\033[32m[$timestamp] [SUCCESS] $message\033[0m" ;;
        WARN)    echo -e "\033[33m[$timestamp] [WARN] $message\033[0m" ;;
        ERROR)   echo -e "\033[31m[$timestamp] [ERROR] $message\033[0m" ;;
        *)       echo "[$timestamp] $message" ;;
    esac
}

normalize_name() {
    local name="$1"
    echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g' | sed 's/__*/_/g' | sed 's/^_//;s/_$//'
}

download_images() {
    log "INFO" "Downloading Star Wars character data from akabab API..."
    
    mkdir -p "$LOCAL_DIR"
    
    local json_file="$LOCAL_DIR/characters.json"
    if ! curl -s -o "$json_file" "$STARWARS_API_URL"; then
        log "ERROR" "Failed to fetch character data"
        return 1
    fi
    
    local count=$(jq length "$json_file")
    log "INFO" "Found $count characters in API"
    
    local downloaded=0
    local failed=0
    
    for i in $(seq 0 $((count - 1))); do
        local name=$(jq -r ".[$i].name" "$json_file")
        local image_url=$(jq -r ".[$i].image" "$json_file")
        
        if [ -z "$name" ] || [ "$name" = "null" ] || [ -z "$image_url" ] || [ "$image_url" = "null" ]; then
            continue
        fi
        
        local normalized=$(normalize_name "$name")
        local extension="${image_url##*.}"
        [ -z "$extension" ] && extension="png"
        local filename="${normalized}.${extension}"
        local local_path="$LOCAL_DIR/$filename"
        
        if [ -f "$local_path" ]; then
            log "INFO" "Skipping (exists): $filename"
            ((downloaded++))
            continue
        fi
        
        log "INFO" "Downloading: $name -> $filename"
        if curl -s -o "$local_path" "$image_url"; then
            ((downloaded++))
            sleep 0.2
        else
            log "WARN" "Failed to download: $name"
            ((failed++))
        fi
    done
    
    log "SUCCESS" "Downloaded $downloaded images, $failed failed"
    echo "$downloaded"
}

upload_to_s3() {
    if [ -z "$BUCKET_NAME" ]; then
        log "ERROR" "BUCKET_NAME not specified. Set AWS_S3_BUCKET env var or --bucket parameter."
        return 1
    fi
    
    local count=$(ls -1 "$LOCAL_DIR"/*.{png,jpg,jpeg,webp} 2>/dev/null | wc -l)
    log "INFO" "Uploading $count images to s3://$BUCKET_NAME/$S3_PREFIX/"
    
    local uploaded=0
    local failed=0
    
    for file in "$LOCAL_DIR"/*.{png,jpg,jpeg,webp}; do
        [ -f "$file" ] || continue
        
        local filename=$(basename "$file")
        local s3_key="$S3_PREFIX/$filename"
        
        log "INFO" "Uploading: $filename"
        if aws s3 cp "$file" "s3://$BUCKET_NAME/$s3_key" --region "$REGION" --quiet; then
            ((uploaded++))
        else
            log "WARN" "Failed to upload: $filename"
            ((failed++))
        fi
    done
    
    if [ $failed -gt 0 ]; then
        log "WARN" "Uploaded $uploaded images, $failed failed"
        return 1
    else
        log "SUCCESS" "Uploaded $uploaded images"
        return 0
    fi
}

update_manifest() {
    log "INFO" "Updating Nakama asset manifest..."
    
    local files=()
    for file in "$LOCAL_DIR"/*.{png,jpg,jpeg,webp}; do
        [ -f "$file" ] || continue
        files+=("\"$(basename "$file")\"")
    done
    
    local assets_json=$(IFS=,; echo "[${files[*]}]")
    local payload="{\"category\":\"$CATEGORY\",\"assets\":$assets_json}"
    local url="$NAKAMA_URL/v2/rpc/s3_asset_manifest_update?http_key=$HTTP_KEY"
    
    local response=$(curl -s -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "$payload")
    
    if echo "$response" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
        log "SUCCESS" "Manifest updated with ${#files[@]} assets"
        return 0
    else
        log "ERROR" "Manifest update failed: $response"
        return 1
    fi
}

main() {
    log "INFO" "═══════════════════════════════════════════════════════════"
    log "INFO" "  Star Wars Character Image Uploader for S3"
    log "INFO" "═══════════════════════════════════════════════════════════"
    echo ""
    
    log "INFO" "Configuration:"
    log "INFO" "  Bucket: $BUCKET_NAME"
    log "INFO" "  Region: $REGION"
    log "INFO" "  Nakama: $NAKAMA_URL"
    log "INFO" "  Local:  $LOCAL_DIR"
    log "INFO" "  Mode:   $([ "$DOWNLOAD_ONLY" = true ] && echo 'Download Only' || echo 'Full Upload')"
    echo ""
    
    download_images
    
    if [ "$DOWNLOAD_ONLY" = true ]; then
        log "INFO" "Download-only mode. Skipping S3 upload and manifest update."
        echo ""
        log "SUCCESS" "Images saved to: $LOCAL_DIR"
        return 0
    fi
    
    upload_to_s3 || log "WARN" "Some uploads failed. Continuing with manifest update..."
    
    update_manifest || log "WARN" "Manifest update failed. Run script again."
    
    echo ""
    log "INFO" "═══════════════════════════════════════════════════════════"
    log "SUCCESS" "  Complete! Star Wars images available via s3_starwars_character_images RPC"
    log "INFO" "═══════════════════════════════════════════════════════════"
}

main
