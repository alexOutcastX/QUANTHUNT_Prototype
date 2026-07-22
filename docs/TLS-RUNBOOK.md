# TLS runbook — moving TaurEye from the plain-HTTP IP to an https domain

The whole stack is already parameterised; going live on TLS is four steps and
zero code changes.

## 0. Prerequisites (owner)

- Buy a domain and create an **A record** pointing at the VM's public IP
  (161.118.174.177). Wait for DNS to propagate (`dig +short yourdomain.com`).
- Ports 80 and 443 open in both the Oracle security list and the OS firewall.

## 1. Issue the certificate on the VM

```bash
ssh <user>@161.118.174.177
cd /opt/quanthunt
sudo bash deploy/enable-https.sh yourdomain.com you@email.com
```

This sets `server_name`, installs certbot, issues the cert, adds the 443
server block with an 80→443 redirect, and enables auto-renewal. Verify:
`curl -sSI https://yourdomain.com/ping`.

The Flask app starts emitting `Strict-Transport-Security` automatically as
soon as requests arrive with `X-Forwarded-Proto: https` (nginx sets this
header already).

## 2. Point the clients at the domain

- **GitHub → repo Settings → Secrets and variables → Actions → Variables**:
  create `TAUREYE_API_BASE = https://yourdomain.com`.
  - The web deploy needs nothing else (the website is same-origin).
  - The next push to `production` publishes an OTA bundle built against the
    https base (`android.yml` reads the variable).
- Local builds: `EXPO_PUBLIC_API_BASE=https://yourdomain.com npm run cap:build`.

## 3. Rebuild the APK (drops cleartext automatically)

`capacitor.config.ts` derives `cleartext`/`allowMixedContent` from
`EXPO_PUBLIC_API_BASE` — an https base produces an APK with cleartext OFF.
Run the **Android APK + Capgo OTA** workflow (workflow_dispatch) or push to
`production`; distribute the new APK. Old installs keep working through the
transition because the server still answers on the IP until step 4.

## 4. Retire plain HTTP (after fleet has updated)

Once installed apps are on the https-base bundle, optionally have nginx return
301 from the bare-IP host to the domain, and remove the IP from any docs.

## Rollback

`sudo certbot delete` + restore `deploy/nginx-quanthunt.conf`, clear the
`TAUREYE_API_BASE` variable, rebuild. (There is no code path to undo.)
