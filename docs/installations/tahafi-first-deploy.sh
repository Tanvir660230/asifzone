#!/usr/bin/env bash
# First deployment of Tahafi on the Asif Zone VPS, behind Asif Zone's nginx (docs/installations/tahafi.md,
# docs/STORE_DEPLOYMENT.md "Several installations on one VPS"). The third store on this box: Asif Zone's nginx already
# includes docker/nginx/sites.d (added for Nasihamart), so there is no front-proxy step. Run on the server as root from
# /opt/tahafi, one step at a time:
#
#   bash docs/installations/tahafi-first-deploy.sh stack <owner-email>  # build, migrate, start, create the OWNER
#   bash docs/installations/tahafi-first-deploy.sh check                # the proxy path works before DNS moves
#   -- point tahafi.com and www.tahafi.com (A records) at this VPS --
#   bash docs/installations/tahafi-first-deploy.sh live <cert-email>    # certificate + Tahafi server blocks
#
# Each step stops at the first failure and says how to undo it. Secrets are generated here and never printed.
set -euo pipefail

REPO_URL=https://github.com/Tanvir660230/asifzone.git
TH=/opt/tahafi
AZ=/opt/asifzone
HOST=tahafi.com
ID=tahafi
VPS_IP=187.77.137.12
TH_COMPOSE="docker compose -f docker/docker-compose.yml --env-file docker/.env"
AZ_COMPOSE="docker compose -f docker/docker-compose.yml --env-file docker/.env"

rand() { openssl rand -hex 32; }
say() { printf '\n== %s\n' "$*"; }

stack() {
  local email="${1:?usage: stack <owner-email>}"
  cd "$TH"
  # Tahafi's api/web publish their host ports on Asif Zone's Docker network gateway: Asif Zone's nginx reaches them
  # there, the internet does not. (Never join Tahafi's containers to docker_default: same service names.)
  local gw; gw="$(docker network inspect docker_default --format '{{(index .IPAM.Config 0).Gateway}}')"
  [ -n "$gw" ] || { echo "Asif Zone's network docker_default is missing"; exit 1; }

  if [ ! -f docker/.env ]; then
    say "docker/.env (new secrets)"
    (
      umask 077
      cat > docker/.env <<EOF
INSTALL_ID=$ID
STORE_THEME=tahafi
SERVER_NAME=$HOST
SERVER_ALIASES=www.$HOST
CERT_NAME=$HOST
GDRIVE_REMOTE=gdrive:tahafi-backups
COMPOSE_PROJECT_NAME=tahafi
POSTGRES_DB=tahafi
API_HOST_PORT=4200
WEB_HOST_PORT=3200
HOST_BIND_IP=$gw
WEB_ORIGIN=https://$HOST
SITE_URL=https://$HOST
PUBLIC_API_URL=https://$HOST
API_ORIGIN=https://$HOST
JWT_ACCESS_SECRET=$(rand)
JWT_CUSTOMER_ACCESS_SECRET=$(rand)
JWT_CUSTOMER_REFRESH_SECRET=$(rand)
POSTGRES_PASSWORD=$(rand)
REDIS_PASSWORD=$(rand)
REVALIDATE_SECRET=$(rand)
EOF
    )
  fi
  grep -q '^HOST_BIND_IP=' docker/.env || echo "HOST_BIND_IP=$gw" >> docker/.env
  sed -i '/^FRONT_PROXY_NETWORK=/d' docker/.env

  say "database + redis"
  $TH_COMPOSE up -d postgres redis
  until $TH_COMPOSE exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

  say "build, migrate, start (docker/deploy.sh; this store has no nginx of its own)"
  local hooks; hooks="$(mktemp)"
  echo 'do_restart_proxy() { :; }' > "$hooks"
  COMPOSE="$TH_COMPOSE" DEPLOY_HOOKS="$hooks" MIN_BACKUP_BYTES=1 READY_TIMEOUT=240 bash docker/deploy.sh
  rm -f "$hooks"

  say "OWNER account"
  local pass_file=/root/tahafi-owner.txt
  if [ ! -f "$pass_file" ]; then
    (umask 077; printf 'email=%s\npassword=%s\n' "$email" "$(openssl rand -base64 18 | tr -d '/+=')" > "$pass_file")
  fi
  local pass; pass="$(grep '^password=' "$pass_file" | cut -d= -f2-)"
  # prisma/seed.ts imports src/, which the runtime image does not ship; in production it only creates the OWNER, so
  # do exactly that with the image's own bcryptjs + Prisma client.
  $TH_COMPOSE exec -T -e OWNER_EMAIL="$email" -e OWNER_PASSWORD="$pass" api node -e '
    const bcrypt = require("bcryptjs"); const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();
    (async () => {
      const email = process.env.OWNER_EMAIL;
      if (await prisma.adminUser.findUnique({ where: { email } })) return console.log("owner already exists: " + email);
      const passwordHash = await bcrypt.hash(process.env.OWNER_PASSWORD, 12);
      await prisma.adminUser.create({ data: { name: "Store Owner", email, passwordHash, role: "OWNER" } });
      console.log("owner created: " + email);
    })().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());'
  echo "Login details are in $pass_file (root only). Change the password after the first login."

  say "check"
  $TH_COMPOSE ps
  # The same path Asif Zone's nginx will use.
  docker run --rm --network docker_default curlimages/curl -fsS "http://$gw:4200/health" && echo
  docker run --rm --network docker_default curlimages/curl -fsS -o /dev/null -w "web %{http_code}\n" "http://$gw:3200/"
}

