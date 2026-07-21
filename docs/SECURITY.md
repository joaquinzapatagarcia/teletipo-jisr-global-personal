# Seguridad y privacidad

El sistema público solo necesita las bases de IPP e IVE y resúmenes genéricos. El perfil personal detallado no forma parte de la rama activa ni de la salida pública. El validador bloquea campos conocidos de salud, ingresos, caja, familia, ubicaciones y red personal.

## Historial anterior

Eliminar `jisr-personal-profile.json` de la rama actual evita nuevas exposiciones, pero el archivo continúa en commits anteriores. Retirarlo de todo el historial requiere reescribir Git y forzar las referencias remotas.

Esa operación debe realizarse de forma deliberada porque cambia los identificadores de todos los commits y puede afectar clones o enlaces existentes. Después conviene comprobar que GitHub ya no encuentra el archivo y trabajar en adelante con secretos o almacenamiento privado.

No se han detectado credenciales en el archivo, pero sí información personal que justifica la limpieza histórica.
