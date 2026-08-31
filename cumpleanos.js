/*
  Ejecútalo una vez al día desde el Programador de tareas de Windows:
  npm run cumpleanos
  Genera los cupones del día y deja los mensajes listos para que un proveedor
  autorizado de WhatsApp o correo los envíe.
*/
require("dotenv").config();
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.join(__dirname, "database.db"));
db.all(
  `SELECT c.id, c.nombre, c.telefono, c.correo
        FROM clientes c
        WHERE strftime('%m-%d', c.fecha_nacimiento) = strftime('%m-%d', 'now', 'localtime')`,
  [],
  (error, clients) => {
    if (error) throw error;
    if (!clients.length) return console.log("No hay cumpleaños para hoy.");
    clients.forEach((client) => {
      const code = `FELIZ${client.id}${new Date().getFullYear()}`;
      db.run(
        `INSERT OR IGNORE INTO cupones_cumpleanos (cliente_id, codigo, descuento)
                VALUES (?, ?, 15)`,
        [client.id, code],
        (err) => {
          if (err) return console.error(err.message);
          console.log(
            `Mensaje pendiente para ${client.nombre}: ¡Feliz cumpleaños! Tienes 15% de descuento. Código: ${code}`,
          );
        },
      );
    });
  },
);
