# Funcionalidades verificadas y limitaciones

## Verificado automáticamente (Chromium de escritorio, headless, con GPS/micrófono simulados)
- Crear, editar, duplicar y eliminar spots, recorridos y cursos, con confirmación en acciones destructivas.
- Validación de coordenadas, radios (salida > entrada), identificadores de curso únicos; saneo de texto importado.
- Subir audio MP3 y reproducirlo; grabar con MediaRecorder y recuperar la grabación tras recargar.
- Spot compartido por dos recorridos: el radio se edita una vez y se refleja en ambos; borrar un recorrido no borra spots.
- Trazado manual: agregar, insertar y eliminar vértices; trazados distintos por recorrido.
- Dos cursos con enlaces distintos y QR.
- Motor de proximidad: entrada, permanencia, zona de histéresis, salida, reingreso, cola sin duplicados,
  lecturas de baja precisión ignoradas.
- Preferencia automático/manual conservada al recargar.
- Texto accesible sin GPS ni audio; mensaje claro al denegar el permiso de ubicación.
- Service worker (Chromium): tras “Guardar audios para usar sin conexión”, la vista del estudiante recarga y reproduce audios en modo avión (sin mosaicos de mapa).
- Exportación del sitio completo y de los datos en ZIP con todos los medios; importación con rechazo de archivos inválidos.

## NO verificado (hacelo con docs/PRUEBAS.md)
- Funcionamiento en teléfonos reales (iPhone/Android), con GPS real y en exteriores.
- Publicación real en GitHub Pages (no se publicó ningún sitio; no hay URL publicada).
- Safari/Firefox (el código usa APIs estándar, pero no se probó en esos motores).
- Instalación como PWA en el teléfono (“Agregar a pantalla de inicio”).
- Visualización real de los mosaicos de OpenStreetMap (en el entorno de prueba se reemplazaron por un fondo liso).

## Restricciones de la plataforma (no se pueden “arreglar” desde una web)
- **GPS**: error típico de 5–50 m; peor entre edificios altos, árboles o interiores. Requiere HTTPS y permiso.
- **Segundo plano / pantalla bloqueada**: los navegadores móviles pueden suspender el GPS y el JavaScript. La app
  no garantiza activaciones con la pantalla bloqueada. Mitigación: “Mantener pantalla encendida” (Wake Lock,
  donde exista) y avisos visibles.
- **Reproducción automática**: los navegadores pueden bloquear el audio que no inicia con un toque. La app
  “desbloquea” el audio al tocar “Iniciar seguimiento”; si igual se bloquea, muestra “Tocá ▶”.
- **Formatos de grabación**: dependen del navegador (WebM/Opus en Chrome/Firefox, MP4/AAC en Safari). No se
  graba MP3 directamente. Alternativas: “Convertir a WAV” en el panel, Audacity o ffmpeg.
- **Almacenamiento local**: el navegador puede borrarlo (poco espacio, limpieza de datos, modo privado). Exportá respaldos.
- **Mapas sin conexión**: no se ofrecen (política de uso de tiles de OSM). Se pueden guardar audios e imágenes.
- **Privacidad**: los enlaces de curso no son control de acceso; todo lo publicado es público.
- **Edición multi-dispositivo**: no hay sincronización; para pasar a otra computadora, exportá e importá el ZIP.
- **Actualizaciones de la app**: el service worker sirve la interfaz cacheada y la actualiza en segundo plano;
  un cambio de código puede verse recién en la segunda carga.
