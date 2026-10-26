# Moving a store to its own VPS

Nasihamart and Tahafi run behind Asif Zone's nginx on one VPS. Any of them can move to its own server with the same image and the same data. The domain, `INSTALL_ID`, logins and orders are unchanged, so customers notice nothing but a few seconds of DNS change-over.

## What moves

| Item | Where it lives now |
|---|---|
| Settings and secrets | `/opt/<store>/docker/.env` |
| Database | `<store>` database in the `<store>_postgres_data` volume (`pg_dump`) |
| Uploads (product photos, logos) | `<store>_uploads_data` volume |
| Nightly backups | `GDRIVE_REMOTE` (already off-server) |

## Steps

1. **New server.** Install Docker and run `git clone https://github.com/Tanvir660230/asifzone.git /opt/<store>`. Copy `docker/.env` from the old server.
2. **Edit `.env` on the new server.** Remove `HOST_BIND_IP` and leave the default ports. This store now runs its own nginx and certbot on 80/443.
3. **Copy the data.**
   - On the old server: `docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T postgres pg_dump -U postgres -Fc <db> > db.dump`
   - Then: `docker run --rm -v <store>_uploads_data:/u -v $PWD:/b alpine tar czf /b/uploads.tgz -C /u .`
   - Copy both files across.
   - Or restore the latest Google Drive backup with `docker/gdrive-restore.sh` and `RESTORE_IMAGES=1`.
4. **Restore on the new server.**
   - Run `docker compose … up -d postgres redis`.
   - Restore the database with `pg_restore --clean --if-exists -d <db>`.
   - Unpack `uploads.tgz` into the uploads volume.
   - Run `bash docker/deploy.sh`.
5. **Certificate.** Issue it with the new server's certbot. Until DNS moves, use DNS validation, or keep the old server serving while the new one answers on its IP.
6. **DNS.** Point the store's A records (Hostinger) to the new server's IP and wait for the TTL.
7. **Retire the old copy.**
   - On the old server, delete `/opt/asifzone/docker/nginx/sites.d/<store>.conf` and reload Asif Zone's nginx.
   - Then run `docker compose -p <store> down`. Keep the volumes until the new server has run for a week.
8. **CI.** Move the store's deploy step to a runner on the new server, or deploy it there by hand.

Note: `docker/migrate-to-new-vps.sh` and `zero-downtime-migrate.sh` are written for Asif Zone (they name `clothing_brand` and asifzone.com). For another store, follow the steps above, or parameterise those scripts first.
