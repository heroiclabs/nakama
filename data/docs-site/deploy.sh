#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# QuizVerse Tournaments — Docs site deploy script
#
# What it does (idempotent):
#   1. Verifies you have AWS creds + the right region.
#   2. Creates the S3 bucket on first run, applies static-website config,
#      bucket policy (public-read), and CORS rules.
#   3. Syncs the static files to S3 with sensible cache headers.
#   4. (Optional) Invalidates the CloudFront distribution so visitors see
#      the new build immediately.
#
# Usage:
#   ./deploy.sh                    # sync to default bucket
#   BUCKET=my-test-bucket ./deploy.sh
#   DISTRIBUTION_ID=E12345 ./deploy.sh   # also invalidate CF cache
#
# Prereqs: awscli >= 2, ability to assume the intelli-verse-x ops profile.
# ----------------------------------------------------------------------------

set -euo pipefail

BUCKET="${BUCKET:-tournaments-docs.intelli-verse-x.ai}"
REGION="${AWS_REGION:-us-east-1}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
PROFILE_ARG=""
if [[ -n "${AWS_PROFILE:-}" ]]; then
  PROFILE_ARG="--profile $AWS_PROFILE"
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "==> Target bucket : s3://$BUCKET"
echo "==> Region        : $REGION"
echo "==> Source folder : $SCRIPT_DIR"
echo ""

# ----------------------------------------------------------------------------
# 1. Pre-flight: AWS creds + bucket existence
# ----------------------------------------------------------------------------
echo "[1/5] Checking AWS credentials..."
aws sts get-caller-identity $PROFILE_ARG --output text >/dev/null
echo "      ok"

echo "[2/5] Ensuring bucket exists..."
if aws s3api head-bucket --bucket "$BUCKET" $PROFILE_ARG 2>/dev/null; then
  echo "      bucket already exists"
else
  echo "      creating bucket s3://$BUCKET in $REGION..."
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" $PROFILE_ARG
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" $PROFILE_ARG
  fi

  # Allow public bucket policy (account-level Block Public Access can otherwise reject it)
  aws s3api put-public-access-block --bucket "$BUCKET" $PROFILE_ARG \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
fi

# ----------------------------------------------------------------------------
# 2. Apply static-website hosting + policy + CORS
# ----------------------------------------------------------------------------
echo "[3/5] Applying static-website hosting + policy + CORS..."
aws s3 website "s3://$BUCKET/" \
  --index-document index.html \
  --error-document 404.html $PROFILE_ARG

# Substitute the bucket name into the policy template on the fly
sed "s/tournaments-docs.intelli-verse-x.ai/$BUCKET/g" bucket-policy.json \
  | aws s3api put-bucket-policy --bucket "$BUCKET" $PROFILE_ARG --policy file:///dev/stdin

aws s3api put-bucket-cors --bucket "$BUCKET" $PROFILE_ARG \
  --cors-configuration file://cors.json

echo "      website + policy + CORS applied"

# ----------------------------------------------------------------------------
# 3. Sync files with sensible cache headers
# ----------------------------------------------------------------------------
echo "[4/5] Syncing files..."

# HTML (short cache so doc updates are picked up fast)
aws s3 sync . "s3://$BUCKET/" $PROFILE_ARG \
  --exclude "*" --include "*.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "public, max-age=60, must-revalidate" \
  --delete

# CSS (long cache; bust by editing the file path if you must)
aws s3 sync ./assets "s3://$BUCKET/assets/" $PROFILE_ARG \
  --exclude "*" --include "*.css" \
  --content-type "text/css; charset=utf-8" \
  --cache-control "public, max-age=86400"

# JSON helpers (bucket policy + cors are not for the site, but harmless to ship)
aws s3 sync . "s3://$BUCKET/" $PROFILE_ARG \
  --exclude "*" --include "*.json" \
  --content-type "application/json" \
  --cache-control "public, max-age=300"

# Make sure deploy artefacts themselves don't get uploaded
aws s3 rm "s3://$BUCKET/deploy.sh" $PROFILE_ARG 2>/dev/null || true
aws s3 rm "s3://$BUCKET/README.md" $PROFILE_ARG 2>/dev/null || true

echo "      sync complete"

# ----------------------------------------------------------------------------
# 4. Optional CloudFront invalidation
# ----------------------------------------------------------------------------
if [[ -n "$DISTRIBUTION_ID" ]]; then
  echo "[5/5] Invalidating CloudFront distribution $DISTRIBUTION_ID..."
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" $PROFILE_ARG --output text
  echo "      invalidation submitted"
else
  echo "[5/5] Skipping CloudFront (set DISTRIBUTION_ID=... to enable)"
fi

# ----------------------------------------------------------------------------
# Done — print the live URLs
# ----------------------------------------------------------------------------
WEBSITE_URL="http://$BUCKET.s3-website-$REGION.amazonaws.com"
if [[ "$REGION" == "us-east-1" ]]; then
  WEBSITE_URL="http://$BUCKET.s3-website-us-east-1.amazonaws.com"
fi

echo ""
echo "==============================================================="
echo "  Deployed!"
echo "  S3 website endpoint : $WEBSITE_URL"
echo "  Public S3 URL       : https://$BUCKET.s3.$REGION.amazonaws.com/index.html"
if [[ -n "$DISTRIBUTION_ID" ]]; then
  echo "  CloudFront          : https://tournaments-docs.intelli-verse-x.ai"
fi
echo "==============================================================="
