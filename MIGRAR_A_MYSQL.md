# Nota de base de datos

Este proyecto usa **SQLite** mediante el archivo local `database.db`, siguiendo la guía práctica del BTH. El servidor Node.js se conecta a este archivo con la librería `sqlite3` y ofrece las rutas CRUD para clientes, servicios, vestidos, reservas y pagos.

Para ejecutarlo en clase:

1. Abre una terminal dentro de la carpeta del proyecto.
2. Ejecuta `npm install` una sola vez.
3. Ejecuta `npm start`.
4. Abre `http://localhost:3000` en el navegador.
3. Guarda host, puerto, nombre de base, usuario y contraseña en `.env`; nunca los publiques en GitHub.
4. Publica el servidor Node.js junto con esas variables de entorno.

La migración final del servidor requiere esos datos reales porque cada proveedor entrega un host y acceso diferentes.
