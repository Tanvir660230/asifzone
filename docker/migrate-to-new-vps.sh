#!/usr/bin/env bash
# পুরনো VPS থেকে নতুন VPS-এ পুরো সাইট সরানোর স্ক্রিপ্ট।
#
# নতুন VPS-এ root হিসেবে চালাতে হবে (পুরনোটায় না):
#   ssh root@<নতুন-VPS-IP>
#   curl -fsSL https://raw.githubusercontent.com/Tanvir660230/asifzone/claude/charming-gauss-e26lar/docker/migrate-to-new-vps.sh -o migrate.sh
#   bash migrate.sh
#
# যা যা করে:
#   1. নতুন VPS-এ Docker install করে (না থাকলে), দরকার হলে swap যোগ করে
#   2. পুরনো VPS-এ একবার পাসওয়ার্ড দিয়ে SSH করে, যে ফোল্ডারে সাইট চলছে সেটা খুঁজে বের করে
#   3. ঠিক সেই কোড + docker/.env (সব secret) নতুন VPS-এ একই জায়গায় কপি করে
#   4. ডাটাবেস (pg_dump), আপলোড করা ছবি, SSL সার্টিফিকেট কপি করে
#   5. নতুন VPS-এ build করে চালু করে, টেস্ট করে, রাতের অটো-ব্যাকআপ cron বসায়
#   6. শেষে "ফাইনাল সিঙ্ক": পুরনো সাইট বন্ধ করে সর্বশেষ অর্ডার/ডাটা আবার কপি করে,
#      যাতে DNS বদলানোর সময় একটা অর্ডারও না হারায়
#
# শুধু ফাইনাল সিঙ্ক আবার চালাতে:  bash migrate.sh sync
#
# পুরনো সার্ভারে কিছুই মোছে না — শুধু পড়ে, আর ফাইনাল সিঙ্কে api/web কন্টেইনার stop করে।
set -euo pipefail

MODE="${1:-full}"
STATE_FILE=/root/.asifzone-migrate.env
BACKUP_DIR=/root/asifzone-migration-backup
SOCK=/root/.ssh/asifzone-old-%r@%h:%p

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[সতর্কতা] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[ভুল] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root হিসেবে চালান (ssh root@... দিয়ে ঢুকে)।"
mkdir -p /root/.ssh "$BACKUP_DIR"
chmod 700 /root/.ssh

# ---------------------------------------------------------------- পুরনো সার্ভারের তথ্য
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
fi
# MODE=auto (GitHub Actions থেকে): OLD_HOST/OLD_PORT/OLD_USER আর পাসওয়ার্ড SSHPASS env-এ আসে,
# কিছু জিজ্ঞেস করে না, আর সাইট টেস্ট পাস করলে নিজেই ফাইনাল সিঙ্ক করে।
if [ -f /root/.asifzone-migrate.secrets ]; then
  # shellcheck disable=SC1091
  . /root/.asifzone-migrate.secrets
  rm -f /root/.asifzone-migrate.secrets
fi
if [ -z "${OLD_HOST:-}" ]; then
  [ "$MODE" = "auto" ] && die "auto মোডে OLD_HOST দেওয়া হয়নি।"
  read -rp "পুরনো VPS-এর IP address: " OLD_HOST
  read -rp "পুরনো VPS-এর SSH পোর্ট [22]: " OLD_PORT
  read -rp "পুরনো VPS-এর ইউজারনেম [root]: " OLD_USER
fi
OLD_PORT="${OLD_PORT:-22}"
OLD_USER="${OLD_USER:-root}"
[ -n "$OLD_HOST" ] || die "পুরনো VPS-এর IP দিতে হবে।"

