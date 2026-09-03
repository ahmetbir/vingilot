# Vingilot feedback drop

The owner's in-app reports, with screenshots, on afk-prod. See `main.go`'s
header for the shape; this file is the runbook.

**URL the app is given:** `https://buzz.ahmetbirinci.dev/feedback`
(the relay's own vhost — no DNS, no cert; one `location` in `afk.conf`).

**Key:** generated on the box into `/opt/vingilot-feedback/key` (0600).
Read it there; it is never printed by anything in this repo.

```
# on the box
cd /opt/vingilot-feedback && docker compose up -d --build
curl -s -o /dev/null -w '%{http_code}\n' https://buzz.ahmetbirinci.dev/feedback/healthz   # 204

# from the session, over ssh — the bearer never leaves the box
ssh afk-deploy 'curl -s 127.0.0.1:9871/admin/feedback?unacked=1'
ssh afk-deploy 'curl -s -X POST 127.0.0.1:9871/admin/feedback/<id>/ack'
```

Rotate the key: write a new one to the file, `docker compose restart`, enter
it in the app again.
