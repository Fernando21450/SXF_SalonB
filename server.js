require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
let mysql = null;
try {
  mysql = require("mysql2/promise");
} catch {
  // MySQL es opcional: el proyecto puede funcionar únicamente con SQLite.
}
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const secret = process.env.JWT_SECRET;
let mysqlEnabled =
  Boolean(mysql) &&
  [
    process.env.DB_HOST,
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
  ].every(Boolean);
let db = mysqlEnabled
  ? null
  : new sqlite3.Database(path.join(__dirname, "database.db"));
let mysqlPool = mysqlEnabled
  ? mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
      ssl:
        process.env.DB_SSL === "true"
          ? { rejectUnauthorized: false }
          : undefined,
    })
  : null;

function activateSQLiteFallback(reason) {
  if (mysqlPool) {
    mysqlPool.end().catch(() => {});
  }
  mysqlEnabled = false;
  mysqlPool = null;
  db = new sqlite3.Database(path.join(__dirname, "database.db"));
  console.warn(
    `No fue posible conectar con MySQL (${reason.code || reason.message}). Se inició SQLite temporalmente para mantener el sitio disponible.`,
  );
}

if (!secret || !process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
  throw new Error(
    "Falta .env. Copia .env.example como .env y completa ADMIN_USER, ADMIN_PASSWORD y JWT_SECRET.",
  );
}

app.use(express.json());
app.use(express.static(__dirname));

const run = (sql, values = []) =>
  mysqlEnabled
    ? mysqlPool.execute(sql, values).then(([result]) => ({
        id: result.insertId,
        changes: result.affectedRows,
      }))
    : new Promise((resolve, reject) =>
        db.run(sql, values, function (error) {
          error
            ? reject(error)
            : resolve({ id: this.lastID, changes: this.changes });
        }),
      );
const all = (sql, values = []) =>
  mysqlEnabled
    ? mysqlPool.execute(sql, values).then(([rows]) => rows)
    : new Promise((resolve, reject) =>
        db.all(sql, values, (error, rows) =>
          error ? reject(error) : resolve(rows),
        ),
      );
const one = (sql, values = []) =>
  mysqlEnabled
    ? mysqlPool.execute(sql, values).then(([rows]) => rows[0])
    : new Promise((resolve, reject) =>
        db.get(sql, values, (error, row) =>
          error ? reject(error) : resolve(row),
        ),
      );

function requireAuth(request, response, next) {
  const token = request.headers.authorization?.replace("Bearer ", "");
  try {
    request.user = jwt.verify(token, secret);
    next();
  } catch {
    response.status(401).json({ error: "Sesión no válida o vencida." });
  }
}
function error(response, value) {
  console.error(value);
  if (
    value?.code === "SQLITE_CONSTRAINT" ||
    value?.code === "ER_DUP_ENTRY" ||
    value?.code === "ER_ROW_IS_REFERENCED_2"
  ) {
    return response.status(400).json({
      error:
        "No se pudo guardar o eliminar el registro porque ya existe información relacionada o duplicada.",
    });
  }
  response.status(500).json({ error: "No se pudo completar la operación." });
}

