# Upgrade to HTTPS (CloudFront)

The site is currently live on **HTTP only** at
`http://tournaments-docs.intelli-verse-x.ai` because S3 website endpoints
don't terminate TLS on custom domains.

To enable HTTPS, you need to grant the deploy IAM user permission to
create + manage a CloudFront distribution. Everything else
(wildcard ACM cert, Route 53 hosted zone, bucket) is already in place.

---

## Step 1 — grant IAM perms to `s3-user`

Attach this inline policy (or attach the AWS-managed
`CloudFrontFullAccess`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution",
        "cloudfront:GetDistribution",
        "cloudfront:GetDistributionConfig",
        "cloudfront:ListDistributions",
        "cloudfront:UpdateDistribution",
        "cloudfront:DeleteDistribution",
        "cloudfront:CreateInvalidation",
        "cloudfront:TagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

CLI:

```bash
aws iam put-user-policy \
  --user-name s3-user \
  --policy-name CloudFrontDistMgmt \
  --policy-document file://.deploy/cloudfront-iam-policy.json
```

## Step 2 — create the distribution (one command)

The distribution config is already prepared at
`.deploy/cloudfront-config.json`. It references the existing
`*.intelli-verse-x.ai` ACM cert.

```bash
cd ~/dev/nakama/data/docs-site

DIST=$(aws cloudfront create-distribution \
  --distribution-config file://.deploy/cloudfront-config.json \
  --query 'Distribution.{Id:Id,Domain:DomainName}' --output json)
echo "$DIST"

DIST_ID=$(echo "$DIST"   | python3 -c 'import sys,json;print(json.load(sys.stdin)["Id"])')
DIST_DOMAIN=$(echo "$DIST" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Domain"])')
```

Wait ~10 min for CloudFront to deploy globally:

```bash
aws cloudfront wait distribution-deployed --id "$DIST_ID"
```

## Step 3 — flip the Route 53 alias from S3 to CloudFront

```bash
cat > /tmp/r53-cf.json <<EOF
{
  "Comment": "Tournaments docs — switch to CloudFront",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "tournaments-docs.intelli-verse-x.ai.",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "Z2FDTNDATAQYW2",
        "DNSName": "${DIST_DOMAIN}.",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
EOF

aws route53 change-resource-record-sets \
  --hosted-zone-id Z0145313YX71CJ73SY5B \
  --change-batch file:///tmp/r53-cf.json
```

(`Z2FDTNDATAQYW2` is CloudFront's canonical alias hosted-zone ID.)

## Step 4 — re-run the deploy with cache invalidation

```bash
DISTRIBUTION_ID=$DIST_ID ./deploy.sh
```

You're done. `https://tournaments-docs.intelli-verse-x.ai` will work
within a few minutes (allow DNS TTL).

---

## Why this isn't blocking launch

The audience for this docs site is internal engineers. HTTP is fine
for the team — no PII, no auth, just static HTML. Upgrade to HTTPS
when convenient.
