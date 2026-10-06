#!/usr/bin/env bash
# সাইট বন্ধ না করে পুরনো VPS থেকে নতুন VPS-এ সরানোর স্ক্রিপ্ট (পরের বারের জন্য)।
# সব কমান্ড নতুন VPS-এ root হিসেবে চালাতে হবে।
#
#   ০. bash zero-downtime-migrate.sh prepare-source
#        শুধু একবার, মাইগ্রেশনের কয়েকদিন আগে, কম ভিড়ের সময়ে চালাবেন।
#        পুরনো ডাটাবেসে logical replication চালু করে। এর জন্য পুরনো postgres
#        একবার রিস্টার্ট হয়, তাই ২-৩ সেকেন্ড ডাটাবেস বন্ধ থাকে।
#   ১. bash zero-downtime-migrate.sh prepare
#        নতুন VPS পুরোপুরি তৈরি করে: Docker, কোড, secrets, SSL, build।
#        পুরনো ডাটাবেস থেকে নতুনে লাইভ replication চালু করে, তাই প্রতিটা নতুন
#        অর্ডার সাথে সাথে কপি হতে থাকে। ছবি প্রতি মিনিটে সিঙ্ক হয়।
#        পুরনো সাইট আগের মতোই চলতে থাকে। এরপর যতদিন খুশি টেস্ট করুন।
#   ২. bash zero-downtime-migrate.sh status
#        replication কতটা পিছিয়ে আছে আর দুই সার্ভারে অর্ডার সংখ্যা দেখায়।
#   ৩. bash zero-downtime-migrate.sh cutover
#        আসল বদল, ১০ সেকেন্ডের মতো লাগে:
#          - পুরনো সার্ভারে আসা সব ট্রাফিক নতুন সার্ভারে পাঠানো শুরু করে
#            (কাস্টমার কোনো error দেখে না)
#          - replication পুরো মিলে গেলে সেটা বন্ধ করে, ফলে নতুন ডাটাবেস স্বাধীন হয়ে যায়
#          - CF_API_TOKEN আর CF_ZONE_ID দেওয়া থাকলে Cloudflare-এর DNS-ও নিজে বদলে দেয়
#
# পুরনো VPS-এ ঢোকার তথ্য env দিয়ে দেওয়া যায়: OLD_HOST, OLD_PORT (22), OLD_USER (root)।
# না দিলে স্ক্রিপ্ট জিজ্ঞেস করবে। পুরনো VPS-এ SSH key দিয়ে ঢোকা লাগবে:
# prepare চালানোর সময় দরকার হলে ssh-copy-id একবার পাসওয়ার্ড চাইবে।
set -euo pipefail

MODE="${1:-}"
STATE_FILE=/root/.asifzone-zdm.env
TUNNEL_PORT=15432
DB=clothing_brand
PUB=asifzone_migrate
SUB=asifzone_migrate

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[সতর্কতা] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[ভুল] %s\033[0m\n' "$*" >&2; exit 1; }

case "$MODE" in prepare-source|prepare|status|cutover) ;; *)
  sed -n '2,30p' "$0"; exit 1;;
esac
[ "$(id -u)" -eq 0 ] || die "root হিসেবে চালান।"

# shellcheck disable=SC1090
[ -f "$STATE_FILE" ] && . "$STATE_FILE"
if [ -z "${OLD_HOST:-}" ]; then
  read -rp "পুরনো VPS-এর IP: " OLD_HOST
  read -rp "পুরনো VPS-এর SSH পোর্ট [22]: " OLD_PORT
  read -rp "পুরনো VPS-এর ইউজারনেম [root]: " OLD_USER
fi
OLD_PORT="${OLD_PORT:-22}"; OLD_USER="${OLD_USER:-root}"

mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f /root/.ssh/id_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/id_ed25519
SSH_OPTS=(-p "$OLD_PORT" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o BatchMode=yes)
old() { ssh "${SSH_OPTS[@]}" "$OLD_USER@$OLD_HOST" "$@"; }
if ! old true 2>/dev/null; then
  say "পুরনো VPS-এ এই সার্ভারের SSH key বসাচ্ছি (পুরনো VPS-এর পাসওয়ার্ড একবার চাইবে)"
  ssh-copy-id -p "$OLD_PORT" -o StrictHostKeyChecking=accept-new "$OLD_USER@$OLD_HOST" \
    || die "পুরনো VPS-এ ঢুকতে পারলাম না। পাসওয়ার্ড লগইন বন্ধ থাকলে /root/.ssh/id_ed25519.pub পুরনো VPS-এর /root/.ssh/authorized_keys-এ যোগ করুন।"
fi

old_container() { old "docker ps -aq --filter label=com.docker.compose.service=$1 | head -n1"; }
OLD_PG=$(old_container postgres); OLD_API=$(old_container api); OLD_NGINX=$(old_container nginx)
[ -n "$OLD_PG" ] || die "পুরনো VPS-এ postgres কন্টেইনার পাইনি।"
OLD_COMPOSE_DIR=$(old "docker inspect $OLD_PG --format '{{ index .Config.Labels \"com.docker.compose.project.working_dir\" }}'")
PROJECT=$(old "docker inspect $OLD_PG --format '{{ index .Config.Labels \"com.docker.compose.project\" }}'")
REPO_DIR=$(dirname "$OLD_COMPOSE_DIR"); COMPOSE_DIR="$REPO_DIR/docker"
printf 'OLD_HOST=%s\nOLD_PORT=%s\nOLD_USER=%s\n' "$OLD_HOST" "$OLD_PORT" "$OLD_USER" > "$STATE_FILE"

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_DIR/docker-compose.yml" --project-directory "$COMPOSE_DIR" "$@"; }
old_psql() { old "docker exec -i $OLD_PG psql -U postgres -d $DB -v ON_ERROR_STOP=1 -tA"; }
new_psql() { dc exec -T postgres psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -tA; }

# ---------------------------------------------------------------- ০. পুরনো ডাটাবেসে logical replication চালু
if [ "$MODE" = "prepare-source" ]; then
  level=$(echo 'SHOW wal_level;' | old_psql)
  if [ "$level" = "logical" ]; then say "পুরনো ডাটাবেসে logical replication আগেই চালু আছে — কিছু করার নেই"; exit 0; fi
  warn "পুরনো postgres রিস্টার্ট হবে — ২-৩ সেকেন্ড ডাটাবেস বন্ধ থাকবে। কম ভিড়ের সময় চালান।"
  read -rp "চালিয়ে যাব? (y/n): " ans; [ "${ans,,}" = "y" ] || exit 0
  printf '%s\n' "ALTER SYSTEM SET wal_level = 'logical';" "ALTER SYSTEM SET max_replication_slots = 10;" \
    "ALTER SYSTEM SET max_wal_senders = 10;" | old_psql >/dev/null
  old "docker restart $OLD_PG >/dev/null"
  sleep 5
  say "এখন wal_level = $(echo 'SHOW wal_level;' | old_psql)"
  exit 0
fi

# পুরনো postgres-এ পৌঁছানোর SSH টানেল। এটা নতুন সার্ভারের docker network gateway-তে বাঁধা থাকে,
# তাই শুধু নতুন সার্ভারের কন্টেইনারগুলো এটা ব্যবহার করতে পারে, ইন্টারনেট থেকে কেউ না।
ensure_tunnel() {
  local gw pg_ip
  gw=$(docker network inspect "${PROJECT}_default" -f '{{ (index .IPAM.Config 0).Gateway }}')
  pg_ip=$(old "docker inspect $OLD_PG -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'")
  cat > /etc/systemd/system/asifzone-db-tunnel.service <<EOF
[Unit]
Description=SSH tunnel to the old VPS's Postgres for zero-downtime migration
After=network-online.target docker.service

[Service]
ExecStart=/usr/bin/ssh -N -p $OLD_PORT -o BatchMode=yes -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -L $gw:$TUNNEL_PORT:$pg_ip:5432 $OLD_USER@$OLD_HOST
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now asifzone-db-tunnel >/dev/null 2>&1
  systemctl restart asifzone-db-tunnel
  sleep 3
  systemctl is-active --quiet asifzone-db-tunnel || die "ডাটাবেস টানেল চালু হলো না: journalctl -u asifzone-db-tunnel"
  TUNNEL_HOST=$gw
}

