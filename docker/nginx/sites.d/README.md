# Extra stores behind this nginx

This installation owns ports 80/443 on the VPS, so its nginx also fronts any other installation running on the same
server (docs/STORE_DEPLOYMENT.md, "Several installations on one VPS"). Each extra store is one `<install-id>.conf` file
here, included at the end of `nginx.conf.template`. The files are server-local (`*.conf` is ignored by Git); with none,
the include is a no-op.

To add a store whose host is `<host>`: run it as its own compose project with `HOST_BIND_IP` set to this stack's network
gateway (`docker network inspect docker_default --format '{{(index .IPAM.Config 0).Gateway}}'`, e.g. 172.18.0.1) and
its own `API_HOST_PORT` / `WEB_HOST_PORT`. This nginx reaches it there; the internet cannot. Never join its containers to
this stack's network: both stacks use the same service names (`postgres`, `api`, `web`), so names would resolve across
stores.

1. Point the domain's DNS (`@` and `www`) at this VPS. Until step 3 its HTTP requests reach this store's port-80 server,
   which already answers the ACME challenge for any host.
2. Issue the certificate with this stack's certbot, which then renews it with the others:

   ```bash
   docker compose -f docker/docker-compose.yml --env-file docker/.env run --rm --entrypoint certbot certbot \
     certonly --webroot -w /var/www/certbot -d <host> -d www.<host> --cert-name <host> \
     --agree-tos --no-eff-email -m <email> --non-interactive
   ```

3. Render the site file and reload, checking the config first:

   ```bash
   sed -e 's/__HOST__/<host>/g' -e 's/__API__/<gateway>:<api-port>/g' -e 's/__WEB__/<gateway>:<web-port>/g' \n     docker/nginx/sites.d/store.conf.sample > docker/nginx/sites.d/<id>.conf
   docker compose -f docker/docker-compose.yml --env-file docker/.env exec nginx nginx -t
   docker compose -f docker/docker-compose.yml --env-file docker/.env exec nginx nginx -s reload
   ```

A store that is down returns 502 on its own host only; this store is unaffected.
