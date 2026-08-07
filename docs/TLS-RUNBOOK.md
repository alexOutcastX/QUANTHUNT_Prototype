# Domain cutover runbook — putting this app on taureye.com over HTTPS

Goal: `https://taureye.com` serves THIS app (the Flask + RN-web stack in this
repo) instead of the previous TaurEye site.

The stack is fully parameterised — the cutover is configuration and DNS, with
zero code changes.

## Where things stand

`taureye.com` and `www.taureye.com` already have A records pointing at the VM
this app runs on:

```
$ getent hosts taureye.com www.taureye.com
161.118.174.177  taureye.com
161.118.174.177  www.taureye.com
```

So DNS is **already done**. What remains is making sure nginx on that VM hands
those hostnames to this app, and putting a certificate in front.

## 0. Confirm nothing else is claiming the domain (owner, on the VM)

This is the step that actually decides the cutover. The app's nginx block is:

```nginx
listen 80 default_server;
server_name _;
```

`default_server` only catches hostnames that **no other server block claims**.
If a leftover block for the old site names `taureye.com`, that block wins and
keeps serving the old site — DNS pointing here changes nothing.

```bash
ssh <user>@161.118.174.177
grep -rn "server_name" /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null
curl -sS -H 'Host: taureye.com' http://127.0.0.1/ping     # expect: pong (this app)
curl -sS -H 'Host: taureye.com' http://127.0.0.1/ | head -c 200
```

- `/ping` answers and `/` contains `id="root"` → the app already owns the
  hostname; go to step 1.
- Anything else → find the block that claims `taureye.com` and retire it:
  ```bash
  sudo mv /etc/nginx/conf.d/<old-site>.conf /root/old-site.conf.disabled
  sudo nginx -t && sudo systemctl reload nginx
  ```

`deploy/enable-https.sh` refuses to run while a conflicting block exists, so a
missed leftover fails loudly instead of installing the certificate into the
wrong server block.

## 1. Issue the certificate on the VM

```bash
ssh <user>@161.118.174.177
cd /opt/quanthunt
sudo bash deploy/enable-https.sh taureye.com you@email.com
```

This sets `server_name`, installs certbot, issues a cert covering **both**
`taureye.com` and `www.taureye.com` (www is added automatically because it
resolves), adds the 443 server block with an 80→443 redirect, and enables
auto-renewal. Verify:

```bash
curl -sSI https://taureye.com/ping
```

The Flask app starts emitting `Strict-Transport-Security` automatically as soon
as requests arrive with `X-Forwarded-Proto: https` (nginx sets that header
already).

## 2. Share the session across apex and www

Both hostnames serve the app, and a host-only cookie set on `www.taureye.com`
is not sent to `taureye.com` — so a user who logs in on one and navigates to
the other appears logged out.

```bash
echo 'SESSION_COOKIE_DOMAIN=.taureye.com' | sudo tee -a /opt/quanthunt/.env
sudo systemctl restart quanthunt
```

Leave this blank on the bare IP: browsers reject a domain attribute on an IP
host, which would drop the cookie entirely.

## 3. Point the mobile clients at the domain

- **GitHub → repo Settings → Secrets and variables → Actions → Variables**:
  create `TAUREYE_API_BASE = https://taureye.com`.
  - The website needs nothing else — it is same-origin.
  - `android.yml` reads the variable, so the next APK build targets https.
- One-off build without setting the variable: run the **Android APK** workflow
  with the `api_base` input set to `https://taureye.com`.
- Local builds: `EXPO_PUBLIC_API_BASE=https://taureye.com npm run cap:build`.

## 4. Rebuild the APK (drops cleartext automatically)

`capacitor.config.ts` derives `cleartext`/`allowMixedContent` from
`EXPO_PUBLIC_API_BASE` — an https base produces an APK with cleartext OFF. Run
the **Android APK** workflow (workflow_dispatch) or push to `production`; then
distribute the new APK. Old installs keep working through the transition
because the server still answers on the bare IP until step 5.

## 5. Retire plain HTTP (after the fleet has updated)

Once installed apps are on the https-base bundle, have nginx return 301 from
the bare-IP host to the domain, and remove the IP from any docs.

## Rollback

`sudo certbot delete`, restore `deploy/nginx-quanthunt.conf` to
`server_name _;`, clear the `TAUREYE_API_BASE` variable and
`SESSION_COOKIE_DOMAIN`, rebuild. (There is no code path to undo.)
