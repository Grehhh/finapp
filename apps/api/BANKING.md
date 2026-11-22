# Lectura bancaria personal

La primera integración usa Enable Banking para consultar saldos y movimientos de cuentas personales. El backend no implementa iniciación de pagos ni envía operaciones al banco.

## Preparación

1. Registra una aplicación AIS en [Enable Banking](https://enablebanking.com/sign-in/) y autoriza la URL HTTPS exacta configurada en `ENABLE_BANKING_REDIRECT_URL`. Enable Banking rechaza callbacks `http://127.0.0.1`; para probar conexiones reales se necesitará un callback HTTPS mediante túnel o despliegue.
2. Registra la clave pública/certificado de la aplicación y guarda su clave privada fuera de Git. El ejemplo usa `apps/api/secrets/enablebanking-private.key`, ruta ignorada por Git.
3. Copia `.env.example` a `.env` en `apps/api` y configura `FINAPP_API_TOKEN` con un valor aleatorio de al menos 32 bytes, el ID, la ruta de la clave, la URL del callback y `DATABASE_URL`. Antes de conectar cuentas reales, apunta a una base PostgreSQL aislada para pruebas.
4. Aplica la migración de PostgreSQL con `corepack pnpm --filter api exec prisma migrate deploy` y genera el cliente con `corepack pnpm --filter api exec prisma generate`.
5. Arranca la API con `corepack pnpm --filter api start:dev`. Por defecto escucha solo en `127.0.0.1`.

La URL de callback debe coincidir exactamente con la registrada en el proveedor. Las aplicaciones de Enable Banking se registran por separado para sandbox y producción; usa el endpoint del entorno que corresponda. La API permanece en loopback por defecto. Antes de desplegarla, usa HTTPS y almacena el token, la clave privada y `DATABASE_URL` como secretos del entorno.

## Flujo de conexión y lectura

- `GET /banking/institutions?country=ES` lista bancos disponibles para AIS personal.
- `POST /banking/connections` con `{"bankName":"Nombre del banco","countryCode":"ES"}` inicia el consentimiento y devuelve `authorizationUrl`.
- Abre `authorizationUrl` en el navegador y autoriza el acceso de solo lectura en tu banco. El proveedor vuelve a `/banking/callback` y el backend guarda la conexión, las cuentas, los saldos y la primera carga disponible de movimientos.
- `GET /banking/connections` lista conexiones activas y pendientes sin devolver identificadores de sesión del proveedor.
- `DELETE /banking/connections/:id` intenta cerrar la sesión/consentimiento en Enable Banking y borra la conexión y las cuentas, saldos y movimientos asociados de la base local. La respuesta indica si se pudo confirmar el cierre remoto; si no, revoca el consentimiento desde el banco o el Control Panel.
- `GET /banking/accounts` muestra las cuentas y sus tipos de saldo; `GET /banking/transactions` lista movimientos.
- `POST /banking/sync` actualiza todas las cuentas; `POST /banking/accounts/:id/sync` actualiza una.

Se guarda únicamente el sufijo de cuatro dígitos de la cuenta cuando el banco lo proporciona, no el IBAN completo ni la respuesta bancaria sin procesar. Los importes se conservan como decimales exactos y cada movimiento se sincroniza de forma idempotente.

Todas las rutas salvo `/banking/callback` requieren `Authorization: Bearer <FINAPP_API_TOKEN>`. El callback es público para recibir el retorno del proveedor, pero el `state` caduca a los 15 minutos y se consume de forma atómica una sola vez. La respuesta del callback no incluye IDs ni detalles de cuentas. No registres las query strings del callback ni compartas el token.

## Datos ficticios para pruebas en staging

`POST /banking/mock/seed` crea o actualiza de forma idempotente una conexión, una cuenta, un saldo y tres movimientos ficticios. No llama a Enable Banking. La ruta requiere el mismo Bearer que el resto de la API y solo está disponible cuando `FINAPP_ENV=staging` y `BANKING_MOCK_ENABLED=true`; en otros entornos responde como una ruta inexistente. En modo mock, el listado de entidades devuelve Finapp Mock Bank, las rutas de inicio de consentimiento y callback no llaman al proveedor, y las rutas de sincronización solo actualizan la fecha de los registros mock.

Antes de habilitarlo, configura una base de datos aislada para staging. En el proveedor de alojamiento define `FINAPP_ENV=staging` y `BANKING_MOCK_ENABLED=true` solo en ese servicio. Mantén `BANKING_MOCK_ENABLED=false` en producción. Después puedes consultar `GET /banking/connections`, `GET /banking/accounts` y `GET /banking/transactions`, y probar `POST /banking/sync` o `POST /banking/accounts/:id/sync` con el mismo Bearer. En modo mock esos endpoints no contactan ningún banco. Para borrar el fixture, elimina la conexión mock con `DELETE /banking/connections/:id`; la respuesta confirma que se borraron los datos locales. La API token protege el endpoint, pero no es el login de usuario que debe implementar la interfaz web.

Ejemplo desde PowerShell, sustituyendo el dominio y el token por valores del entorno de staging:

```powershell
$headers = @{ Authorization = 'Bearer <FINAPP_API_TOKEN>' }
Invoke-RestMethod -Method Post -Uri 'https://<dominio-staging>/banking/mock/seed' -Headers $headers
Invoke-RestMethod -Method Get -Uri 'https://<dominio-staging>/banking/accounts' -Headers $headers
Invoke-RestMethod -Method Get -Uri 'https://<dominio-staging>/banking/transactions' -Headers $headers
```

## Despliegue remoto y callback HTTPS

El objetivo es alojar Finapp para usarla desde móvil u ordenador y recibir allí el callback de Enable Banking. El repositorio contiene actualmente la API NestJS, no una interfaz web; una interfaz privada con autenticación personal es necesaria para usar la aplicación de forma cómoda desde cualquier ubicación.

Antes de desplegar:

- Elegir el proveedor de alojamiento y PostgreSQL gestionado revisando límites gratuitos, residencia de datos, suspensión por inactividad, copias y posibles costes.
- Mantener `DATABASE_URL`, `FINAPP_API_TOKEN`, APP ID y clave privada como secretos del proveedor; no incluir secretos en el frontend ni en Git.
- Usar HTTPS y una URL estable para `ENABLE_BANKING_REDIRECT_URL`; registrar exactamente `https://<dominio>/banking/callback` en Enable Banking.
- Proteger todas las rutas de datos con autenticación personal. Solo el callback requerido por el proveedor debe ser público; su `state` caduca a los 15 minutos y se consume una sola vez.
- Definir y documentar la copia y restauración de la base antes de almacenar movimientos reales.

No se debe usar un túnel local como ngrok en el flujo previsto. La aplicación se probará cuando API, interfaz, base de datos y autenticación estén configuradas en el entorno alojado. No conectes cuentas reales hasta revisar el acceso remoto, los secretos, el aislamiento de la base y el procedimiento de recuperación.

Al terminar una prueba AIS, lista `GET /banking/connections` y elimina cada conexión con `DELETE /banking/connections/:id`. Comprueba `providerConsentRevoked` en la respuesta. Si devuelve `false`, revoca el consentimiento desde el banco o el Control Panel. La ruta de desconexión llama a `DELETE /sessions/{session_id}` de Enable Banking; el proveedor indica que el consentimiento se cierra automáticamente cuando es posible. [Referencia de Enable Banking](https://enablebanking.com/docs/api/reference/).

## Publicar solo la API mock en staging

El `Dockerfile` de la raíz construye la API NestJS desde el monorepo y la inicia escuchando en `0.0.0.0` usando el `PORT` del entorno. El contexto de Docker debe ser la raíz del repositorio; `.dockerignore` excluye `.env`, claves privadas y secretos.

Configura en el proveedor, como variables/secretos del servicio:

- `DATABASE_URL`: base PostgreSQL de staging aislada.
- `FINAPP_API_TOKEN`: token aleatorio de al menos 32 bytes.
- `FINAPP_ENV=staging` y `BANKING_MOCK_ENABLED=true` para habilitar el fixture mock únicamente en staging.
- `HOST=0.0.0.0` y el `PORT` asignado por el proveedor (el contenedor ya usa estos valores por defecto).

Si la base aún no tiene las tablas actuales, ejecuta antes del arranque las migraciones pendientes con `pnpm --filter api exec prisma migrate deploy --config prisma7.config.ts`. Las migraciones crean/actualizan las tablas que usa el código; `prisma generate` solo crea el cliente de código y no modifica la base.

Para comprobar desde Postman que el servicio está operativo y conectado a PostgreSQL, llama `GET /banking/connections` con `Authorization: Bearer <FINAPP_API_TOKEN>`. Para cargar y consultar datos ficticios, llama `POST /banking/mock/seed` y después `GET /banking/accounts` o `GET /banking/transactions`, siempre con el mismo Bearer. No hace falta configurar credenciales de Enable Banking para esta prueba.

La ruta de desconexión llama a `DELETE /sessions/{session_id}` de Enable Banking; el proveedor indica que el consentimiento se cierra automáticamente cuando es posible. [Referencia de Enable Banking](https://enablebanking.com/docs/api/reference/).
