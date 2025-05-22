-- Insertar clientes
INSERT INTO clientes (nombre, telefono, correo) VALUES
('Carlos Mendoza', '0991234567', 'carlos.mendoza@gmail.com'),
('Ana López', '0987654321', 'ana.lopez@hotmail.com'),
('Jorge Ramírez', '0971122334', 'jorge.ramirez@yahoo.com');

-- Insertar servicios
INSERT INTO servicios (nombre_servicio, descripcion, precio) VALUES
('Corte de cabello', 'Corte tradicional de cabello para hombres', 15.00),
('Afeitado clásico', 'Afeitado con navaja y tratamiento facial', 12.50),
('Arreglo de barba', 'Perfilado y arreglo de barba y bigote', 10.00),
('Tinturado', 'Aplicación de tinte para el cabello', 25.00);

-- Insertar barberos
INSERT INTO barberos (nombre, especialidad, disponible) VALUES
('Luis Fernández', 'Corte de cabello y afeitado', TRUE),
('María Gómez', 'Arreglo de barba y tinturado', TRUE),
('Javier Sánchez', 'Especialista en cortes modernos', FALSE);

-- Insertar citas
INSERT INTO citas (cliente_id, servicio_id, fecha, hora, estado, barbero_id) VALUES
(1, 1, '2025-05-25', '10:00:00', 'confirmada', 1),
(2, 3, '2025-05-26', '15:30:00', 'pendiente', 2),
(3, 2, '2025-05-27', '09:00:00', 'cancelada', NULL);