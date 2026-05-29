# tournament_certificate Lambda

Renders QuizVerse tournament certificate PDFs + Open Graph share images on
demand and stores them in S3 (`intelli-verse-x-media`).

## Triggers

1. **API Gateway** — `GET /certificate/{certId}/render` (used by the
   web `/certificate/[id]` page when it sees `pdf_status="pending"`).
2. **SQS / direct invoke** — `{ certId: string, force?: boolean }`
   (fan-out from the Nakama post-settlement cron).

## Env vars

| Variable | Default | Purpose |
|---|---|---|
| `CERT_BUCKET` | `intelli-verse-x-media` | Output S3 bucket |
| `CERT_PREFIX` | `tournaments/certificates` | Object key prefix |
| `NAKAMA_INTERNAL_URL` | `http://nakama.nakama.svc.cluster.local:7350` | Where to read the cert row from |
| `NAKAMA_HTTP_KEY` | _required_ | HTTP key for public RPC calls |

## Build + deploy

```bash
cd data/lambda-functions/tournament_certificate
npm install
npm run package           # -> tournament_certificate.zip
aws lambda update-function-code \
  --function-name tournament_certificate \
  --zip-file fileb://tournament_certificate.zip
```

The function needs `sharp` compiled for Linux x64 (Lambda runtime). Use
`npm install --os=linux --cpu=x64 sharp` on macOS to grab the right binary.

## Output

```
s3://intelli-verse-x-media/tournaments/certificates/{certId}.pdf
s3://intelli-verse-x-media/tournaments/certificates/{certId}-og.png   (1200x630)
```

Public URLs:

```
https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/tournaments/certificates/{certId}.pdf
https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/tournaments/certificates/{certId}-og.png
```
