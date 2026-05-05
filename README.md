# FarmVista Weather Service

## Purpose
Cloud Run service to:
- Pull weather data
- Store in Firestore
- Compute readiness

## Run locally
npm install
npm start

## Deploy
gcloud run deploy farmvista-weather --source .
