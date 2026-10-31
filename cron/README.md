This does not have automatic deployment.

To deploy, first create a new image with the following command:
```bash
gcloud builds submit --tag us-central1-docker.pkg.dev/YOUR_GCP_PROJECT/social-media-cron-deploy/social-media-cron:latest --region us-central1 \
  --project YOUR_GCP_PROJECT
```

Then, deploy the cloud run job:
```bash
gcloud run jobs update social-media-cron \
  --image us-central1-docker.pkg.dev/YOUR_GCP_PROJECT/social-media-cron-deploy/social-media-cron:latest \
  --region us-central1 --project YOUR_GCP_PROJECT
```

