# Migración a MySQL

El sitio continúa funcionando con SQLite localmente. Para publicarlo y usarlo desde cualquier dispositivo, crea una base MySQL administrada y completa las variables `DB_*` en `.env`.

1. Crea una base MySQL en el hosting elegido.
2. Ejecuta `MYSQL_SCHEMA.sql` desde phpMyAdmin, MySQL Workbench o la consola del proveedor.
3. Guarda host, puerto, nombre de base, usuario y contraseña en `.env`; nunca los publiques en GitHub.
4. Publica el servidor Node.js junto con esas variables de entorno.

La migración final del servidor requiere esos datos reales porque cada proveedor entrega un host y acceso diferentes.
