# SIMPLIFY Headless Chromium PDF Microservice (`/pdf-service`)

Production PDF rendering service for **SIMPLIFY SaaS**. Generates pixel-perfect, vector-quality PDF documents using headless Chromium (`page.pdf()`), ensuring 100% visual parity with browser native print preview across all 19 document types.

---

## 1. Architecture

```
React Frontend (Canonical DOM + Print CSS)
       │
       ▼ (HTTP POST /render with Supabase JWT)
Headless Chromium Service (/pdf-service)
       │
       ├─ Emulate MediaType: 'print'
       ├─ Embedded Inter Font Family (woff2 base64)
       ├─ SSRF Protection: Aborts all non-data: requests
       └─ page.pdf({ preferCSSPageSize: true, printBackground: true })
       │
       ▼ (application/pdf stream)
Vector PDF Blob (< 200 KB, selectable text, crisp typography)
```

---

## 2. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Service HTTP port |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (e.g. `https://simplify.company,http://localhost:5173`) |
| `MAX_CONCURRENT` | `3` | Maximum concurrent Chromium render pages (semaphore) |
| `SUPABASE_JWT_SECRET` | *(optional)* | Secret used to verify client JWTs in production |
| `PUPPETEER_EXECUTABLE_PATH` | *(auto-detected)* | Path to Chromium executable |

---

## 3. Endpoints

### `GET /health`
Returns service status, uptime, and active render count:
```json
{
  "status": "ok",
  "uptime": 128,
  "activeRenders": 0,
  "timestamp": "2026-11-25T19:00:00.000Z"
}
```

### `POST /render`
Renders an HTML fragment into a vector PDF:
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer <supabase_jwt>`
- **Request Body:**
  ```json
  {
    "html": "<div id=\"invoice-doc\">...</div>",
    "css": "@media print { ... }",
    "page": "A5",
    "filename": "INV-0004.pdf"
  }
  ```
- **Response:** `application/pdf` binary stream.

---

## 4. Local Development

```bash
cd pdf-service
npm install
npm start
```

---

## 5. Docker Deployment

### Build & Run Locally
```bash
docker build -t simplify-pdf-service .
docker run -p 3001:3001 --init --name pdf-service simplify-pdf-service
```

### Deploy to Always-On Container Host (Recommended: Railway / Fly.io / Render / GCP Cloud Run)

#### Deploy to Railway:
1. Connect repository or run `railway up` in `pdf-service/`.
2. Configure `PORT=3001` and `CORS_ORIGIN=https://your-app-domain.vercel.app`.
3. Set `VITE_PDF_SERVICE_URL=https://your-pdf-service.up.railway.app` in frontend environment.

#### Deploy to Fly.io:
```bash
fly launch --dockerfile Dockerfile --port 3001
fly deploy
```

#### Deploy to Google Cloud Run:
```bash
gcloud run deploy simplify-pdf-service \
  --source . \
  --platform managed \
  --region asia-south1 \
  --min-instances 1 \
  --memory 1Gi \
  --cpu 1 \
  --allow-unauthenticated
```
