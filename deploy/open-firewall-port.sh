#!/usr/bin/env bash
# Open a port on the VM's HOST firewall, persistently.
#
# Oracle Cloud images ship a host firewall that permits almost nothing beyond
# 22. Port 80 was opened here at some point; 443 never was — which is why the
# domain loads over http and fails over https.
#
# This is separate from the cloud security list, which is configured in the
# Oracle console and already allows 443: an external probe against the VM gets
# an immediate connection refusal rather than a timeout, and a security list
# drops packets silently (timeout) instead of rejecting them.
#
# Usage:  sudo bash deploy/open-firewall-port.sh [port]      (default 443)
#
# Idempotent — safe to re-run.
set -euo pipefail

PORT="${1:-443}"
case "$PORT" in
  ''|*[!0-9]*) echo "FAIL: '$PORT' is not a port number"; exit 1 ;;
esac

# firewalld and raw iptables must not both manage the same rule — firewalld
# owns the chains when it is running, and a hand-inserted rule there is either
# ignored or wiped on its next reload. Pick whichever is actually in charge.
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  echo "==> firewalld is running"
  if sudo firewall-cmd --list-ports 2>/dev/null | tr ' ' '\n' | grep -qx "${PORT}/tcp"; then
    echo "    ${PORT}/tcp already open"
  else
    sudo firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null
    sudo firewall-cmd --reload >/dev/null
    echo "    opened ${PORT}/tcp (permanent, survives reboot)"
  fi
  sudo firewall-cmd --list-ports

elif command -v iptables >/dev/null 2>&1; then
  echo "==> using raw iptables"
  if sudo iptables -S INPUT 2>/dev/null | grep -qE -- "--dport ${PORT} -j ACCEPT"; then
    echo "    ${PORT}/tcp already accepted"
  else
    # Oracle's images end INPUT with a catch-all REJECT. Appending after it
    # would never match, so insert immediately before the first REJECT/DROP.
    n="$(sudo iptables -L INPUT --line-numbers -n 2>/dev/null \
         | awk '$2=="REJECT"||$2=="DROP"{print $1; exit}')"
    if [ -n "$n" ]; then
      sudo iptables -I INPUT "$n" -p tcp -m state --state NEW --dport "$PORT" -j ACCEPT
      echo "    inserted ACCEPT ${PORT}/tcp at INPUT rule $n (above the catch-all reject)"
    else
      sudo iptables -A INPUT -p tcp -m state --state NEW --dport "$PORT" -j ACCEPT
      echo "    appended ACCEPT ${PORT}/tcp to INPUT"
    fi
  fi

  # Without this the rule is lost on reboot and https dies with no code change
  # to explain it.
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save >/dev/null && echo "    persisted (netfilter-persistent)"
  elif [ -x /usr/libexec/iptables/iptables.init ]; then
    sudo /usr/libexec/iptables/iptables.init save >/dev/null && echo "    persisted (iptables.init)"
  elif sudo service iptables save >/dev/null 2>&1; then
    echo "    persisted (service iptables save)"
  else
    echo "    WARNING: could not persist the rule — it will be lost on reboot."
    echo "             Install iptables-services (dnf) or iptables-persistent (apt)."
  fi

else
  echo "==> no firewalld or iptables found; nothing to open on the host"
fi
