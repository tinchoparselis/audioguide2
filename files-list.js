// Lista de archivos de la aplicación (sin datos). La usan el service worker (precache)
// y el panel de administración (exportar sitio completo). Si agregás archivos, sumalos acá.
self.APP_FILES = [
  './', 'index.html', 'admin.html', 'manifest.webmanifest', 'sw.js', 'files-list.js',
  'css/app.css',
  'js/util.js', 'js/geo.js', 'js/model.js', 'js/db.js', 'js/zip.js', 'js/media-tools.js',
  'js/player.js', 'js/player-ui.js', 'js/mapa.js', 'js/datos.js', 'js/sw-registro.js',
  'js/estudiante.js', 'js/admin.js', 'js/admin-sim.js', 'js/exportar.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/LICENSE',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'vendor/qrcode/qrcode.js', 'vendor/qrcode/LICENSE',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
// Documentación incluida al exportar el sitio completo (no se precachea).
self.DOC_FILES = ['README.md', 'LICENSE', '.nojekyll', 'docs/GUIA-DOCENTE.md', 'docs/PRUEBAS.md', 'docs/LIMITACIONES.md'];
