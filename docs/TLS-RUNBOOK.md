# Domain cutover runbook — putting this app on taureye.com over HTTPS

Goal: `https://taureye.com` serves THIS app (the Flask + RN-web stack in this
repo) instead of the previous TaurEye site.

The stack is fully parameterised — the cutover is configuration and DNS, with
zero code changes.

## 0. Point the domain at this VM (owner, at the DNS provider)

**This is the whole cutover. Everything else is follow-up.**

`taureye.com` currently resolves to the old host:

```
$ getent ahostsv4 taureye.com www.taureye.com
98.70.43.232      taureye.com
98.70.43.232      www.taureye.com
```

That is not this VM (`161.118.174.177`). Until the A records change, this app
cannot serve the domain and a certificate cannot be issued for it — Let's
Encrypt resolves the name over public DNS and fetches the ACME challenge from
whatever IP it gets.

At the DNS provider for `taureye.com`, set:

| Record | Name | Value |
|---|---|---|
| A | `@` | `161.118.174.177` |
| A | `www` | `161.118.174.177` |

Delete or repoint any existing A/AAAA/ALIAS record for those names. Propagation
is usually minutes; confirm with `getent ahostsv4 taureye.com`.

> **Do not trust a `Host:`-header probe for this.** Running
> `curl -H 'Host: taureye.com' http://127.0.0.1/` on the VM only shows which
> server block *would* handle the hostname — it cannot see where public traffic
> goes, and reading it as "the domain is live here" is wrong.
> The **VM TLS / domain cutover** workflow (`mode: diagnose`) resolves the name
> over public DNS and compares it to the deploy host, which is the check that
> actually answers the question. `mode: enable` refuses to run on a mismatch
> rather than burning a Let's Encrypt attempt.

Nothing else on the VM claims the domain — it has exactly one nginx server
block, this app's, which is `listen 80 default_server; server_name _`. So once
DNS moves, the app serves the domain immediately over plain HTTP.

## 1. Issue the certificate on the VM

```bash
ssh <user>@161.118.174.177
cd /opt/quanthunt
sudo bash deploy/enable-https.sh taureye.com you@email.com
```

This sets `server_name`, installs certbot, issues a cert covering **both**
`taureye.com` and `www.taureye.com` (www is added automatically because it
resolves), adds the 443 server block, and enables auto-renewal.

It deliberately does **not** add an 80→443 redirect. certbot implements that
redirect by rewriting the port-80 block — prepending an `if ($host = …) return
301` per certificate name and appending `return 404` for everything else. That
block is this app's `listen 80 default_server`: the one that answers for the
**bare IP**, which is what every APK in the field uses as its API base. Turning
the redirect on before the fleet has moved would 404 every installed app the
moment the certificate is issued. See step 5.

Verify:

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

## 5. Retire plain HTTP (only after the fleet has updated)

Once installed apps are on the https-base bundle, turn the redirect on:

```bash
cd /opt/quanthunt
sudo REDIRECT=1 bash deploy/enable-https.sh taureye.com you@email.com
```

or run the **VM TLS / domain cutover** workflow with `mode: enable` and
`redirect_http: true`.

This is the step that stops plain HTTP — including on the bare IP. Do not run
it while APKs built against `http://161.118.174.177` are still in use; check
that first, because there is no signal from the server side that they have all
moved.

## Rollback

`sudo certbot delete`, restore `deploy/nginx-quanthunt.conf` to
`server_name _;`, clear the `TAUREYE_API_BASE` variable and
`SESSION_COOKIE_DOMAIN`, rebuild. (There is no code path to undo.)