async function setup() {
  if (mysqlEnabled) {
    try {
      await mysqlPool.query("SELECT 1");
    } catch (connectionError) {
      activateSQLiteFallback(connectionError);
      return setup();
    }
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS usuarios_admin (id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(120) NOT NULL,usuario VARCHAR(80) NOT NULL UNIQUE,contrasena_hash VARCHAR(255) NOT NULL,rol VARCHAR(40) NOT NULL DEFAULT 'administrador')`,
      `CREATE TABLE IF NOT EXISTS clientes (id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(150) NOT NULL,telefono VARCHAR(30) NOT NULL,correo VARCHAR(150) UNIQUE NULL,fecha_nacimiento DATE NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS servicios (id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(150) NOT NULL,descripcion TEXT NULL,precio DECIMAL(10,2) NOT NULL DEFAULT 0,duracion_minutos INT NULL,activo TINYINT(1) NOT NULL DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS vestidos (id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(150) NOT NULL,categoria VARCHAR(80) NULL,color VARCHAR(80) NULL,talla VARCHAR(40) NULL,precio DECIMAL(10,2) NOT NULL DEFAULT 0,imagen VARCHAR(255) NULL,disponible TINYINT(1) NOT NULL DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS reservas (id INT AUTO_INCREMENT PRIMARY KEY,cliente_id INT NOT NULL,tipo ENUM('servicio','vestido') NOT NULL,servicio_id INT NULL,vestido_id INT NULL,sucursal VARCHAR(150) NULL,fecha DATE NOT NULL,hora TIME NULL,estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',notas TEXT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(cliente_id) REFERENCES clientes(id),FOREIGN KEY(servicio_id) REFERENCES servicios(id),FOREIGN KEY(vestido_id) REFERENCES vestidos(id))`,
      `CREATE TABLE IF NOT EXISTS pagos (id INT AUTO_INCREMENT PRIMARY KEY,reserva_id INT NOT NULL,monto DECIMAL(10,2) NOT NULL,tipo VARCHAR(50) NOT NULL,metodo VARCHAR(60) NULL,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(reserva_id) REFERENCES reservas(id))`,
      `CREATE TABLE IF NOT EXISTS cupones_cumpleanos (id INT AUTO_INCREMENT PRIMARY KEY,cliente_id INT NOT NULL,codigo VARCHAR(80) NOT NULL UNIQUE,descuento INT NOT NULL DEFAULT 15,fecha_generacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,usado TINYINT(1) NOT NULL DEFAULT 0,FOREIGN KEY(cliente_id) REFERENCES clientes(id))`,
    ])
      await run(sql);
    const user = await one("SELECT id FROM usuarios_admin WHERE usuario=?", [
      process.env.ADMIN_USER,
    ]);
    if (!user) {
      await run(
        "INSERT INTO usuarios_admin(nombre,usuario,contrasena_hash) VALUES (?,?,?)",
        [
          "Administración Il Salone",
          process.env.ADMIN_USER,
          await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
        ],
      );
    }
    console.log("Base de datos activa: MySQL");
    return;
  }
  await run("PRAGMA foreign_keys = ON");
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS usuarios_admin (id INTEGER PRIMARY KEY AUTOINCREMENT,nombre TEXT NOT NULL,usuario TEXT UNIQUE NOT NULL,contrasena_hash TEXT NOT NULL,rol TEXT DEFAULT 'administrador')`,
    `CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT,nombre TEXT NOT NULL,telefono TEXT NOT NULL,correo TEXT UNIQUE,fecha_nacimiento TEXT,creado_en TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS servicios (id INTEGER PRIMARY KEY AUTOINCREMENT,nombre TEXT NOT NULL,descripcion TEXT,precio REAL NOT NULL DEFAULT 0,duracion_minutos INTEGER,activo INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS vestidos (id INTEGER PRIMARY KEY AUTOINCREMENT,nombre TEXT NOT NULL,categoria TEXT,color TEXT,talla TEXT,precio REAL NOT NULL DEFAULT 0,imagen TEXT,disponible INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS reservas (id INTEGER PRIMARY KEY AUTOINCREMENT,cliente_id INTEGER NOT NULL,tipo TEXT NOT NULL,servicio_id INTEGER,vestido_id INTEGER,sucursal TEXT,fecha TEXT NOT NULL,hora TEXT,estado TEXT DEFAULT 'pendiente',notas TEXT,creado_en TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(cliente_id) REFERENCES clientes(id),FOREIGN KEY(servicio_id) REFERENCES servicios(id),FOREIGN KEY(vestido_id) REFERENCES vestidos(id))`,
    `CREATE TABLE IF NOT EXISTS pagos (id INTEGER PRIMARY KEY AUTOINCREMENT,reserva_id INTEGER NOT NULL,monto REAL NOT NULL,tipo TEXT NOT NULL,metodo TEXT,fecha TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(reserva_id) REFERENCES reservas(id))`,
    `CREATE TABLE IF NOT EXISTS cupones_cumpleanos (id INTEGER PRIMARY KEY AUTOINCREMENT,cliente_id INTEGER NOT NULL,codigo TEXT UNIQUE NOT NULL,descuento INTEGER NOT NULL DEFAULT 15,fecha_generacion TEXT DEFAULT CURRENT_TIMESTAMP,usado INTEGER DEFAULT 0,FOREIGN KEY(cliente_id) REFERENCES clientes(id))`,
  ])
    await run(sql);
  if (
    !(await one("SELECT id FROM usuarios_admin WHERE usuario=?", [
      process.env.ADMIN_USER,
    ]))
  ) {
    await run(
      "INSERT INTO usuarios_admin(nombre,usuario,contrasena_hash) VALUES (?,?,?)",
      [
        "Administración Il Salone",
        process.env.ADMIN_USER,
        await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
      ],
    );
  }
  console.log("Base de datos activa: SQLite local");
}

app.post("/api/login", async (req, res) => {
  try {
    const user = await one("SELECT * FROM usuarios_admin WHERE usuario=?", [
      req.body.usuario,
    ]);
    if (
      !user ||
      !(await bcrypt.compare(req.body.contrasena || "", user.contrasena_hash))
    )
      return res
        .status(401)
        .json({ error: "Usuario o contraseña incorrectos." });
    res.json({
      token: jwt.sign({ id: user.id, rol: user.rol }, secret, {
        expiresIn: "8h",
      }),
      nombre: user.nombre,
    });
  } catch (value) {
    error(res, value);
  }
});

// Ruta pública de reserva: crea o actualiza la clienta y registra su solicitud.
app.post("/api/solicitudes/servicio", async (req, res) => {
  try {
    const b = req.body;
    if (!b.nombre || !b.telefono || !b.fecha || !b.hora || !b.servicio)
      return res
        .status(400)
        .json({ error: "Completa los campos obligatorios." });
    let client = await one(
      "SELECT id FROM clientes WHERE correo=? OR telefono=? ORDER BY CASE WHEN correo=? THEN 0 ELSE 1 END LIMIT 1",
      [b.correo || null, b.telefono, b.correo || null],
    );
    if (!client) {
      const saved = await run(
        "INSERT INTO clientes(nombre,telefono,correo,fecha_nacimiento) VALUES(?,?,?,?)",
        [b.nombre, b.telefono, b.correo || null, b.fecha_nacimiento || null],
      );
      client = { id: saved.id };
    } else
      await run(
        "UPDATE clientes SET nombre=?,fecha_nacimiento=COALESCE(?,fecha_nacimiento) WHERE id=?",
        [b.nombre, b.fecha_nacimiento || null, client.id],
      );
    let service = await one(
      "SELECT id FROM servicios WHERE nombre=? AND activo=1",
      [b.servicio],
    );
    if (!service) {
      const saved = await run(
        "INSERT INTO servicios(nombre,precio,activo) VALUES(?,?,1)",
        [b.servicio, 0],
      );
      service = { id: saved.id };
    }
    const saved = await run(
      "INSERT INTO reservas(cliente_id,tipo,servicio_id,sucursal,fecha,hora,estado,notas) VALUES(?,?,?,?,?,?,?,?)",
      [
        client.id,
        "servicio",
        service.id,
        b.sucursal || null,
        b.fecha,
        b.hora,
        "pendiente",
        b.notas || null,
      ],
    );
    res.status(201).json({
      id: saved.id,
      codigo: `IS-${saved.id.toString().padStart(5, "0")}`,
    });
  } catch (value) {
    error(res, value);
  }
});

app.post("/api/solicitudes/vestido", async (req, res) => {
  try {
    const b = req.body;
    if (
      !b.nombre ||
      !b.telefono ||
      !b.vestido ||
      !b.fecha_prueba ||
      !b.fecha_evento
    )
      return res.status(400).json({
        error: "Completa los datos obligatorios para reservar el vestido.",
      });
    if (b.fecha_prueba >= b.fecha_evento)
      return res
        .status(400)
        .json({ error: "La prueba debe ser anterior a la fecha del evento." });
    let client = await one(
      "SELECT id FROM clientes WHERE correo=? OR telefono=? ORDER BY CASE WHEN correo=? THEN 0 ELSE 1 END LIMIT 1",
      [b.correo || null, b.telefono, b.correo || null],
    );
    if (client)
      await run(
        "UPDATE clientes SET nombre=?,fecha_nacimiento=COALESCE(?,fecha_nacimiento) WHERE id=?",
        [b.nombre, b.fecha_nacimiento || null, client.id],
      );
    else {
      const saved = await run(
        "INSERT INTO clientes(nombre,telefono,correo,fecha_nacimiento) VALUES(?,?,?,?)",
        [b.nombre, b.telefono, b.correo || null, b.fecha_nacimiento || null],
      );
      client = { id: saved.id };
    }
    let dress = await one(
      "SELECT id,disponible FROM vestidos WHERE nombre=? AND COALESCE(imagen,'')=COALESCE(?, '')",
      [b.vestido.nombre, b.vestido.imagen || ""],
    );
    if (!dress) {
      const saved = await run(
        "INSERT INTO vestidos(nombre,categoria,color,talla,precio,imagen,disponible) VALUES(?,?,?,?,?,?,?)",
        [
          b.vestido.nombre,
          b.vestido.categoria || "Vestido",
          b.vestido.color || null,
          b.vestido.talla || b.vestido.size || null,
          Number(b.vestido.precio || b.vestido.price) || 0,
          b.vestido.imagen || null,
          b.vestido.available ? 1 : 0,
        ],
      );
      dress = { id: saved.id, disponible: b.vestido.available ? 1 : 0 };
    }
    if (!dress.disponible)
      return res
        .status(409)
        .json({ error: "Este vestido no está disponible para reserva." });
    const notes = b.comentario?.trim() || null;
    const saved = await run(
      "INSERT INTO reservas(cliente_id,tipo,vestido_id,fecha,estado,notas) VALUES(?,?,?,?,?,?)",
      [client.id, "vestido", dress.id, b.fecha_prueba, "pendiente", notes],
    );
    res.status(201).json({ codigo: `VT-${String(saved.id).padStart(5, "0")}` });
  } catch (value) {
    error(res, value);
  }
});

app.get("/api/dashboard", requireAuth, async (_, res) => {
  try {
    const queries = [
      "SELECT COUNT(*) total FROM clientes",
      "SELECT COUNT(*) total FROM reservas",
      mysqlEnabled
        ? "SELECT COUNT(*) total FROM reservas WHERE fecha=CURDATE()"
        : "SELECT COUNT(*) total FROM reservas WHERE fecha=date('now','localtime')",
      "SELECT COUNT(*) total FROM vestidos WHERE disponible=1",
      "SELECT COUNT(*) total FROM servicios WHERE activo=1",
    ];
    const result = await Promise.all(queries.map((query) => one(query)));
    res.json({
      clientes: result[0].total,
      reservas: result[1].total,
      reservasHoy: result[2].total,
      vestidos: result[3].total,
      servicios: result[4].total,
    });
  } catch (value) {
    error(res, value);
  }
});

const entities = {
  clientes: ["nombre", "telefono", "correo", "fecha_nacimiento"],
  servicios: ["nombre", "descripcion", "precio", "duracion_minutos", "activo"],
  vestidos: [
    "nombre",
    "categoria",
    "color",
    "talla",
    "precio",
    "imagen",
    "disponible",
  ],
};
for (const [entity, fields] of Object.entries(entities)) {
  app.get(`/api/${entity}`, requireAuth, async (req, res) => {
    try {
      const search = req.query.buscar;
      const rows =
        entity === "clientes" && search
          ? await all(
              "SELECT * FROM clientes WHERE nombre LIKE ? OR telefono LIKE ? OR correo LIKE ? ORDER BY id DESC",
              [`%${search}%`, `%${search}%`, `%${search}%`],
            )
          : await all(`SELECT * FROM ${entity} ORDER BY id DESC`);
      res.json(rows);
    } catch (value) {
      error(res, value);
    }
  });
  app.post(`/api/${entity}`, requireAuth, async (req, res) => {
    try {
      const values = fields.map((field) => req.body[field] ?? null);
      const saved = await run(
        `INSERT INTO ${entity} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
        values,
      );
      res.status(201).json({ id: saved.id });
    } catch (value) {
      error(res, value);
    }
  });
  app.put(`/api/${entity}/:id`, requireAuth, async (req, res) => {
    try {
      const values = fields.map((field) => req.body[field] ?? null);
      await run(
        `UPDATE ${entity} SET ${fields.map((field) => `${field}=?`).join(",")} WHERE id=?`,
        [...values, req.params.id],
      );
      res.json({ mensaje: "Actualizado" });
    } catch (value) {
      error(res, value);
    }
  });
  app.delete(`/api/${entity}/:id`, requireAuth, async (req, res) => {
    try {
      await run(`DELETE FROM ${entity} WHERE id=?`, [req.params.id]);
      res.json({ mensaje: "Eliminado" });
    } catch (value) {
      error(res, value);
    }
  });
}

