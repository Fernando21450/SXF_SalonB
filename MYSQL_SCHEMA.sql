CREATE DATABASE IF NOT EXISTS il_salone
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE il_salone;

CREATE TABLE usuarios_admin (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  usuario VARCHAR(80) NOT NULL UNIQUE,
  contrasena_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(40) NOT NULL DEFAULT 'administrador'
);

CREATE TABLE clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  telefono VARCHAR(30) NOT NULL,
  correo VARCHAR(150) UNIQUE NULL,
  fecha_nacimiento DATE NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE servicios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT NULL,
  precio DECIMAL(10,2) NOT NULL DEFAULT 0,
  duracion_minutos INT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE vestidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  categoria VARCHAR(80) NULL,
  color VARCHAR(80) NULL,
  talla VARCHAR(40) NULL,
  precio DECIMAL(10,2) NOT NULL DEFAULT 0,
  imagen VARCHAR(255) NULL,
  disponible BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE reservas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  tipo ENUM('servicio','vestido') NOT NULL,
  servicio_id INT NULL,
  vestido_id INT NULL,
  sucursal VARCHAR(150) NULL,
  fecha DATE NOT NULL,
  hora TIME NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
  notas TEXT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (servicio_id) REFERENCES servicios(id),
  FOREIGN KEY (vestido_id) REFERENCES vestidos(id)
);

CREATE TABLE pagos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reserva_id INT NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  metodo VARCHAR(60) NULL,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reserva_id) REFERENCES reservas(id)
);

CREATE TABLE cupones_cumpleanos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL UNIQUE,
  descuento INT NOT NULL DEFAULT 15,
  fecha_generacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
