# Problemas Identificados con Make.com

- Se presentan inconvenientes en la conexión con bases de datos MySQL local
- Mas facilidad al utilizar servicios en la nube.

# Alternativa de Uso: N8N

- N8N se propone como una alternativa viable para la creación de flujos automatizados, ofreciendo un mayor control granular sobre cada operación.

# Créditos y Gestión de Modelos

- Se contempla el uso de modelos de lenguaje más modernos, lo que podría implicar una menor tasa de error.
- Considerar la necesidad de técnicas como *fine-tuning* o el uso de enfoques como RAG (*Retrieval-Augmented Generation*) para mejorar los resultados.

# Contenerización

- El uso de contenedores puede incrementar la complejidad en la configuración dependiendo el despliegue del sistema.

# Dependencia Total de Modelos de Lenguaje (LLM)

- Riesgos asociados:
  - Generación de alucinaciones (respuestas incorrectas pero coherentes).
  - Posibles fallos del servicio.
  - Incertidumbre ante errores del modelo: ¿cómo gestionarlos eficazmente?

# Integración de Múltiples Modelos en el Flujo

- Evaluar el uso de distintos modelos para tareas específicas, como:
  - Interpretación de lenguaje natural a SQL (NLP-SQL).
  - Agentes de ventas para la formulación de respuestas.

# Ejecución Local

- Debido a las limitaciones mencionadas, el flujo se ejecuta actualmente de manera local.
- Se recomienda explorar la posibilidad de establecer una conexión remota para reducir la complejidad de configuración y mejorar la modularidad del sistema.

