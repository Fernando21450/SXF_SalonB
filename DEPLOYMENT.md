# Despliegue gratuito en Render

La aplicación conserva SQLite para desarrollo local. En producción, `DATABASE_URL` activa PostgreSQL y las imágenes nuevas del panel se guardan en Supabase Storage. Render Free tiene un sistema de archivos efímero: no guardes allí la base ni archivos que deban sobrevivir reinicios.

## 1. Crear los recursos de Supabase

1. Crea un proyecto Supabase en el plan gratuito y guarda su contraseña de base de datos.
2. En **Storage**, crea un bucket público llamado `il-salone-media`.
3. Copia la URL del proyecto y la clave `service_role`; esta clave es secreta y solo se configura en el servidor.
4. Copia la URI de PostgreSQL del pooler de Supabase. Guárdala completa, incluida la contraseña.

El proyecto debe arrancarse una vez con `DATABASE_URL` para que el servidor cree las tablas y la cuenta inicial.

## 2. Publicar en Render

1. Sube al repositorio los cambios y los archivos de imágenes que deben publicarse. No subas `.env` ni `database.db`.
2. En Render, crea un **Blueprint** a partir del repositorio y acepta la configuración de `render.yaml`.
3. Completa las variables solicitadas por Render:
   - `ADMIN_USER`
   - `ADMIN_PASSWORD`
   - `JWT_SECRET` (genera una clave aleatoria de al menos 32 caracteres)
   - `DATABASE_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Despliega y espera a que el servicio esté disponible. La primera ejecución crea el esquema PostgreSQL.

El servicio gratuito puede tardar en despertar después de estar inactivo. Los servicios gratuitos no deben tratarse como producción con garantía de disponibilidad; revisa también los límites y las condiciones vigentes de Render y Supabase.

## 3. Migrar los datos locales una sola vez

Antes de migrar, deja de registrar reservas en el sitio local y no uses el nuevo sitio hasta validar la migración. El script se niega a copiar sobre una base destino con datos; solo permite la cuenta inicial de `ADMIN_USER` creada al arrancar Render.

En Windows PowerShell, desde la raíz del proyecto:

```powershell
$backup = Join-Path $env:USERPROFILE "il-salone-database.backup.db"
Copy-Item .\database.db $backup
$env:DATABASE_URL = "URI_DE_POSTGRES_DE_SUPABASE"
$env:SUPABASE_URL = "URL_DEL_PROYECTO"
$env:SUPABASE_SERVICE_ROLE_KEY = "CLAVE_SERVICE_ROLE"
$env:SUPABASE_STORAGE_BUCKET = "il-salone-media"
$env:ALLOW_EMPTY_DATABASE_MIGRATION = "YES"
npm.cmd run migrate:hosting
```

El script copia las tablas de negocio y las imágenes cargadas desde el panel que estén en `imagenes/servicios-admin/` y `imagenes/vestidos-admin/`. Conserva las rutas de imágenes estáticas del repositorio. Revisa el resumen de filas e imágenes y luego prueba el acceso al panel, el catálogo, una reserva y la galería. No vuelvas a ejecutar la migración sobre una base ya poblada.

Las cuentas de panel importadas conservan sus hashes de contraseña locales. Si necesitas usar otra contraseña, cámbiala desde el panel después de validar la migración.

## 4. Promociones de cumpleaños

El cron de Render se reemplazó por GitHub Actions. En el repositorio de GitHub, crea estos **Actions secrets**:

- `BIRTHDAY_SITE_URL`: URL pública completa del servicio Render, por ejemplo `https://il-salone-lia-vincenzo.onrender.com`.
- `BIRTHDAY_CRON_SECRET`: el mismo valor generado por Render para el grupo `birthday-cron-auth`.

El workflow `.github/workflows/cumpleanos.yml` corre cada hora y también se puede iniciar manualmente desde la pestaña **Actions**. Para enviar mensajes, configura además las credenciales de Resend y/o WhatsApp Cloud API en las variables de entorno de Render; son opcionales para el resto del sitio.

## Desarrollo local

Sin `DATABASE_URL`, `npm start` continúa usando `database.db` y las imágenes del panel se guardan localmente. Usa `.env.example` como referencia para las variables.