SSH_OPTS=(-p "$OLD_PORT" -o ControlPath="$SOCK" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
# পুরনো VPS-এ পাসওয়ার্ড লগইন বন্ধ থাকলে SSH key দিয়ে ঢোকা (GitHub-এর VPS_SSH_KEY secret থেকে আসে)
OLD_KEY_FILE=/root/.ssh/asifzone-old-key
[ -s "$OLD_KEY_FILE" ] && SSH_OPTS+=(-i "$OLD_KEY_FILE")
old() { ssh "${SSH_OPTS[@]}" "$OLD_USER@$OLD_HOST" "$@"; }

if ! ssh "${SSH_OPTS[@]}" -O check "$OLD_USER@$OLD_HOST" 2>/dev/null; then
  say "পুরনো VPS ($OLD_HOST)-এ লগইন করছি — পাসওয়ার্ড চাইলে পুরনো VPS-এর পাসওয়ার্ড দিন (শুধু একবার লাগবে)"
  SSH_PREFIX=()
  if [ -n "${SSHPASS:-}" ]; then
    command -v sshpass >/dev/null || { apt-get update -y >/dev/null; apt-get install -y sshpass >/dev/null; }
    SSH_PREFIX=(sshpass -e)
  fi
  "${SSH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" -o ControlMaster=yes -o ControlPersist=3h -fN "$OLD_USER@$OLD_HOST" \
    || die "পুরনো VPS-এ ঢুকতে পারলাম না। IP/পোর্ট/পাসওয়ার্ড ঠিক আছে কিনা দেখুন।"
fi

# পুরনো সার্ভারের কোন কন্টেইনার কোনটা, আর কোড কোন ফোল্ডারে — Docker Compose-এর label থেকে বের করা
old_container() {
  old "docker ps -aq --filter label=com.docker.compose.service=$1 | head -n1"
}
OLD_PG=$(old_container postgres)
OLD_API=$(old_container api)
OLD_WEB=$(old_container web)
OLD_NGINX=$(old_container nginx)
[ -n "$OLD_PG" ] || die "পুরনো VPS-এ চালু postgres কন্টেইনার পেলাম না। সাইট কি সত্যিই এই সার্ভারে Docker-এ চলছে?"
OLD_COMPOSE_DIR=$(old "docker inspect $OLD_PG --format '{{ index .Config.Labels \"com.docker.compose.project.working_dir\" }}'")
PROJECT=$(old "docker inspect $OLD_PG --format '{{ index .Config.Labels \"com.docker.compose.project\" }}'")
[ -n "$OLD_COMPOSE_DIR" ] || die "পুরনো VPS-এ সাইটের ফোল্ডার খুঁজে পেলাম না।"
REPO_DIR=$(dirname "$OLD_COMPOSE_DIR")
COMPOSE_DIR="$REPO_DIR/docker"
cat > "$STATE_FILE" <<EOF
OLD_HOST=$OLD_HOST
OLD_PORT=$OLD_PORT
OLD_USER=$OLD_USER
EOF
say "পুরনো সাইট পাওয়া গেছে: $OLD_COMPOSE_DIR (project: $PROJECT)"

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_DIR/docker-compose.yml" --project-directory "$COMPOSE_DIR" "$@"; }

wait_for_postgres() {
  for _ in $(seq 1 60); do
    dc exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "নতুন VPS-এ postgres চালু হলো না।"
}

# ডাটাবেস + আপলোড করা ছবি পুরনো থেকে নতুনে কপি (দুই মোডেই লাগে)
copy_data() {
  local ts; ts=$(date +%Y%m%d-%H%M%S)
  say "পুরনো VPS থেকে ডাটাবেস কপি করছি"
  old "docker exec $OLD_PG pg_dump -U postgres -Fc clothing_brand" > "$BACKUP_DIR/db-$ts.dump"
  [ -s "$BACKUP_DIR/db-$ts.dump" ] || die "ডাটাবেস dump খালি এসেছে।"

  say "পুরনো VPS থেকে আপলোড করা ছবি কপি করছি"
  if [ -n "$OLD_API" ]; then
    # --volumes-from instead of docker exec: works even after final_sync has stopped the api container
    old "docker run --rm --volumes-from $OLD_API alpine tar czf - -C /repo/apps/api/uploads ." > "$BACKUP_DIR/uploads-$ts.tar.gz"
  else
    old "docker run --rm -v ${PROJECT}_uploads_data:/u alpine tar czf - -C /u ." > "$BACKUP_DIR/uploads-$ts.tar.gz"
  fi

  say "নতুন VPS-এ ডাটাবেস বসাচ্ছি"
  dc stop api web >/dev/null 2>&1 || true
  dc up -d postgres redis
  wait_for_postgres
  dc exec -T postgres dropdb -U postgres --if-exists --force clothing_brand
  dc exec -T postgres createdb -U postgres clothing_brand
  dc exec -T postgres pg_restore -U postgres -d clothing_brand --no-owner < "$BACKUP_DIR/db-$ts.dump"

  say "নতুন VPS-এ ছবি বসাচ্ছি"
  docker run --rm -i -v "${PROJECT}_uploads_data:/u" alpine \
    sh -c 'find /u -mindepth 1 -delete; tar xzf - -C /u' < "$BACKUP_DIR/uploads-$ts.tar.gz"

  local orders
  orders=$(dc exec -T postgres psql -U postgres -d clothing_brand -tAc 'SELECT count(*) FROM "Order"' 2>/dev/null || echo "?")
  say "ডাটা কপি শেষ — নতুন VPS-এ মোট অর্ডার: $orders (ব্যাকআপ রাখা আছে: $BACKUP_DIR)"
}

check_site() {
  local code=000
  for _ in $(seq 1 40); do
    code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve asifzone.com:443:127.0.0.1 https://asifzone.com/ || true)
    [ "$code" = "200" ] && break
    sleep 5
  done
  if [ "$code" = "200" ]; then
    say "নতুন VPS-এ সাইট ঠিকমতো চলছে (HTTP 200)"
  else
    warn "সাইট এখনো 200 দিচ্ছে না (HTTP $code)। লগ দেখুন: docker compose -p $PROJECT -f $COMPOSE_DIR/docker-compose.yml logs --tail=50"
    return 1
  fi
}

final_sync() {
  say "ফাইনাল সিঙ্ক: পুরনো সাইটের api/web বন্ধ করছি যাতে নতুন অর্ডার না আসে (কয়েক মিনিটের জন্য সাইট বন্ধ থাকবে)"
  old "docker stop ${OLD_API} ${OLD_WEB}" >/dev/null || true
  copy_data
  dc up -d
  # api/web পুনরায় তৈরি হলে নতুন IP পায়, কিন্তু nginx শুরুতে পাওয়া পুরনো IP ধরে রাখে -> 502।
  dc restart nginx
  check_site || true
  local ip; ip=$(curl -4 -s https://api.ipify.org || hostname -I | awk '{print $1}')
  cat <<EOF

=====================================================================
 সব কাজ শেষ! এখনই DNS বদলান:
   asifzone.com      A রেকর্ড  ->  $ip
   www.asifzone.com  A রেকর্ড  ->  $ip
 Cloudflare হলে "Proxied" (কমলা মেঘ) যেমন ছিল তেমনই রাখুন।

 পুরনো সাইটের api/web এখন বন্ধ। কোনো কারণে আবার চালু করতে চাইলে
 পুরনো VPS-এ:  docker start ${OLD_API} ${OLD_WEB}
=====================================================================
EOF
}

if [ "$MODE" = "fix" ]; then
  say "nginx রিস্টার্ট করে অবস্থা দেখছি"
  dc up -d
  dc restart nginx
  dc ps
  for path in / /products /api/health; do
    printf '%s -> ' "$path"
    curl -sk -o /dev/null -w '%{http_code}\n' -H 'Cache-Control: no-cache' --resolve asifzone.com:443:127.0.0.1 "https://asifzone.com$path?nocache=$RANDOM" || true
  done
  dc logs --tail=40 web api nginx 2>&1 | grep -viE 'password|secret|token' || true
  check_site
  exit 0
fi

# DNS বদলের পরও যাদের কম্পিউটার/ISP পুরনো IP মনে রেখেছে, তারা পুরনো সার্ভারে গিয়ে 502 পায়।
# পুরনো সার্ভারের nginx বন্ধ করে 80/443 পোর্টের সব ট্রাফিক নতুন VPS-এ পাঠিয়ে দেওয়া হয়।
if [ "$MODE" = "forward" ]; then
  new_ip=$(curl -4 -s https://api.ipify.org || hostname -I | awk '{print $1}')
  say "পুরনো সার্ভারের ট্রাফিক নতুন VPS ($new_ip)-এ পাঠানোর ব্যবস্থা করছি"
  old "docker stop $OLD_NGINX >/dev/null; docker update --restart=no $OLD_NGINX >/dev/null;
       for p in 80 443; do
         docker rm -f asifzone-forward-\$p >/dev/null 2>&1 || true
         docker run -d --name asifzone-forward-\$p --restart unless-stopped -p \$p:\$p \
           alpine/socat tcp-listen:\$p,fork,reuseaddr tcp:$new_ip:\$p >/dev/null
       done
       docker ps --format '{{.Names}} {{.Status}}' | grep -E 'forward|nginx' || true"
  sleep 3
  for host in 127.0.0.1 "$OLD_HOST"; do
    printf 'via %s -> ' "$host"
    curl -sk -o /dev/null -w '%{http_code}\n' --resolve "asifzone.com:443:$host" https://asifzone.com/ || true
  done
  exit 0
fi

# পুরনো আর নতুন সার্ভারের ডাটা মিলিয়ে দেখা (শুধু পড়ে, কিছু বদলায় না)
if [ "$MODE" = "verify" ]; then
  count_sql="SELECT string_agg(t || '=' || n, E'\\n' ORDER BY t) FROM (
    SELECT relname AS t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', relname), false, true, '')))[1]::text AS n
    FROM pg_stat_user_tables WHERE schemaname = 'public') x"
  printf '%s;\n' "$count_sql" | old "docker exec -i $OLD_PG psql -U postgres -d clothing_brand -tA" > /tmp/old-counts.txt
  printf '%s;\n' "$count_sql" | dc exec -T postgres psql -U postgres -d clothing_brand -tA > /tmp/new-counts.txt
  say "টেবিল অনুযায়ী রো সংখ্যা (পুরনো -> নতুন)"
  join -t= -a1 -a2 -e MISSING -o 0,1.2,2.2 <(sort /tmp/old-counts.txt) <(sort /tmp/new-counts.txt) \
    | awk -F= '{ flag = ($2 == $3) ? "ঠিক আছে" : (($3+0 > $2+0) ? "নতুন বেশি (নতুন ডাটা এসেছে)" : "*** কম ***"); printf "%-40s %8s -> %-8s %s\n", $1, $2, $3, flag }'
  old_files=$(old "docker run --rm --volumes-from $OLD_API alpine sh -c 'find /repo/apps/api/uploads -type f | wc -l'")
  new_files=$(docker run --rm -v "${PROJECT}_uploads_data:/u" alpine sh -c 'find /u -type f | wc -l')
  say "আপলোড করা ফাইল: পুরনো $old_files -> নতুন $new_files"
  say "সর্বশেষ ৫টা অর্ডার (নতুন সার্ভারে)"
  dc exec -T postgres psql -U postgres -d clothing_brand -c 'SELECT "createdAt", status FROM "Order" ORDER BY "createdAt" DESC LIMIT 5' || true
  exit 0
fi

# মাইগ্রেশনের সময়ে অর্ডার দেওয়ার চেষ্টাগুলো খোঁজা (শুধু লগ পড়ে, কিছু বদলায় না)
if [ "$MODE" = "orders" ]; then
  pat='POST /api/(orders|checkout)[^ ]* '
  say "পুরনো সার্ভারের nginx লগে আজকের অর্ডার রিকোয়েস্ট"
  old "docker logs --since 6h $OLD_NGINX 2>&1" | grep -E "$pat" | awk '{print $4, $6, $7, $9}' || echo "(কিছু নেই)"
  say "নতুন সার্ভারের nginx লগে অর্ডার রিকোয়েস্ট"
  dc logs --no-log-prefix --since 6h nginx 2>&1 | grep -E "$pat" | awk '{print $4, $6, $7, $9}' || echo "(কিছু নেই)"
  say "নতুন সার্ভারের api লগে অর্ডার সংক্রান্ত error"
  dc logs --no-log-prefix --since 6h api 2>&1 | grep -iE 'order' | grep -iE 'error|fail' | tail -n 20 || echo "(কিছু নেই)"
  say "সর্বশেষ ৫টা অর্ডার (নতুন সার্ভারে, বাংলাদেশ সময়)"
  dc exec -T postgres psql -U postgres -d clothing_brand -c 'SELECT "orderNumber", ("createdAt" + interval '"'"'6 hours'"'"') AS bd_time, status FROM "Order" ORDER BY "createdAt" DESC LIMIT 5' || true
  exit 0
fi

if [ "$MODE" = "sync" ]; then
  [ -f "$COMPOSE_DIR/docker-compose.yml" ] || die "আগে পুরো মাইগ্রেশন (bash migrate.sh) চালান।"
  final_sync
  exit 0
fi

# ---------------------------------------------------------------- ১. নতুন VPS প্রস্তুত
say "নতুন VPS প্রস্তুত করছি (প্যাকেজ, Docker)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates git tar gzip cron >/dev/null
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker cron >/dev/null 2>&1 || true

# Next.js build কম RAM-এ আটকে যায় — 4GB-এর কম RAM আর swap না থাকলে 4GB swap যোগ
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 4000 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
  say "RAM কম (${mem_mb}MB) — 4GB swap যোগ করছি"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# অন্য কোনো ওয়েব সার্ভার 80/443 পোর্ট দখল করে থাকলে বন্ধ
for svc in apache2 nginx httpd caddy; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    warn "$svc চলছিল এবং 80/443 পোর্ট আটকাতে পারে — বন্ধ করছি"
    systemctl disable --now "$svc" >/dev/null 2>&1 || true
  fi
done
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# ---------------------------------------------------------------- ২. কোড + secrets
say "পুরনো VPS থেকে হুবহু কোড আর docker/.env কপি করছি ($REPO_DIR)"
if [ -d "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR" 2>/dev/null)" ]; then
  mv "$REPO_DIR" "${REPO_DIR}.before-migrate-$(date +%s)"
fi
mkdir -p "$REPO_DIR"
old "tar czf - -C '$REPO_DIR' --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=dist ." \
  | tar xzf - -C "$REPO_DIR"
[ -f "$COMPOSE_DIR/.env" ] || die "পুরনো VPS-এ docker/.env পাইনি — secrets ছাড়া সাইট চলবে না।"
chmod 600 "$COMPOSE_DIR/.env"

# ---------------------------------------------------------------- ৩. SSL সার্টিফিকেট
say "SSL সার্টিফিকেট কপি করছি"
docker volume create "${PROJECT}_certbot_certs" >/dev/null
if [ -n "$OLD_NGINX" ]; then
  old "docker exec $OLD_NGINX tar czf - -C /etc/letsencrypt ." \
    | docker run --rm -i -v "${PROJECT}_certbot_certs:/c" alpine tar xzf - -C /c
else
  old "docker run --rm -v ${PROJECT}_certbot_certs:/c alpine tar czf - -C /c ." \
    | docker run --rm -i -v "${PROJECT}_certbot_certs:/c" alpine tar xzf - -C /c
fi

# ---------------------------------------------------------------- ৪. build
say "সাইট build করছি — এতে ১০-২০ মিনিট লাগতে পারে, অপেক্ষা করুন"
dc build
dc up --no-start

# ---------------------------------------------------------------- ৫. ডাটা + চালু
copy_data
say "সব সার্ভিস চালু করছি"
dc up -d
dc exec -T api npx prisma migrate deploy || warn "prisma migrate deploy সফল হয়নি — উপরের লগ দেখুন"
SITE_OK=1
check_site || { SITE_OK=0; warn "সাইট টেস্ট পাস করেনি। ফাইনাল সিঙ্কের আগে ঠিক করা দরকার।"; }

# ---------------------------------------------------------------- ৬. রাতের ব্যাকআপ
chmod +x "$COMPOSE_DIR/backup.sh"
if [ "$PROJECT" != "docker" ] && ! grep -q '^COMPOSE_PROJECT_NAME=' "$COMPOSE_DIR/.env"; then
  echo "COMPOSE_PROJECT_NAME=$PROJECT" >> "$COMPOSE_DIR/.env"
fi
( crontab -l 2>/dev/null | grep -v 'docker/backup.sh' || true
  echo "0 2 * * * cd $COMPOSE_DIR && ./backup.sh >> /var/log/clothing-brand-backup.log 2>&1"
) | crontab -
say "রাত ২টার অটো-ব্যাকআপ cron বসানো হয়েছে"

if [ "$MODE" = "auto" ]; then
  if [ "$SITE_OK" = 1 ]; then
    final_sync
  else
    die "নতুন সাইট টেস্ট পাস করেনি, তাই পুরনো সাইট বন্ধ করিনি — পুরনো সাইট আগের মতোই চলছে।"
  fi
  exit 0
fi

echo
read -rp "ফাইনাল সিঙ্ক এখনই করব? এতে পুরনো সাইট কয়েক মিনিট বন্ধ থাকবে, তারপর আপনি DNS বদলাবেন। (y/n): " ans
if [ "${ans,,}" = "y" ]; then
  final_sync
else
  echo "ঠিক আছে। প্রস্তুত হলে চালান:  bash migrate.sh sync"
fi