check() {
  cd "$AZ"
  [ -d docker/nginx/sites.d ] || { echo "Asif Zone's nginx has no sites.d include — see nasihamart-first-deploy.sh front"; exit 1; }
  local gw; gw="$(docker network inspect docker_default --format '{{(index .IPAM.Config 0).Gateway}}')"
  say "Tahafi, seen from Asif Zone's network (the path nginx will use)"
  docker run --rm --network docker_default curlimages/curl -fsS "http://$gw:4200/health" && echo
  docker run --rm --network docker_default curlimages/curl -fsS -o /dev/null -w "web %{http_code}
" "http://$gw:3200/"
  free -m
}

live() {
  local email="${1:?usage: live <cert-email>}"
  cd "$AZ"
  [ -d docker/nginx/sites.d ] || { echo "Asif Zone's nginx has no sites.d include — see nasihamart-first-deploy.sh front"; exit 1; }
  for h in "$HOST" "www.$HOST"; do
    getent ahostsv4 "$h" | awk '{print $1}' | grep -qx "$VPS_IP" || { echo "$h does not resolve to $VPS_IP yet — point DNS first"; exit 1; }
  done

  say "certificate (Asif Zone's certbot issues it and renews it with asifzone.com's)"
  if [ ! -d "/var/lib/docker/volumes/docker_certbot_certs/_data/live/$HOST" ]; then
    $AZ_COMPOSE run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
      -d "$HOST" -d "www.$HOST" --cert-name "$HOST" --agree-tos --no-eff-email -m "$email" --non-interactive
  fi

  say "Tahafi server blocks"
  local gw; gw="$(docker network inspect docker_default --format '{{(index .IPAM.Config 0).Gateway}}')"
  sed -e "s/__HOST__/$HOST/g" -e "s/__API__/$gw:4200/g" -e "s/__WEB__/$gw:3200/g" \
    docker/nginx/sites.d/store.conf.sample > "docker/nginx/sites.d/$ID.conf"
  if ! $AZ_COMPOSE exec -T nginx nginx -t; then
    rm -f "docker/nginx/sites.d/$ID.conf"
    echo "nginx config test failed — site file removed, nothing reloaded"
    exit 1
  fi
  $AZ_COMPOSE exec -T nginx nginx -s reload
  sleep 2

  say "check"
  curl -fsS -o /dev/null -w "asifzone.com %{http_code}\n" --resolve asifzone.com:443:127.0.0.1 https://asifzone.com/
  curl -fsS -w "\n" --resolve "$HOST:443:127.0.0.1" "https://$HOST/health"
  curl -fsS -o /dev/null -w "$HOST %{http_code}\n" --resolve "$HOST:443:127.0.0.1" "https://$HOST/"
  echo "Live: https://$HOST  (admin: https://$HOST/admin)"
}

case "${1:-}" in
  stack) shift; stack "$@" ;;
  check) check ;;
  live) shift; live "$@" ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
