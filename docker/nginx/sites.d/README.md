# Extra stores behind this nginx

This installation owns ports 80/443 on the VPS, so its nginx also fronts any other installation running on the same
server (docs/STORE_DEPLOYMENT.md, "Several installations on one VPS"). Each extra store is one `<install-id>.conf` file
here, included at the end of `nginx.conf.template`. The files are server-local (`*.conf` is ignored by Git); with none,
the include is a no-op.

To add a store whose `INSTALL_ID` is `<id>` and host is `<host>`, running with `docker/compose.shared-proxy.yml` (its api
and web join this stack's network as `<id>-api` and `<id>-web`):

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
   sed -e 's/__HOST__/<host>/g' -e 's/__ID__/<id>/g' docker/nginx/sites.d/store.conf.sample > docker/nginx/sites.d/<id>.conf
   docker compose -f docker/docker-compose.yml --env-file docker/.env exec nginx nginx -t
   docker compose -f docker/docker-compose.yml --env-file docker/.env exec nginx nginx -s reload
   ```

A store that is down returns 502 on its own host only; this store is unaffected (upstreams resolve per request).
