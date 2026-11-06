# Pruebas

## A. Automáticas (ejecutadas durante el desarrollo)

| Prueba | Cómo | Resultado obtenido |
|---|---|---|
| Unitarias (12): distancia, histéresis, ruido GPS, precisión, deshabilitados, trazado, validación, normalización/saneo, spot compartido, slugs, ZIP | `node --test tests/unit.test.mjs` | 12/12 OK |
| Punta a punta (23 pasos) en Chromium headless con GPS y micrófono simulados por Playwright | servidor local + `node tests/e2e.mjs` | 23/23 OK |

Los pasos e2e cubren los criterios A, B, C, D, E, F, G, I y J, y la exportación de H (generar el ZIP del sitio
y de los datos y verificar su contenido). **No** cubren la publicación real en GitHub Pages ni teléfonos reales.

## B. Manual con GPS simulado (en el panel)

1. Abrí `admin.html` → **Simulador GPS** → “Recorrido ejemplo”, modo **Automático**.
2. Spot A → **Entrar**: el registro dice “ENTRADA … reproducción automática” y suena el tono.
3. Spot A → **Borde** (entre radio de entrada y salida): sigue DENTRO, sin nuevo evento (histéresis).
4. Spot B → **Entrar** mientras suena A: “EN ESPERA”; el reproductor muestra “En espera (1)”.
5. Spot B → **Salir** y **Entrar** otra vez: “no se duplica”.
6. Al terminar A, B comienza solo.
7. Spot A → **Entrar** de nuevo: se reactiva (reingreso tras haber salido).
8. Subí la **precisión simulada** a 100 m y probá Spot C: “lectura IGNORADA por baja precisión”.
9. Cambiá a **Manual**: al entrar, queda “Para escuchar” y hay que tocar ▶.
10. “Recorrer el trazado” (5×): verificá que cada spot se activa una sola vez.

## C. Manual con GPS real (en el lugar, con el sitio publicado en HTTPS)

Prepará un recorrido de prueba con 2–3 spots reales separados ≥ 80 m, radio 25/40 m.

| # | Paso | Esperado | Android/Chrome | iPhone/Safari |
|---|---|---|---|---|
| 1 | Abrir el enlace del curso con datos móviles | Lista de recorridos | ☐ | ☐ |
| 2 | Tocar una parada sin GPS | Se ve el texto y se puede escuchar | ☐ | ☐ |
| 3 | “Iniciar seguimiento GPS” | Pide permiso; muestra precisión ±m | ☐ | ☐ |
| 4 | Denegar el permiso (en otra prueba) | Mensaje claro; la lista sigue funcionando | ☐ | ☐ |
| 5 | Caminar hacia el spot 1 (modo automático) | Al entrar al radio, suena o pide ▶ | ☐ | ☐ |
| 6 | Quedarse 1 min dentro | No se repite | ☐ | ☐ |
| 7 | Ir al spot 2 mientras suena el 1 | Spot 2 “en espera”, arranca al terminar | ☐ | ☐ |
| 8 | Alejarse > radio de salida y volver | Se reactiva una vez | ☐ | ☐ |
| 9 | Modo manual + recargar la página | Se conserva la preferencia | ☐ | ☐ |
| 10 | Bloquear la pantalla 1 min y desbloquear | Anotar qué pasó (no garantizado) | ☐ | ☐ |
| 11 | “Guardar audios…”, modo avión, reproducir | Los audios suenan; el mapa puede no verse | ☐ | ☐ |

Anotá la precisión típica que muestra cada teléfono: si suele ser > 25 m, agrandá los radios.
