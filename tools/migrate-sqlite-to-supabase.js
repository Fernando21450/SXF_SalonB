require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const root = path.join(__dirname, "..");
const sqlitePath = process.env.SQLITE_PATH || path.join(root, "database.db");
const tables = [
  "usuarios_admin",
  "clientes",
  "servicios",
  "vestidos",
  "consultas_contacto",
  "suscriptores_novedades",
  "vestido_imagenes",
  "reservas",
  "pagos",
  "cupones_cumpleanos",
];
const storageBaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || "";
const storageKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
const sqlite = new sqlite3.Database(sqlitePath);
const postgres = new Pool({ connectionString: process.env.DATABASE_URL });
const sqliteAll = (sql, values = []) =>
  new Promise((resolve, reject) =>
    sqlite.all(sql, values, (error, rows) =>
      error ? reject(error) : resolve(rows),
    ),
  );
const contentTypeFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  }[extension];
};
const uploadImage = async (relativePath, imageCache) => {
  if (imageCache.has(relativePath)) return imageCache.get(relativePath);
  if (/^https:\/\//i.test(relativePath)) {
    const publicPrefix = `${storageBaseUrl}/storage/v1/object/public/${encodeURIComponent(storageBucket)}/`;
    if (relativePath.startsWith(publicPrefix)) return relativePath;
    throw new Error(`La imagen remota no pertenece al bucket configurado: ${relativePath}`);
  }
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!/^imagenes\/(?:servicios-admin|vestidos-admin)\//.test(normalized))
    return relativePath;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw new Error(`Ruta local de imagen inválida: ${relativePath}`);
  const absolutePath = path.resolve(root, ...parts);
  const allowedRoot = path.resolve(root, "imagenes") + path.sep;
  if (!absolutePath.startsWith(allowedRoot))
    throw new Error(`Ruta local de imagen fuera de la carpeta permitida: ${relativePath}`);
  const contentType = contentTypeFor(absolutePath);
  if (!contentType)
    throw new Error(`Formato de imagen no admitido para la migración: ${relativePath}`);
  const buffer = await fs.promises.readFile(absolutePath);
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new Error(`La imagen debe pesar como máximo 5 MB: ${relativePath}`);
  const objectPath = `admin/${normalized.slice("imagenes/".length)}`;
  const endpoint = `${storageBaseUrl}/storage/v1/object/${encodeURIComponent(storageBucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: storageKey,
      Authorization: `Bearer ${storageKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!response.ok)
    throw new Error(`Error al migrar ${relativePath} a Storage (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
  const publicUrl = `${storageBaseUrl}/storage/v1/object/public/${encodeURIComponent(storageBucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  imageCache.set(relativePath, publicUrl);
  return publicUrl;
};

async function main() {
  if (!process.env.DATABASE_URL || !storageBaseUrl || !storageBucket || !storageKey)
    throw new Error("Configura DATABASE_URL, SUPABASE_URL, SUPABASE_STORAGE_BUCKET y SUPABASE_SERVICE_ROLE_KEY.");
  if (process.env.ALLOW_EMPTY_DATABASE_MIGRATION !== "YES")
    throw new Error("Confirma el destino vacío configurando ALLOW_EMPTY_DATABASE_MIGRATION=YES.");
  if (!fs.existsSync(sqlitePath))
    throw new Error(`No se encontró la base SQLite: ${sqlitePath}`);

  const destinationUsers = await postgres.query(
    "SELECT id,usuario,nombre,contrasena_hash,rol FROM usuarios_admin",
  );
  if (
    destinationUsers.rows.length > 1 ||
    (destinationUsers.rows.length === 1 &&
      destinationUsers.rows[0].usuario !== process.env.ADMIN_USER)
  )
    throw new Error("La base destino no está vacía; solo se permite la cuenta inicial de ADMIN_USER.");
  for (const table of tables.filter((name) => name !== "usuarios_admin")) {
    const result = await postgres.query(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`);
    if (Number(result.rows[0].total) !== 0)
      throw new Error(`La tabla destino ${table} ya contiene datos; no se modificó ninguna fila.`);
  }

  const availableTables = new Set(
    (await sqliteAll("SELECT name FROM sqlite_master WHERE type='table'"))
      .map((row) => row.name),
  );
  const sourceData = new Map();
  for (const table of tables) {
    if (!availableTables.has(table)) {
      sourceData.set(table, []);
      continue;
    }
    sourceData.set(table, await sqliteAll(`SELECT * FROM ${quoteIdentifier(table)}`));
  }

  const imageCache = new Map();
  for (const table of ["servicios", "vestidos", "vestido_imagenes"]) {
    const column = table === "vestido_imagenes" ? "ruta" : "imagen";
    for (const row of sourceData.get(table)) {
      if (row[column]) row[column] = await uploadImage(row[column], imageCache);
    }
  }

  const clientColumns = await postgres.query(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1)",
    [tables],
  );
  const columnsByTable = new Map();
  for (const row of clientColumns.rows) {
    const columns = columnsByTable.get(row.table_name) || new Set();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }

  const counts = {};
  await postgres.query("BEGIN");
  try {
    if (destinationUsers.rows[0])
      await postgres.query("DELETE FROM usuarios_admin WHERE id=$1", [destinationUsers.rows[0].id]);

    for (const table of tables) {
      const targetColumns = columnsByTable.get(table);
      if (!targetColumns) throw new Error(`No existe la tabla destino ${table}; inicia primero el servidor.`);
      let copied = 0;
      for (const row of sourceData.get(table)) {
        const columns = Object.keys(row).filter((column) => targetColumns.has(column));
        if (!columns.length) continue;
        const values = columns.map((column) => row[column]);
        const parameters = columns.map((_, index) => `$${index + 1}`).join(",");
        await postgres.query(
          `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${parameters})`,
          values,
        );
        copied++;
      }
      counts[table] = copied;
    }

    const importedAdmin = sourceData.get("usuarios_admin")
      .some((user) => user.usuario === process.env.ADMIN_USER);
    if (destinationUsers.rows[0] && !importedAdmin) {
      const bootstrap = destinationUsers.rows[0];
      const nextId = await postgres.query(
        "SELECT COALESCE(MAX(id),0)+1 AS id FROM usuarios_admin",
      );
      await postgres.query(
        "INSERT INTO usuarios_admin(id,nombre,usuario,contrasena_hash,rol) VALUES($1,$2,$3,$4,$5)",
        [nextId.rows[0].id, bootstrap.nombre, bootstrap.usuario, bootstrap.contrasena_hash, bootstrap.rol],
      );
    }

    for (const table of tables) {
      await postgres.query(
        `SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM ${quoteIdentifier(table)}`,
        [table],
      );
    }
    await postgres.query("COMMIT");
  } catch (error) {
    await postgres.query("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({ sqlitePath, copiedRows: counts, migratedImages: imageCache.size }, null, 2));
}

main()
  .catch((error) => {
    console.error("No se pudo completar la migración:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      new Promise((resolve) => sqlite.close(resolve)),
      postgres.end(),
    ]);
  });
