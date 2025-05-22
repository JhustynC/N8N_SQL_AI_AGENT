# Crear tablas MySQL

```SQL
CREATE DATABASE IF NOT EXISTS olympus_barberia;
USE olympus_barberia;

CREATE TABLE clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) NOT NULL UNIQUE,
    correo VARCHAR(100),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE servicios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre_servicio VARCHAR(100) NOT NULL,
    descripcion TEXT,
    precio DECIMAL(6,2) NOT NULL
);

CREATE TABLE barberos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    especialidad VARCHAR(100),
    disponible BOOLEAN DEFAULT TRUE
);

CREATE TABLE citas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    servicio_id INT NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    estado ENUM('pendiente', 'confirmada', 'cancelada') DEFAULT 'pendiente',
    barbero_id INT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    FOREIGN KEY (servicio_id) REFERENCES servicios(id) ON DELETE CASCADE,
    FOREIGN KEY (barbero_id) REFERENCES barberos(id) ON DELETE SET NULL
);
```
# Obtén la dirección IP de tu host. En Linux, puedes usar:

```bash
ip addr show docker0 | grep inet | awk '{ print $2 }' | cut -d/ -f1
```

# O

```bash
hostname -I
```

# Modelo de Prueba

```bash
models/gemini-2.5-flash-preview-05-20

```

# Eliminar carpeta del respositorio

```bash
git rm -r --cached nombre_de_la_carpeta
git commit -m "Eliminar carpeta no deseada del repositorio"
```

# ¿Y si quiero borrar también su historial completamente?

```bash
git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch nombre_de_la_carpeta" --prune-empty --tag-name-filter cat -- --all

git filter-repo --path nombre_de_la_carpeta --invert-paths
```

⚠️ Este tipo de limpieza reescribe la historia de Git, por lo tanto es destructiva y debes comunicar a otros colaboradores que vuelvan a clonar el repositorio.

# Entrar a un contenedor

````bash
 docker exec -it ollama_container /bin/bash
```