# Hosting QuantHunt on Oracle Cloud (same setup as TaurEye)

This mirrors TaurEye's production hosting — an Oracle Always-Free VM, **nginx**
on ports 80/443, a real domain/HTTPS, and **push-to-deploy via GitHub Actions**.
The one difference is forced by architecture: TaurEye serves a *static* bundle,
whereas QuantHunt fetches market data on demand, so it runs a **live gunicorn
service** and nginx reverse-proxies to it. Everything else — the VM, nginx, the
`/opt` layout, the deploy-on-push flow — is the same.

```
You (laptop) --git push--> GitHub --Actions(deploy.yml)--> rsync --> /opt/quanthunt
                                                        \-> restart gunicorn + reload nginx
Browser --:80/:443--> nginx --reverse proxy--> gunicorn (127.0.0.1:5000) --> live NSE/yfinance
```

**Region matters.** Create the VM in **India South (Mumbai)** so NSE/yfinance are
reachable (the same reason TaurEye pins Mumbai). QuantHunt is stateless — it
caches data in memory for 6 hours — so there's no database to upload or sync.

You do steps 1–2 (Oracle account / VM). Everything after is copy-paste.

---

## 1. Create the VM (one-time)
1. Sign up at cloud.oracle.com → **Home region = India South (Mumbai)**.
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 22.04** (or Oracle Linux 9 — the setup script handles both).
   - Shape: **Ampere (Arm) — VM.Standard.A1.Flex**, e.g. 1–2 OCPU / 6–12 GB.
   - Add your SSH public key; keep the private key.
3. Note the **Public IP**.

## 2. Open ports 80 + 443 in the Oracle VCN (cloud firewall)
Networking → your VCN → Security List → add **Ingress** rules: Source `0.0.0.0/0`,
TCP, destination ports **80** and **443**. (The setup script opens the VM's own
OS firewall; this opens Oracle's outer one.)

## 3. One-time VM setup
SSH in, clone the repo, and run the setup script:
```bash
ssh <user>@YOUR_VM_IP          # user = ubuntu (Ubuntu) or opc (Oracle Linux)
git clone https://github.com/alexOutcastX/QUANTHUNT_Prototype.git
cd QUANTHUNT_Prototype
bash deploy/setup-vm.sh
```
This installs nginx + Python, creates the venv at `/opt/quanthunt/venv`, installs
deps (incl. gunicorn), installs and starts the **`quanthunt`** systemd service on
`127.0.0.1:5000`, installs the nginx reverse-proxy site, sets the SELinux
`httpd_can_network_connect` boolean (so nginx may reach the backend), and opens
80/443 on the OS firewall.

Verify:
```bash
curl -s http://localhost/ping          # {"server":"ok",...}
journalctl -u quanthunt -f             # service logs
```
Then open `http://YOUR_VM_IP` in a browser — the screener loads and, from Mumbai,
populates with live data.

## 4. Push-to-deploy (so every change ships automatically)
### a. A deploy SSH key
```bash
ssh-keygen -t ed25519 -f ~/deploy_key -N ""      # run anywhere
cat ~/deploy_key.pub >> ~/.ssh/authorized_keys    # append on the VM
```
Keep the **private** key (`~/deploy_key`) for the secret below.

### b. GitHub repo secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `VM_HOST` | your VM's host/IP |
| `VM_USER` | your VM user (`ubuntu` / `opc`) |
| `VM_SSH_KEY` | contents of the **private** deploy key |

Now every push to `main` runs `.github/workflows/deploy.yml`, which rsyncs the
app to `/opt/quanthunt`, installs any new deps, restarts gunicorn, and reloads
nginx — the site updates in ~1 min. (Adjust the trigger branch in the workflow if
you deploy from a different branch. You can also run it manually from the Actions
tab via **Run workflow**.)

## 5. HTTPS + a real domain (recommended if kept public)
1. Get a free subdomain at **duckdns.org** (or use your own domain) → point it at
   `YOUR_VM_IP`.
2. On the VM:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx   # or: sudo dnf install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourname.duckdns.org
   ```
   certbot edits the nginx site in place and auto-renews. Done.

---

## Optional: EODHD fundamentals (faster fundamental screening)
The screener's fundamental filters work out of the box using yfinance, but you can
plug in **EODHD** (https://eodhd.com) for fundamentals that load reliably from a
datacenter IP. On the VM:
```bash
echo "EODHD_API_KEY=your_key_here" >> /opt/quanthunt/.env
bash /opt/quanthunt/deploy/setup-vm.sh   # refreshes the systemd unit so it reads .env
```
(Re-running `setup-vm.sh` is idempotent; it reinstalls the unit — now with
`EnvironmentFile=-/opt/quanthunt/.env` — and restarts. After that first refresh,
a plain `sudo systemctl restart quanthunt` picks up later `.env` edits.) Deploys
never overwrite `.env`.
Without a key it uses yfinance. Either way, fundamentals are cached server-side for
7 days (`fund_cache.json`, survives restarts), so after the first warm-up the
`/fundamentals/bulk` screener path is effectively instant. Note: EODHD fundamentals
need a plan that includes the India (`.NSE`) Fundamentals feed.

## Replacing TaurEye on the SAME VM
If this VM currently runs TaurEye's static site and you want QuantHunt to take
over the domain:
1. Run `deploy/setup-vm.sh` — it already removes `/etc/nginx/conf.d/taureye.conf`
   and installs QuantHunt as the default `:80` server.
2. Disable TaurEye's nightly refresh cron: `crontab -e` and delete the
   `refresh.sh` line (QuantHunt needs no cron — it refreshes itself).
3. Point the same GitHub secrets at this repo, or copy them over.
QuantHunt now answers on the same IP/domain; re-run certbot if the domain changed.

## Notes on security
QuantHunt has **no login or API key** — anything reachable on the public
IP/domain is open. It only serves public market data, which is usually fine for
personal use, but to lock it down:
- Restrict the VCN ingress to your own IP instead of `0.0.0.0/0`, or
- Add Basic Auth at nginx (`auth_basic` + an htpasswd file) in front of the proxy.

## Alternative: Docker
If you'd rather run it in a container than as a systemd service, the repo also
ships a `Dockerfile` + `docker-compose.yml` (`docker compose up -d --build`,
serves gunicorn on :5000). Put the same nginx reverse-proxy in front of it. The
systemd path above is the closer match to TaurEye's server, so it's the default.

## ARM build note
All Python deps ship ARM64 wheels, so the venv builds on the Ampere shape. If a
`pip install` ever can't find a wheel, `sudo apt-get install -y build-essential
libffi-dev` (or the dnf equivalent) so it can compile from source.
