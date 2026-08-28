#!/usr/bin/env bash
set -euo pipefail
if [ "${EUID}" -ne 0 ]; then echo "sudo ile calistir: sudo bash install_coturn.sh"; exit 1; fi
TURN_USER="${TURN_USER:-hakkariroll}"
TURN_PASS="${TURN_PASS:-$(openssl rand -base64 24 | tr -d '\n')}"
TURN_REALM="${TURN_REALM:-turn.hakkariroll.local}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -4 -fsS https://api.ipify.org || true)}"
if [ -z "$PUBLIC_IP" ]; then echo "PUBLIC_IP bulunamadi. Ornek: sudo PUBLIC_IP=1.2.3.4 bash install_coturn.sh"; exit 1; fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn curl openssl
cat >/etc/turnserver.conf <<EOF
listening-port=3478
fingerprint
lt-cred-mech
realm=${TURN_REALM}
server-name=${TURN_REALM}
user=${TURN_USER}:${TURN_PASS}
external-ip=${PUBLIC_IP}
min-port=49152
max-port=65535
stale-nonce=600
no-multicast-peers
no-cli
no-tls
no-dtls
log-file=/var/log/turnserver.log
simple-log
EOF
if [ -f /etc/default/coturn ]; then sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn || true; fi
systemctl enable coturn
systemctl restart coturn
cat <<EOF

HAKKARI ROLL TURN HAZIR
PUBLIC IP : ${PUBLIC_IP}
USERNAME  : ${TURN_USER}
PASSWORD  : ${TURN_PASS}

Oracle Security List / NSG'de ac:
- UDP 3478
- TCP 3478
- UDP 49152-65535

Railway Variables:
HAKKARI_ROLL_TURN_URL=turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp
HAKKARI_ROLL_TURN_USERNAME=${TURN_USER}
HAKKARI_ROLL_TURN_PASSWORD=${TURN_PASS}
HAKKARI_ROLL_TURN_SELF_HOSTED=true
EOF