app.get("/api/usuarios", requireAuth, async (_, res) => {
  try {
    res.json(
      await all(
        "SELECT id,nombre,usuario,rol FROM usuarios_admin ORDER BY id DESC",
      ),
    );
  } catch (value) {
    error(res, value);
  }
});
app.post("/api/usuarios", requireAuth, async (req, res) => {
  try {
    const b = req.body;
    if (!b.nombre || !b.usuario || !b.contrasena)
      return res.status(400).json({ error: "Nombre, usuario y contraseña son obligatorios." });
    const saved = await run(
      "INSERT INTO usuarios_admin(nombre,usuario,contrasena_hash,rol) VALUES(?,?,?,?)",
      [b.nombre, b.usuario, await bcrypt.hash(b.contrasena, 12), b.rol || "administrador"],
    );
    res.status(201).json({ id: saved.id });
  } catch (value) {
    error(res, value);
  }
});
app.put("/api/usuarios/:id", requireAuth, async (req, res) => {
  try {
    const b = req.body;
    if (!b.nombre || !b.usuario)
      return res.status(400).json({ error: "Nombre y usuario son obligatorios." });
    const values = [b.nombre, b.usuario, b.rol || "administrador"];
    let sql = "UPDATE usuarios_admin SET nombre=?,usuario=?,rol=?";
    if (b.contrasena) {
      sql += ",contrasena_hash=?";
      values.push(await bcrypt.hash(b.contrasena, 12));
    }
    values.push(req.params.id);
    await run(`${sql} WHERE id=?`, values);
    res.json({ mensaje: "Usuario actualizado" });
  } catch (value) {
    error(res, value);
  }
});
app.delete("/api/usuarios/:id", requireAuth, async (req, res) => {
  try {
    if (Number(req.params.id) === Number(req.user.id))
      return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
    await run("DELETE FROM usuarios_admin WHERE id=?", [req.params.id]);
    res.json({ mensaje: "Usuario eliminado" });
  } catch (value) {
    error(res, value);
  }
});

