# Hosting QuantHunt on Oracle Cloud (Always-Free)

Goal: run QuantHunt 24/7 in the cloud so it works with your PC off, reachable
from any browser or phone.

**Region matters.** Create the VM in **India South (Mumbai)**. QuantHunt pulls
live data from NSE and yfinance; those sources are reliably reachable from a
Mumbai datacenter IP but may be throttled or blocked from other regions. (This
is the same reason the screener showed 0 symbols when run inside a restricted
sandbox — the data hosts were unreachable, not the app.)

Unlike a database-backed app, QuantHunt is **stateless**: it fetches data on
demand and caches it in memory for 6 hours. There is nothing to upload or keep
in sync — you just run the container.

You do steps 1–2 (Oracle account / VM — I can't). Everything after is copy-paste.

---

## 1. Create the VM (one-time)
1. Sign up at cloud.oracle.com → set **Home region = India South (Mumbai)**.
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 22.04**
   - Shape: **Ampere (Arm) — VM.Standard.A1.Flex**, e.g. 1–2 OCPU / 6–12 GB
     (Always-Free covers up to 4 OCPU / 24 GB total).
   - Add your SSH public key (keep the private key safe).
3. After it boots, note the **Public IP**.

## 2. Open port 5000 (BOTH layers — Oracle blocks ports twice)
- **Cloud firewall:** Networking → your VCN → Security List → add an **Ingress**
  rule: Source `0.0.0.0/0`, IP Protocol TCP, destination port **5000**.
- **Instance firewall (Ubuntu images block it too):** SSH in, then:
  ```bash
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5000 -j ACCEPT
  sudo netfilter-persistent save
  ```

## 3. Install Docker (on the VM)
```bash
ssh ubuntu@YOUR_VM_IP
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

## 4. Get the code and start it (on the VM)
```bash
git clone https://github.com/alexOutcastX/QUANTHUNT_Prototype.git
cd QUANTHUNT_Prototype
docker compose up -d --build
```
The first build takes a few minutes (it compiles the Python deps for ARM).

Test it:
```bash
curl http://localhost:5000/ping
```
should return `{"server": "ok", ...}`. From your phone/browser, open
`http://YOUR_VM_IP:5000` — the screener UI loads and, from Mumbai, populates with
live data.

## 5. Updating later
When you push new code to the repo:
```bash
cd QUANTHUNT_Prototype
git pull
docker compose up -d --build
```
No nightly cron is needed — the app refreshes its own data every 6 hours (and on
each request after the cache expires).

---

## Optional: HTTPS + a real domain (recommended if kept public long-term)
Plain HTTP on `:5000` works, but for TLS and a nice URL:
1. Get a free subdomain at **duckdns.org** pointing to `YOUR_VM_IP`.
2. Put **Caddy** (automatic Let's Encrypt certs) in front of the app as a reverse
   proxy to `localhost:5000`. Ask and I'll add a `caddy` service to the compose
   file plus a Caddyfile.

## Notes on security
QuantHunt has **no login or API key** — anything on the public IP is open to
whoever finds it. The data it serves is public market data, so for personal use
this is usually acceptable, but be aware:
- The `/api/analyze` and data endpoints are callable by anyone who reaches the port.
- If you want to lock it down, the simplest option is Basic Auth at a Caddy/nginx
  reverse proxy in front of the container (ask and I'll wire it up), or restrict
  the Security List ingress to your own IP instead of `0.0.0.0/0`.

## ARM build note
The image builds on the Ampere (Arm) shape because all dependencies ship ARM64
wheels. If a `pip install` ever fails to find a wheel, add `build-essential
libffi-dev` to the Dockerfile's `apt-get install` line so it can compile from
source.
