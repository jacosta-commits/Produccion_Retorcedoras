Project Produccion_Descargas {
  database_type: "SQLServer"
  Note: 'Programación y seguimiento de descargas por máquina y lado. OT proviene de Medidores_2023.dbo.VIEW_PRD_SCADA005.'
}

/* =========================
   MAESTROS
========================= */
Table RET_DGT_MAQUINAS {
  maquina_id int          [pk, increment]
  codigo     varchar(50)  [not null, unique]   // p.ej. "DONGTAI 4"
  nombre     varchar(100) [not null]
  codsol     varchar(50)  [not null]
  activo     bit          [not null, default: 1]
  Note: 'Catálogo de máquinas.'
}

Table RET_DGT_LADOS {
  lado_id  int         [pk, increment]         // 1,2,...
  nombre   varchar(20) [not null, unique]      // "A", "B" (o "Lado A", "Lado B")
  activo   bit         [not null, default: 1]
  Note: 'Maestro global de lados; todas las máquinas comparten estos lados.'
}

Table RET_DGT_TITULOS {
  titulo_id            int         [pk, increment]
  nombre               varchar(80) [not null, unique]  // p.ej. "108 NY"
  minutos_por_descarga int         [not null]          // 90 => 1h30
  activo               bit         [not null, default: 1]
  Note: 'Catálogo editable desde "Títulos".'
}

/* =========================
   ORDENES DE TRABAJO (vista externa, solo lectura)
   *Se mantiene el nombre real de la vista para compatibilidad*
========================= */
Table view_prd_scada005 {
  otcod    varchar(25) [pk]                         // mismo nombre que se referenciará
  ejeid    int
  empcod   char(2)
  canreq   decimal(15,4)
  caninv   decimal(15,4)
  procod   char(30)
  pronom   varchar(1000)
  ffigimp  bit
  fttcod   char(2)
  ctcod    char(10)
  lotcod   char(50)
  tracod   char(15)
  fecuscre datetime
  Note: 'Medidores_2023.dbo.VIEW_PRD_SCADA005 (SQL Server).'
}

/* =========================
   PROGRAMACIÓN
========================= */
Table RET_DGT_PROGRAMACIONES {
  programacion_id       int         [pk, increment]
  maquina_id            int         [not null, ref: > RET_DGT_MAQUINAS.maquina_id]
  lado_id               int         [not null, ref: > RET_DGT_LADOS.lado_id]          // A o B (por id)
  otcod                 varchar(25) [not null, ref: > view_prd_scada005.otcod]
  titulo_id             int         [not null, ref: > RET_DGT_TITULOS.titulo_id]
  fecha_hora_inicio     datetime    [not null]                                         // inicio del bloque
  descargas_programadas int         [not null]                                         // "# Descargas"

  Indexes {
    (maquina_id, lado_id, fecha_hora_inicio)
    (otcod)
  }

  Note: 'FIN estimado = fecha_hora_inicio + (descargas_programadas * titulos.minutos_por_descarga).'
}

/* =========================
   PLAN (editable por bloque)
========================= */
Table RET_DGT_PLAN_DESCARGAS {
  plan_descarga_id int       [pk, increment]
  programacion_id  int       [not null, ref: > RET_DGT_PROGRAMACIONES.programacion_id]
  secuencia        int       [not null]                       // 1..N
  fh_inicio_plan   datetime  [not null]                       // editable en medio de la descarga
  minutos_plan     int       [not null]                       // default = minutos del título; permite override
  fh_fin_plan      datetime  [not null]                       // recalculado por app/SQL

  Indexes { (programacion_id, secuencia) [unique] }
  Note: 'Si cambias inicio o minutos_plan, se recalcula FIN.'
}

/* =========================
   PRODUCCIÓN REAL
========================= */
Table RET_DGT_DESCARGAS_REALES {
  descarga_real_id int        [pk, increment]
  programacion_id  int        [ref: > RET_DGT_PROGRAMACIONES.programacion_id]         // puede ser NULL si no hay plan
  maquina_id       int        [not null, ref: > RET_DGT_MAQUINAS.maquina_id]
  lado_id          int        [not null, ref: > RET_DGT_LADOS.lado_id]
  secuencia        int
  fh_inicio_real   datetime   [not null]                                               // editable
  minutos_real     int                                                                        // si NULL, usar minutos del título
  fh_fin_real      datetime

  Indexes {
    (programacion_id, secuencia)
    (maquina_id, lado_id, fh_inicio_real)
  }
}
