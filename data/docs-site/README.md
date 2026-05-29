# QuizVerse Tournaments — Developer Hub (static docs site)

A self-contained, dependency-free static site that hosts every integration
guide a Unity / web / backend engineer needs to ship the Play-n-Earn
tournament system on Jul 1, 2026.

**Live URL (after deploy):** `https://tournaments-docs.intelli-verse-x.ai`

---

## What's in here

```
data/docs-site/
├── index.html           # landing page (role picker)
├── unity.html           # Unity dev guide
├── web.html             # Web dev guide
├── backend.html         # Backend / platform guide
├── launch.html          # Jul 1 launch runbook
├── reference.html       # RPC catalog
├── 404.html             # not-found fallback for the S3 website
├── assets/
│   └── styles.css       # single shared stylesheet, dark QuizVerse theme
├── bucket-policy.json   # public-read policy for the S3 bucket
├── cors.json            # CORS rules
├── deploy.sh            # one-command idempotent deploy
└── README.md            # you are here
```

There is **no build step**. Pure HTML + CSS. Edit any `.html` file, then
re-run `./deploy.sh` to push to S3.

---

## First-time deploy (10 minutes)

### 1. Prereqs

- AWS CLI v2 installed and configured (`aws sts get-caller-identity` works)
- Permission to create an S3 bucket in `us-east-1` and set its policy
- (Optional) A Route 53 hosted zone for `intelli-verse-x.ai` if you want a
  custom domain

### 2. Sync to S3

```bash
cd ~/dev/nakama/data/docs-site
./deploy.sh
```

That's it. The script:
- creates the bucket `tournaments-docs.intelli-verse-x.ai` if it doesn't exist
- disables Block-Public-Access at the bucket level
- enables static-website hosting (index = `index.html`, error = `404.html`)
- applies a public-read bucket policy
- applies permissive CORS rules
- uploads all `.html` / `.css` / `.json` files with sensible cache headers
- prints the public S3 website URL

You can immediately open the printed URL — looks like:
`http://tournaments-docs.intelli-verse-x.ai.s3-website-us-east-1.amazonaws.com`

### 3. (Optional) Custom domain + HTTPS via CloudFront

S3 static websites don't support HTTPS on a custom domain. Front it with
CloudFront in 4 steps:

1. Request an ACM cert in `us-east-1` for `tournaments-docs.intelli-verse-x.ai`.
2. Create a CloudFront distribution:
   - **Origin:** the S3 *website endpoint* (not the REST endpoint).
     Example: `tournaments-docs.intelli-verse-x.ai.s3-website-us-east-1.amazonaws.com`
   - **Viewer protocol policy:** Redirect HTTP to HTTPS
   - **Alternate domain name (CNAME):** `tournaments-docs.intelli-verse-x.ai`
   - **Custom SSL certificate:** the ACM cert from step 1
   - **Default root object:** `index.html`
   - **Custom error response:** map 403 + 404 → `/404.html` (status 404)
3. Add a Route 53 `A` alias record from `tournaments-docs.intelli-verse-x.ai`
   to the distribution.
4. Re-run the deploy with the distribution id so it invalidates the CF cache:

   ```bash
   DISTRIBUTION_ID=E1ABCDEFGHIJ ./deploy.sh
   ```

You're done. Visit `https://tournaments-docs.intelli-verse-x.ai`.

---

## Updating a page

1. Edit the relevant `.html` file (HTML + inline classes from `assets/styles.css`).
2. `./deploy.sh` — pushes only changed files (S3 sync is incremental).
3. If you front with CloudFront, re-run with `DISTRIBUTION_ID=...` to bust
   the edge cache.

### Adding a new page

1. Copy any existing page as a template (e.g. `unity.html`).
2. Update the `<title>`, `<meta description>`, hero copy, and main content.
3. Add the new page to the top-nav of **every other page** — just append
   one `<a>` line inside `.topnav-links` in each `*.html` file.
4. Optionally add a role-card to `index.html`.
5. Re-run `./deploy.sh`.

---

## Style guide

The shared stylesheet provides ready-made components — use these instead
of rolling new markup:

| Component | Markup |
|---|---|
| Hero banner | `<header class="hero"> ... </header>` |
| Step block | `<div class="step"><div class="step-num">N</div><div class="step-body">...</div></div>` |
| Callout (info) | `<div class="callout"> <div class="callout-title">Title</div> ... </div>` |
| Callout (tip / warning / danger) | add `tip`, `warning`, or `danger` class |
| Role card (landing) | `<a class="role-card" href="...">...</a>` |
| Table | plain `<table>` |
| Checklist | `<ul class="checklist"><li class="done">...</li></ul>` |
| Badge | `<span class="badge primary|success|warning|danger|gold">LIVE</span>` |

Brand colors are CSS variables at the top of `assets/styles.css`:
- `--primary: #7c3aed` (purple)
- `--accent: #fbbf24` (gold)
- Dark theme throughout

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `403 Forbidden` opening the S3 URL | Bucket policy didn't apply. Re-run `./deploy.sh` — it re-applies the policy each time. |
| Page changes don't show up | If you have CloudFront, run with `DISTRIBUTION_ID=...`. Otherwise wait 60 s (HTML cache) or hard-refresh. |
| `aws: Unable to locate credentials` | Run `aws configure` or `export AWS_PROFILE=<profile>`. |
| Custom domain says "site can't be reached" | Route 53 alias not set up yet, or CloudFront hasn't finished deploying (takes 5–15 min). |

---

## Cost estimate

- S3 storage: a few cents/month (entire site is ~ 60 KB)
- S3 requests: free tier covers the volume from internal engineering use
- CloudFront (optional): first 1 TB/month is free; this site won't get close

**Total expected cost:** < $1/month even with CloudFront.

---

## Ownership

- **Code-owner:** Tournaments squad
- **Slack:** `#tournaments-launch`
- **Last touched:** 2026-05-26