app.get("/api/reservas", requireAuth, async (_, res) => {
  try {
    res.json(
      await all(
        `SELECT r.*,c.nombre cliente,s.nombre servicio,v.nombre vestido FROM reservas r JOIN clientes c ON c.id=r.cliente_id LEFT JOIN servicios s ON s.id=r.servicio_id LEFT JOIN vestidos v ON v.id=r.vestido_id ORDER BY r.fecha DESC,r.hora DESC`,
      ),
    );
  } catch (value) {
    error(res, value);
  }
});
app.post("/api/reservas", requireAuth, async (req, res) => {
  try {
    const b = req.body;
    const saved = await run(
      "INSERT INTO reservas(cliente_id,tipo,servicio_id,vestido_id,sucursal,fecha,hora,estado,notas) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        b.cliente_id,
        b.tipo,
        b.servicio_id || null,
        b.vestido_id || null,
        b.sucursal || null,
        b.fecha,
        b.hora || null,
        b.estado || "pendiente",
        b.notas || null,
      ],
    );
    res.status(201).json({ id: saved.id });
  } catch (value) {
    error(res, value);
  }
});
app.put("/api/reservas/:id", requireAuth, async (req, res) => {
  try {
    const b = req.body;
    await run(
      "UPDATE reservas SET fecha=?,hora=?,estado=?,notas=? WHERE id=?",
      [b.fecha, b.hora, b.estado, b.notas || null, req.params.id],
    );
    res.json({ mensaje: "Actualizada" });
  } catch (value) {
    error(res, value);
  }
});
app.delete("/api/reservas/:id", requireAuth, async (req, res) => {
  try {
    await run("DELETE FROM reservas WHERE id=?", [req.params.id]);
    res.json({ mensaje: "Eliminada" });
  } catch (value) {
    error(res, value);
  }
});

