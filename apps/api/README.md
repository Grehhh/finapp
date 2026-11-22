# Finapp API

Backend personal para consultar saldos y movimientos bancarios mediante Open Banking AIS de solo lectura. El MVP también contempla objetivos de ahorro con aportaciones registradas manualmente y resúmenes mensuales de gastos por categoría y concepto; esos dos módulos aún no están implementados.

## Incluido ahora

- Conexión con Enable Banking y autorización AIS de lectura.
- Consulta de entidades disponibles, cuentas, saldos y movimientos.
- Sincronización manual, con deduplicación de movimientos.
- Persistencia en PostgreSQL mediante Prisma.
- La API escucha en `127.0.0.1` por defecto.

No hay pagos ni transferencias, usuarios múltiples, importación CSV ni sincronización programada.

## Desarrollo local

1. Copia `.env.example` a `.env` dentro de `apps/api`.
2. Configura `DATABASE_URL`, `FINAPP_API_TOKEN` y los datos de Enable Banking. Puedes generar un token con `openssl rand -base64 32`; guarda el token y la clave privada fuera de Git.
3. Define `ENABLE_BANKING_REDIRECT_URL` solo cuando tengas una URL HTTPS exacta registrada en Enable Banking. Una dirección `http://127.0.0.1` no sirve como callback para este registro.
4. Aplica la migración y genera Prisma Client:

   ```sh
   corepack pnpm --filter api exec prisma migrate deploy
   corepack pnpm --filter api exec prisma generate
   ```

5. Arranca el backend desde la raíz del repositorio:

   ```sh
   corepack pnpm dev
   ```

La configuración y los pasos del proveedor están en [BANKING.md](./BANKING.md). La API queda en loopback por defecto; antes de desplegarla configura HTTPS y almacena el token, la clave privada y `DATABASE_URL` como secretos del entorno.

## Rutas actuales

- `GET /banking/institutions?country=ES`
- `POST /banking/connections`
- `GET /banking/callback`
- `GET /banking/connections`
- `DELETE /banking/connections/:id` (cierra la sesión del proveedor si es posible y borra los datos locales en cascada)
- `GET /banking/accounts`
- `GET /banking/transactions`
- `POST /banking/sync`
- `POST /banking/accounts/:id/sync`

Todas las rutas requieren `Authorization: Bearer <FINAPP_API_TOKEN>`, salvo el callback AIS, que valida un `state` aleatorio de un solo uso y con caducidad. No pongas el token en código de navegador ni lo compartas. Los objetivos y los informes mensuales son alcance acordado, pero todavía no tienen rutas ni modelos implementados.