# পুরনো DB-র বর্তমান অবস্থান (বা $1-এ দেওয়া নির্দিষ্ট অবস্থান) থেকে নতুন DB কত bytes পিছিয়ে; <= 0 মানে পুরো মেলানো
replication_lag_bytes() {
  local src="${1:-}"
  [ -n "$src" ] || src=$(echo 'SELECT pg_current_wal_lsn();' | old_psql)
  printf "SELECT COALESCE(pg_wal_lsn_diff('%s', latest_end_lsn), -1)::bigint FROM pg_stat_subscription WHERE subname = '%s' AND relid IS NULL;\n" "$src" "$SUB" | new_psql
}

order_counts() {
  printf 'পুরনো: %s, নতুন: %s\n' \
    "$(echo 'SELECT count(*) FROM "Order";' | old_psql)" "$(echo 'SELECT count(*) FROM "Order";' | new_psql)"
}

# ---------------------------------------------------------------- ২. status
if [ "$MODE" = "status" ]; then
  say "অর্ডার সংখ্যা — $(order_counts)"
  say "Replication কতটা পিছিয়ে (bytes, 0 মানে পুরো মেলানো): $(replication_lag_bytes)"
  exit 0
fi

# ---------------------------------------------------------------- ১. prepare
if [ "$MODE" = "prepare" ]; then
  [ "$(echo 'SHOW wal_level;' | old_psql)" = "logical" ] \
    || die "পুরনো ডাটাবেসে logical replication চালু নেই। আগে কম ভিড়ের সময়ে চালান: bash $0 prepare-source"

  say "নতুন VPS প্রস্তুত করছি (Docker, swap)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null
  apt-get install -y curl ca-certificates git rsync cron >/dev/null
  command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker cron >/dev/null 2>&1 || true
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem_mb" -lt 4000 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  for svc in apache2 nginx httpd caddy; do systemctl disable --now "$svc" >/dev/null 2>&1 || true; done
  old "command -v rsync >/dev/null || (apt-get install -y rsync >/dev/null 2>&1 || yum install -y rsync >/dev/null 2>&1)"

  say "পুরনো VPS থেকে হুবহু কোড আর docker/.env কপি করছি ($REPO_DIR)"
  mkdir -p "$REPO_DIR"
  rsync -a --delete -e "ssh ${SSH_OPTS[*]}" \
    --exclude node_modules --exclude .next --exclude .turbo --exclude dist \
    "$OLD_USER@$OLD_HOST:$REPO_DIR/" "$REPO_DIR/"
  chmod 600 "$COMPOSE_DIR/.env"

  say "SSL সার্টিফিকেট কপি করছি"
  docker volume create "${PROJECT}_certbot_certs" >/dev/null
  old "docker run --rm --volumes-from $OLD_NGINX alpine tar czf - -C /etc/letsencrypt ." \
    | docker run --rm -i -v "${PROJECT}_certbot_certs:/c" alpine tar xzf - -C /c

  say "build করছি (১০-২০ মিনিট লাগতে পারে)"
  dc build
  dc up --no-start
  dc up -d postgres redis
  until dc exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

  say "ডাটাবেসের কাঠামো (খালি টেবিল) বসাচ্ছি"
  echo "SELECT 1 FROM pg_subscription WHERE subname = '$SUB';" | new_psql | grep -q 1 \
    && echo "DROP SUBSCRIPTION $SUB;" | new_psql >/dev/null
  dc exec -T postgres dropdb -U postgres --if-exists --force "$DB"
  dc exec -T postgres createdb -U postgres "$DB"
  old "docker exec $OLD_PG pg_dump -U postgres --schema-only --no-owner $DB" | new_psql >/dev/null

  say "লাইভ replication চালু করছি (পুরনো -> নতুন)"
  ensure_tunnel
  pg_pass=$(grep -E '^POSTGRES_PASSWORD=' "$COMPOSE_DIR/.env" | cut -d= -f2-)
  printf "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = '%s') THEN CREATE PUBLICATION %s FOR ALL TABLES; END IF; END \$\$;\n" "$PUB" "$PUB" | old_psql >/dev/null
  # আগের কোনো ব্যর্থ চেষ্টার পুরনো slot থাকলে মুছে ফেলা
  echo "SELECT pg_drop_replication_slot('$SUB') FROM pg_replication_slots WHERE slot_name = '$SUB' AND NOT active;" | old_psql >/dev/null
  printf "CREATE SUBSCRIPTION %s CONNECTION 'host=%s port=%s user=postgres password=%s dbname=%s' PUBLICATION %s;\n" \
    "$SUB" "$TUNNEL_HOST" "$TUNNEL_PORT" "$pg_pass" "$DB" "$PUB" | new_psql >/dev/null

  say "প্রথম পূর্ণ কপি শেষ হওয়ার অপেক্ষা করছি"
  until [ "$(echo "SELECT count(*) FROM pg_subscription_rel WHERE srsubstate <> 'r';" | new_psql)" = "0" ]; do sleep 5; done
  say "ডাটা কপি শেষ — $(order_counts)"

  say "ছবি সিঙ্ক করছি (এরপর প্রতি মিনিটে নিজে নিজে হবে)"
  sync_cmd="ssh ${SSH_OPTS[*]} $OLD_USER@$OLD_HOST 'docker run --rm --volumes-from $OLD_API alpine tar czf - -C /repo/apps/api/uploads .' | docker run --rm -i -v ${PROJECT}_uploads_data:/u alpine tar xzf - -C /u"
  printf '#!/usr/bin/env bash\nset -euo pipefail\n%s\n' "$sync_cmd" > /usr/local/bin/asifzone-uploads-sync
  chmod +x /usr/local/bin/asifzone-uploads-sync
  /usr/local/bin/asifzone-uploads-sync
  ( crontab -l 2>/dev/null | grep -v asifzone-uploads-sync || true
    echo "* * * * * flock -n /tmp/asifzone-uploads-sync.lock /usr/local/bin/asifzone-uploads-sync >/dev/null 2>&1"
  ) | crontab -

  say "নতুন সাইট চালু করছি"
  dc up -d
  dc restart nginx
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve asifzone.com:443:127.0.0.1 https://asifzone.com/ || true)
  ip=$(curl -4 -s https://api.ipify.org || true)
  cat <<EOF

=====================================================================
 নতুন VPS তৈরি (টেস্ট: HTTP $code)। পুরনো সাইট আগের মতোই চলছে, আর
 প্রতিটা নতুন অর্ডার সাথে সাথে এখানে কপি হচ্ছে।

 নিজের কম্পিউটার থেকে নতুন সার্ভার টেস্ট করতে Windows-এর
 C:\\Windows\\System32\\drivers\\etc\\hosts ফাইলে যোগ করুন:
     $ip  asifzone.com
 টেস্ট শেষে লাইনটা মুছে দেবেন।
 সতর্কতা: টেস্টে নতুন সার্ভারে অর্ডার দিলে সেটা শুধু নতুন সার্ভারেই থাকবে।

 প্রস্তুত হলে:  bash $0 cutover
=====================================================================
EOF
  exit 0
fi

# ---------------------------------------------------------------- ৩. cutover
if [ "$MODE" = "cutover" ]; then
  echo "SELECT 1 FROM pg_subscription WHERE subname = '$SUB';" | new_psql | grep -q 1 \
    || die "replication চালু নেই — আগে prepare চালান।"
  lag=$(replication_lag_bytes)
  [ "$lag" -ge 0 ] && [ "$lag" -lt 10000000 ] || die "replication অনেক পিছিয়ে ($lag bytes) — status দেখে পরে চেষ্টা করুন।"
  new_ip=$(curl -4 -s https://api.ipify.org)

  say "১/৪ পুরনো সার্ভারের ট্রাফিক নতুন সার্ভারে পাঠানো শুরু ($new_ip)"
  old "docker pull -q alpine/socat >/dev/null
       docker stop $OLD_NGINX >/dev/null; docker update --restart=no $OLD_NGINX >/dev/null
       for p in 80 443; do
         docker rm -f asifzone-forward-\$p >/dev/null 2>&1 || true
         docker run -d --name asifzone-forward-\$p --restart unless-stopped -p \$p:\$p \
           alpine/socat tcp-listen:\$p,fork,reuseaddr tcp:$new_ip:\$p >/dev/null
       done"

  say "২/৪ শেষ লেনদেনগুলো কপি হওয়ার অপেক্ষা"
  # পুরনো api-তে চলমান রিকোয়েস্ট শেষ হতে কয়েক সেকেন্ড সময় দিয়ে তারপর বন্ধ, যাতে আর কিছু পুরনো DB-তে না লেখে
  old "docker stop -t 10 $OLD_API >/dev/null" || true
  target=$(echo 'SELECT pg_current_wal_lsn();' | old_psql)
  for _ in $(seq 1 60); do
    lag=$(replication_lag_bytes "$target")
    [ "$lag" -le 0 ] && break
    sleep 1
  done
  [ "$lag" -le 0 ] || warn "replication পুরো মেলেনি (lag $lag) — status দিয়ে অর্ডার সংখ্যা মিলিয়ে নিন।"
  say "অর্ডার সংখ্যা — $(order_counts)"

  say "৩/৪ replication বন্ধ — নতুন ডাটাবেস এখন স্বাধীন"
  echo "DROP SUBSCRIPTION $SUB;" | new_psql >/dev/null
  echo "DROP PUBLICATION IF EXISTS $PUB;" | old_psql >/dev/null || true
  systemctl disable --now asifzone-db-tunnel >/dev/null 2>&1 || true
  /usr/local/bin/asifzone-uploads-sync || warn "শেষবার ছবি সিঙ্ক ব্যর্থ"
  ( crontab -l 2>/dev/null | grep -v asifzone-uploads-sync || true
    echo "0 2 * * * cd $COMPOSE_DIR && ./backup.sh >> /var/log/clothing-brand-backup.log 2>&1"
  ) | awk '!seen[$0]++' | crontab -
  dc restart api web nginx

  say "৪/৪ DNS"
  if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_ZONE_ID:-}" ]; then
    for name in asifzone.com www.asifzone.com; do
      rec=$(curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=A&name=$name" \
        | sed -n 's/.*"id":"\([0-9a-f]\{32\}\)".*/\1/p' | head -n1)
      [ -n "$rec" ] || { warn "Cloudflare-এ $name-এর A রেকর্ড পাইনি — নিজে বদলান"; continue; }
      curl -s -X PATCH -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' \
        --data "{\"content\":\"$new_ip\"}" \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$rec" | grep -q '"success":true' \
        && echo "$name -> $new_ip (Cloudflare-এ বদলানো হয়েছে)" || warn "$name বদলাতে পারিনি — নিজে বদলান"
    done
  else
    echo "DNS-এ asifzone.com আর www-এর A রেকর্ড $new_ip করে দিন।"
  fi
  cat <<EOF

=====================================================================
 সার্ভার বদল শেষ! পুরনো সার্ভার এখন শুধু ট্রাফিক নতুন সার্ভারে পাঠাচ্ছে।
 DNS বদলের ১-২ দিন পর পুরনো VPS বন্ধ করে দিতে পারেন।
 শেষে GitHub-এর VPS_HOST secret-এ নতুন IP ($new_ip) বসাতে ভুলবেন না।
=====================================================================
EOF
fi