app.get("/api/pagos", requireAuth, async (_, res) => {
  try {
    res.json(
      await all(
        "SELECT p.*,c.nombre cliente FROM pagos p JOIN reservas r ON r.id=p.reserva_id JOIN clientes c ON c.id=r.cliente_id ORDER BY p.fecha DESC",
      ),
    );
  } catch (value) {
    error(res, value);
  }
});
app.post("/api/pagos", requireAuth, async (req, res) => {
  try {
    const b = req.body;
    const saved = await run(
      "INSERT INTO pagos(reserva_id,monto,tipo,metodo) VALUES(?,?,?,?)",
      [b.reserva_id, b.monto, b.tipo, b.metodo],
    );
    res.status(201).json({ id: saved.id });
  } catch (value) {
    error(res, value);
  }
});
app.delete("/api/pagos/:id", requireAuth, async (req, res) => {
  try {
    await run("DELETE FROM pagos WHERE id=?", [req.params.id]);
    res.json({ mensaje: "Pago eliminado" });
  } catch (value) {
    error(res, value);
  }
});

app.get("/api/cumpleanos/hoy", requireAuth, async (_, res) => {
  try {
    const clients = await all(
      mysqlEnabled
        ? "SELECT * FROM clientes WHERE DATE_FORMAT(fecha_nacimiento,'%m-%d')=DATE_FORMAT(CURDATE(),'%m-%d')"
        : "SELECT * FROM clientes WHERE strftime('%m-%d',fecha_nacimiento)=strftime('%m-%d','now','localtime')",
    );
    const coupons = [];
    for (const client of clients) {
      let coupon = await one(
        mysqlEnabled
          ? "SELECT * FROM cupones_cumpleanos WHERE cliente_id=? AND DATE(fecha_generacion)=CURDATE()"
          : "SELECT * FROM cupones_cumpleanos WHERE cliente_id=? AND date(fecha_generacion)=date('now','localtime')",
        [client.id],
      );
      if (!coupon) {
        const code = `FELIZ${client.id}${new Date().getFullYear()}`;
        const saved = await run(
          "INSERT INTO cupones_cumpleanos(cliente_id,codigo,descuento) VALUES(?,?,?)",
          [client.id, code, 15],
        );
        coupon = { id: saved.id, codigo: code, descuento: 15 };
      }
      coupons.push({
        cliente: client.nombre,
        telefono: client.telefono,
        correo: client.correo,
        codigo: coupon.codigo,
        descuento: coupon.descuento,
        mensaje: `¡Feliz cumpleaños, ${client.nombre}! Il Salone Lia Vincenzo te regala ${coupon.descuento}% de descuento. Usa el código ${coupon.codigo}.`,
      });
    }
    res.json(coupons);
  } catch (value) {
    error(res, value);
  }
});

setup()
  .then(() =>
    app.listen(port, "0.0.0.0", () =>
      console.log(`Il Salone activo en http://localhost:${port}`),
    ),
  )
  .catch(console.error);
