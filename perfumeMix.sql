--
-- PostgreSQL database dump
--

\restrict yTfF3xYEFwiV1tNgSdVRkgLwh7KwmVEOEAEhcjbhVj7UGwpTqRxoUEdEUPjCwPZ

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.4

-- Started on 2026-07-21 02:24:45 -04

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 221 (class 1259 OID 20441)
-- Name: auditoria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auditoria (
    id integer NOT NULL,
    accion character varying(50),
    detalle text,
    usuario character varying(50) DEFAULT 'Admin'::character varying,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_id integer,
    tienda_id integer
);


ALTER TABLE public.auditoria OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 20449)
-- Name: auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.auditoria_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auditoria_id_seq OWNER TO postgres;

--
-- TOC entry 4216 (class 0 OID 0)
-- Dependencies: 222
-- Name: auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.auditoria_id_seq OWNED BY public.auditoria.id;


--
-- TOC entry 223 (class 1259 OID 20450)
-- Name: botellas_estante; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.botellas_estante (
    id integer NOT NULL,
    producto_id integer,
    ubicacion character varying(20) DEFAULT 'PENDIENTE'::character varying,
    fila integer DEFAULT 1,
    posicion integer DEFAULT 0,
    porcentaje_actual integer DEFAULT 100,
    fecha_apertura timestamp without time zone DEFAULT now(),
    cantidad integer DEFAULT 1,
    estado character varying(20) DEFAULT 'ABIERTA'::character varying,
    tienda_id integer
);


ALTER TABLE public.botellas_estante OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 20461)
-- Name: botellas_estante_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.botellas_estante_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.botellas_estante_id_seq OWNER TO postgres;

--
-- TOC entry 4218 (class 0 OID 0)
-- Dependencies: 224
-- Name: botellas_estante_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.botellas_estante_id_seq OWNED BY public.botellas_estante.id;


--
-- TOC entry 225 (class 1259 OID 20462)
-- Name: cierres_caja; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cierres_caja (
    id integer NOT NULL,
    fecha_cierre timestamp without time zone DEFAULT now(),
    usuario_id integer,
    total_usd numeric(12,2),
    total_bs numeric(12,2),
    cantidad_ventas integer,
    detalles_json jsonb,
    notas text,
    tienda_id integer
);


ALTER TABLE public.cierres_caja OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 20469)
-- Name: cierres_caja_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cierres_caja_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cierres_caja_id_seq OWNER TO postgres;

--
-- TOC entry 4220 (class 0 OID 0)
-- Dependencies: 226
-- Name: cierres_caja_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cierres_caja_id_seq OWNED BY public.cierres_caja.id;


--
-- TOC entry 227 (class 1259 OID 20470)
-- Name: clientes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clientes (
    id integer NOT NULL,
    documento character varying(20) NOT NULL,
    nombre character varying(100) NOT NULL,
    direccion text,
    telefono character varying(50),
    email character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tienda_id integer
);


ALTER TABLE public.clientes OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 20479)
-- Name: clientes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.clientes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clientes_id_seq OWNER TO postgres;

--
-- TOC entry 4222 (class 0 OID 0)
-- Dependencies: 228
-- Name: clientes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.clientes_id_seq OWNED BY public.clientes.id;


--
-- TOC entry 229 (class 1259 OID 20480)
-- Name: compras_granel; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.compras_granel (
    id integer NOT NULL,
    proveedor_id integer,
    peso_kg numeric(10,2) NOT NULL,
    costo_total numeric(12,2) NOT NULL,
    fecha_registro timestamp without time zone DEFAULT now(),
    observaciones text,
    tienda_id integer
);


ALTER TABLE public.compras_granel OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 20489)
-- Name: compras_granel_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.compras_granel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.compras_granel_id_seq OWNER TO postgres;

--
-- TOC entry 4224 (class 0 OID 0)
-- Dependencies: 230
-- Name: compras_granel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.compras_granel_id_seq OWNED BY public.compras_granel.id;


--
-- TOC entry 231 (class 1259 OID 20490)
-- Name: configuracion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.configuracion (
    id integer NOT NULL,
    clave character varying(50) NOT NULL,
    valor character varying(255) DEFAULT true NOT NULL
);


ALTER TABLE public.configuracion OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 20497)
-- Name: configuracion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.configuracion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.configuracion_id_seq OWNER TO postgres;

--
-- TOC entry 4226 (class 0 OID 0)
-- Dependencies: 232
-- Name: configuracion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.configuracion_id_seq OWNED BY public.configuracion.id;


--
-- TOC entry 233 (class 1259 OID 20498)
-- Name: detalle_ventas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.detalle_ventas (
    id integer NOT NULL,
    venta_id integer,
    producto_id integer,
    cantidad integer NOT NULL,
    precio_unitario numeric(10,2) NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    lote_id integer,
    descripcion text,
    formula_id integer,
    costo_unitario_historico numeric(12,3) DEFAULT 0,
    tarifa_aplicada character varying(30) DEFAULT 'DETAL'::character varying,
    tamano character varying(50)
);


ALTER TABLE public.detalle_ventas OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 20507)
-- Name: detalle_ventas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.detalle_ventas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.detalle_ventas_id_seq OWNER TO postgres;

--
-- TOC entry 4228 (class 0 OID 0)
-- Dependencies: 234
-- Name: detalle_ventas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.detalle_ventas_id_seq OWNED BY public.detalle_ventas.id;


--
-- TOC entry 235 (class 1259 OID 20508)
-- Name: distribuciones_lote; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.distribuciones_lote (
    id integer NOT NULL,
    lote_maestro_id integer,
    producto_id integer,
    peso_asignado_kg numeric(10,2),
    "gramos_añadidos" numeric(10,2),
    fecha timestamp without time zone DEFAULT now(),
    fecha_distribucion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tienda_id integer
);


ALTER TABLE public.distribuciones_lote OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 20514)
-- Name: distribuciones_lote_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.distribuciones_lote_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.distribuciones_lote_id_seq OWNER TO postgres;

--
-- TOC entry 4230 (class 0 OID 0)
-- Dependencies: 236
-- Name: distribuciones_lote_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.distribuciones_lote_id_seq OWNED BY public.distribuciones_lote.id;


--
-- TOC entry 237 (class 1259 OID 20515)
-- Name: formulas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.formulas (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    volumen_total double precision NOT NULL,
    gramos_esencia double precision NOT NULL,
    gramos_fijador double precision NOT NULL,
    ml_alcohol double precision NOT NULL,
    puffs_fijador integer DEFAULT 0,
    precio numeric(10,2) DEFAULT 0,
    precio_mayor numeric(12,2) DEFAULT 0,
    cantidad_mayor integer DEFAULT 6,
    precio_gran_mayor numeric(12,2) DEFAULT 0,
    cantidad_gran_mayor integer DEFAULT 50,
    es_promocion boolean DEFAULT false,
    cantidad_promo integer DEFAULT 1,
    precio_promo numeric(10,2) DEFAULT 0,
    tienda_id integer,
    precio_bs numeric(10,2) DEFAULT 0,
    precio_mayor_bs numeric(10,2) DEFAULT 0,
    precio_gran_mayor_bs numeric(10,2) DEFAULT 0,
    precio_gramo_extra numeric(10,2) DEFAULT 0.00,
    precio_fijador_extra numeric(10,2) DEFAULT 0.00,
    precio_recarga numeric(10,2) DEFAULT 0.00
);


ALTER TABLE public.formulas OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 20536)
-- Name: formulas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.formulas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.formulas_id_seq OWNER TO postgres;

--
-- TOC entry 4232 (class 0 OID 0)
-- Dependencies: 238
-- Name: formulas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.formulas_id_seq OWNED BY public.formulas.id;


--
-- TOC entry 276 (class 1259 OID 20992)
-- Name: historial_auto_composicion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.historial_auto_composicion (
    id integer NOT NULL,
    producto_id integer,
    cantidad_requerida numeric(10,2) NOT NULL,
    cantidad_faltante_estante numeric(10,2) NOT NULL,
    cantidad_tomada_almacen numeric(10,2) NOT NULL,
    nota text NOT NULL,
    fecha timestamp without time zone DEFAULT now()
);


ALTER TABLE public.historial_auto_composicion OWNER TO postgres;

--
-- TOC entry 275 (class 1259 OID 20991)
-- Name: historial_auto_composicion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.historial_auto_composicion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historial_auto_composicion_id_seq OWNER TO postgres;

--
-- TOC entry 4234 (class 0 OID 0)
-- Dependencies: 275
-- Name: historial_auto_composicion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.historial_auto_composicion_id_seq OWNED BY public.historial_auto_composicion.id;


--
-- TOC entry 278 (class 1259 OID 21668)
-- Name: historial_cargas_inventario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.historial_cargas_inventario (
    id integer NOT NULL,
    fecha_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_id integer,
    tienda_id integer,
    proveedor character varying(255) DEFAULT 'No Especificado'::character varying,
    cantidad_articulos integer,
    inversion_total numeric(12,2) DEFAULT 0.00,
    precio_proyectado numeric(12,2) DEFAULT 0.00,
    rentabilidad_estimada numeric(12,2) DEFAULT 0.00,
    archivo_json jsonb,
    estado character varying(50) DEFAULT 'PROCESADO'::character varying
);


ALTER TABLE public.historial_cargas_inventario OWNER TO postgres;

--
-- TOC entry 277 (class 1259 OID 21667)
-- Name: historial_cargas_inventario_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.historial_cargas_inventario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historial_cargas_inventario_id_seq OWNER TO postgres;

--
-- TOC entry 4235 (class 0 OID 0)
-- Dependencies: 277
-- Name: historial_cargas_inventario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.historial_cargas_inventario_id_seq OWNED BY public.historial_cargas_inventario.id;


--
-- TOC entry 239 (class 1259 OID 20537)
-- Name: historial_movimientos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.historial_movimientos (
    id integer NOT NULL,
    producto_id integer,
    tipo_movimiento character varying(20),
    cantidad integer,
    stock_anterior integer,
    stock_nuevo integer,
    motivo character varying(255),
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_id integer,
    tienda_id integer
);


ALTER TABLE public.historial_movimientos OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 20542)
-- Name: historial_movimientos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.historial_movimientos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historial_movimientos_id_seq OWNER TO postgres;

--
-- TOC entry 4237 (class 0 OID 0)
-- Dependencies: 240
-- Name: historial_movimientos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.historial_movimientos_id_seq OWNED BY public.historial_movimientos.id;


--
-- TOC entry 274 (class 1259 OID 20975)
-- Name: historial_sincronizacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.historial_sincronizacion (
    id integer NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now(),
    cantidad_items integer,
    plataforma character varying(50) DEFAULT 'WEB/EXTERNA'::character varying,
    detalles_json jsonb,
    tienda_id integer
);


ALTER TABLE public.historial_sincronizacion OWNER TO postgres;

--
-- TOC entry 273 (class 1259 OID 20974)
-- Name: historial_sincronizacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.historial_sincronizacion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historial_sincronizacion_id_seq OWNER TO postgres;

--
-- TOC entry 4239 (class 0 OID 0)
-- Dependencies: 273
-- Name: historial_sincronizacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.historial_sincronizacion_id_seq OWNED BY public.historial_sincronizacion.id;


--
-- TOC entry 272 (class 1259 OID 20958)
-- Name: importaciones_excel; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.importaciones_excel (
    id integer NOT NULL,
    usuario_id integer,
    nombre_archivo character varying(255),
    fecha timestamp without time zone DEFAULT now(),
    detalles_json jsonb,
    estado character varying(50) DEFAULT 'APLICADO'::character varying,
    proveedor character varying(255) DEFAULT 'No Especificado'::character varying,
    cantidad_articulos numeric(12,2) DEFAULT 0,
    inversion_total numeric(12,2) DEFAULT 0,
    precio_proyectado numeric(12,2) DEFAULT 0,
    rentabilidad_estimada numeric(12,2) DEFAULT 0,
    excel_crudo_json jsonb
);


ALTER TABLE public.importaciones_excel OWNER TO postgres;

--
-- TOC entry 271 (class 1259 OID 20957)
-- Name: importaciones_excel_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.importaciones_excel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.importaciones_excel_id_seq OWNER TO postgres;

--
-- TOC entry 4241 (class 0 OID 0)
-- Dependencies: 271
-- Name: importaciones_excel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.importaciones_excel_id_seq OWNED BY public.importaciones_excel.id;


--
-- TOC entry 241 (class 1259 OID 20543)
-- Name: inventario_tiendas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventario_tiendas (
    id integer NOT NULL,
    producto_id integer NOT NULL,
    tienda_id integer NOT NULL,
    cantidad_almacen numeric(10,2) DEFAULT 0,
    cantidad_exhibicion numeric(10,2) DEFAULT 0,
    ubicacion_local character varying(50) DEFAULT 'Sin Asignar'::character varying,
    ultimo_movimiento timestamp without time zone DEFAULT now()
);


ALTER TABLE public.inventario_tiendas OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 20553)
-- Name: inventario_tiendas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventario_tiendas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventario_tiendas_id_seq OWNER TO postgres;

--
-- TOC entry 4243 (class 0 OID 0)
-- Dependencies: 242
-- Name: inventario_tiendas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventario_tiendas_id_seq OWNED BY public.inventario_tiendas.id;


--
-- TOC entry 243 (class 1259 OID 20554)
-- Name: lotes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lotes (
    id integer NOT NULL,
    producto_id integer,
    proveedor_id integer,
    codigo_lote character varying(50) NOT NULL,
    fecha_vencimiento date,
    costo_unitario numeric(10,2) NOT NULL,
    cantidad_inicial numeric(12,2) NOT NULL,
    cantidad_actual numeric(12,2) NOT NULL,
    fecha_ingreso timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    activo boolean DEFAULT true,
    numero_factura character varying(50),
    observaciones text,
    estado character varying(20) DEFAULT 'PROCESADO'::character varying,
    tienda_id integer
);


ALTER TABLE public.lotes OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 20567)
-- Name: lotes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lotes_id_seq OWNER TO postgres;

--
-- TOC entry 4245 (class 0 OID 0)
-- Dependencies: 244
-- Name: lotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lotes_id_seq OWNED BY public.lotes.id;


--
-- TOC entry 245 (class 1259 OID 20568)
-- Name: lotes_maestros; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lotes_maestros (
    id integer NOT NULL,
    factura character varying(100),
    peso_total_kg numeric(10,4) NOT NULL,
    peso_pendiente_kg numeric(10,4) NOT NULL,
    proveedor_id integer,
    fecha_registro timestamp without time zone DEFAULT now(),
    estado character varying(20) DEFAULT 'PROCESANDO'::character varying,
    fecha_compra date DEFAULT CURRENT_DATE,
    costo_total numeric(10,2) DEFAULT 0,
    fecha_reposicion date,
    tienda_id integer
);


ALTER TABLE public.lotes_maestros OWNER TO postgres;

--
-- TOC entry 246 (class 1259 OID 20578)
-- Name: lotes_maestros_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lotes_maestros_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lotes_maestros_id_seq OWNER TO postgres;

--
-- TOC entry 4247 (class 0 OID 0)
-- Dependencies: 246
-- Name: lotes_maestros_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lotes_maestros_id_seq OWNED BY public.lotes_maestros.id;


--
-- TOC entry 247 (class 1259 OID 20579)
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notificaciones (
    id integer NOT NULL,
    mensaje text NOT NULL,
    tipo character varying(20) DEFAULT 'INFO'::character varying,
    ruta character varying(255),
    leido boolean DEFAULT false,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tienda_id integer
);


ALTER TABLE public.notificaciones OWNER TO postgres;

--
-- TOC entry 248 (class 1259 OID 20589)
-- Name: notificaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.notificaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notificaciones_id_seq OWNER TO postgres;

--
-- TOC entry 4249 (class 0 OID 0)
-- Dependencies: 248
-- Name: notificaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.notificaciones_id_seq OWNED BY public.notificaciones.id;


--
-- TOC entry 280 (class 1259 OID 21763)
-- Name: ordenes_produccion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ordenes_produccion (
    id integer NOT NULL,
    codigo_orden character varying(50) NOT NULL,
    tienda_id integer,
    usuario_creador_id integer,
    usuario_cierre_id integer,
    formula_id integer,
    producto_base_id integer,
    producto_final_id integer,
    cantidad_planificada integer NOT NULL,
    cantidad_completada integer DEFAULT 0,
    cantidad_merma integer DEFAULT 0,
    estado character varying(20) DEFAULT 'PROCESANDO'::character varying,
    lote_fabricacion character varying(50),
    costo_unitario_real numeric(10,2) DEFAULT 0.00,
    inversion_total numeric(10,2) DEFAULT 0.00,
    notas_planificacion text,
    notas_cierre text,
    fecha_creacion timestamp without time zone DEFAULT now(),
    fecha_cierre timestamp without time zone,
    insumos_reservados jsonb,
    composicion_esencias jsonb DEFAULT '[]'::jsonb
);


ALTER TABLE public.ordenes_produccion OWNER TO postgres;

--
-- TOC entry 279 (class 1259 OID 21762)
-- Name: ordenes_produccion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ordenes_produccion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ordenes_produccion_id_seq OWNER TO postgres;

--
-- TOC entry 4250 (class 0 OID 0)
-- Dependencies: 279
-- Name: ordenes_produccion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ordenes_produccion_id_seq OWNED BY public.ordenes_produccion.id;


--
-- TOC entry 249 (class 1259 OID 20590)
-- Name: pagos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pagos (
    id integer NOT NULL,
    venta_id integer,
    metodo character varying(50) NOT NULL,
    moneda character varying(10) NOT NULL,
    monto numeric(12,2) NOT NULL,
    tasa_cambio numeric(12,2),
    referencia character varying(100)
);


ALTER TABLE public.pagos OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 20597)
-- Name: pagos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pagos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pagos_id_seq OWNER TO postgres;

--
-- TOC entry 4252 (class 0 OID 0)
-- Dependencies: 250
-- Name: pagos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pagos_id_seq OWNED BY public.pagos.id;


--
-- TOC entry 251 (class 1259 OID 20598)
-- Name: pedidos_borradores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pedidos_borradores (
    id integer NOT NULL,
    nombre_identificador character varying(255) NOT NULL,
    formula_id integer NOT NULL,
    items_json jsonb NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT now()
);


ALTER TABLE public.pedidos_borradores OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 20608)
-- Name: pedidos_borradores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pedidos_borradores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pedidos_borradores_id_seq OWNER TO postgres;

--
-- TOC entry 4254 (class 0 OID 0)
-- Dependencies: 252
-- Name: pedidos_borradores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pedidos_borradores_id_seq OWNED BY public.pedidos_borradores.id;


--
-- TOC entry 253 (class 1259 OID 20609)
-- Name: productos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.productos (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    marca character varying(50),
    stock_unidades integer DEFAULT 0,
    unidades_por_caja integer DEFAULT 12,
    peso_unitario_kg numeric(10,3),
    precio_costo numeric(10,2),
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    codigo character varying(50),
    tamano character varying(50),
    activo boolean DEFAULT true,
    categoria character varying(50),
    notas text,
    unidad_medida character varying(20) DEFAULT 'UNIDAD'::character varying,
    stock_minimo integer DEFAULT 5,
    u_caja integer DEFAULT 1,
    costo numeric(10,2) DEFAULT 0,
    precio_venta numeric(10,2) DEFAULT 0,
    ubicacion character varying(100),
    descripcion text,
    fecha_vencimiento date,
    ganancia numeric(10,2) DEFAULT 30,
    stock_estante numeric(12,2) DEFAULT 0,
    contenido_gramos numeric(12,2) DEFAULT 0,
    unidad_contenido character varying(20) DEFAULT 'g'::character varying,
    tienda_id integer,
    genero character varying(30) DEFAULT 'UNISEX'::character varying,
    stock_reservado numeric(10,2) DEFAULT 0.00,
    es_producto_terminado boolean DEFAULT false
);

ALTER TABLE ONLY public.productos FORCE ROW LEVEL SECURITY;


ALTER TABLE public.productos OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 20629)
-- Name: productos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.productos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.productos_id_seq OWNER TO postgres;

--
-- TOC entry 4256 (class 0 OID 0)
-- Dependencies: 254
-- Name: productos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.productos_id_seq OWNED BY public.productos.id;


--
-- TOC entry 255 (class 1259 OID 20630)
-- Name: promociones_combos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.promociones_combos (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    formula_id integer,
    cantidad_necesaria integer NOT NULL,
    precio_final_combo numeric(12,2) NOT NULL,
    activo boolean DEFAULT true
);


ALTER TABLE public.promociones_combos OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 20638)
-- Name: promociones_combos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.promociones_combos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.promociones_combos_id_seq OWNER TO postgres;

--
-- TOC entry 4258 (class 0 OID 0)
-- Dependencies: 256
-- Name: promociones_combos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.promociones_combos_id_seq OWNED BY public.promociones_combos.id;


--
-- TOC entry 257 (class 1259 OID 20639)
-- Name: proveedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.proveedores (
    id integer NOT NULL,
    documento character varying(20) NOT NULL,
    empresa character varying(100) NOT NULL,
    contacto character varying(100),
    telefono character varying(50),
    email character varying(100),
    direccion text
);


ALTER TABLE public.proveedores OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 20647)
-- Name: proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.proveedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.proveedores_id_seq OWNER TO postgres;

--
-- TOC entry 4260 (class 0 OID 0)
-- Dependencies: 258
-- Name: proveedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.proveedores_id_seq OWNED BY public.proveedores.id;


--
-- TOC entry 259 (class 1259 OID 20648)
-- Name: recepciones_granel; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recepciones_granel (
    id integer NOT NULL,
    proveedor_id integer,
    numero_factura character varying(50),
    peso_inicial_kg numeric(10,4) NOT NULL,
    peso_actual_kg numeric(10,4) NOT NULL,
    observaciones text,
    estado character varying(20) DEFAULT 'PENDIENTE'::character varying,
    fecha_recepcion timestamp without time zone DEFAULT now()
);


ALTER TABLE public.recepciones_granel OWNER TO postgres;

--
-- TOC entry 260 (class 1259 OID 20658)
-- Name: recepciones_granel_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.recepciones_granel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.recepciones_granel_id_seq OWNER TO postgres;

--
-- TOC entry 4262 (class 0 OID 0)
-- Dependencies: 260
-- Name: recepciones_granel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.recepciones_granel_id_seq OWNED BY public.recepciones_granel.id;


--
-- TOC entry 261 (class 1259 OID 20659)
-- Name: sesiones_caja; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sesiones_caja (
    id integer NOT NULL,
    usuario_id integer,
    fecha_apertura timestamp without time zone DEFAULT now(),
    monto_inicial numeric(12,2) DEFAULT 0,
    fecha_cierre timestamp without time zone,
    monto_final_declarado numeric(12,2) DEFAULT 0,
    monto_sistema_calculado numeric(12,2) DEFAULT 0,
    diferencia numeric(12,2) DEFAULT 0,
    estado character varying(20) DEFAULT 'ABIERTA'::character varying,
    tienda_id integer
);


ALTER TABLE public.sesiones_caja OWNER TO postgres;

--
-- TOC entry 262 (class 1259 OID 20669)
-- Name: sesiones_caja_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sesiones_caja_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sesiones_caja_id_seq OWNER TO postgres;

--
-- TOC entry 4264 (class 0 OID 0)
-- Dependencies: 262
-- Name: sesiones_caja_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sesiones_caja_id_seq OWNED BY public.sesiones_caja.id;


--
-- TOC entry 263 (class 1259 OID 20670)
-- Name: tiendas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tiendas (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    direccion text,
    telefono character varying(20),
    es_principal boolean DEFAULT false,
    activo boolean DEFAULT true,
    creado_en timestamp without time zone DEFAULT now(),
    url character varying(255)
);

ALTER TABLE ONLY public.tiendas FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tiendas OWNER TO postgres;

--
-- TOC entry 264 (class 1259 OID 20680)
-- Name: tiendas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tiendas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tiendas_id_seq OWNER TO postgres;

--
-- TOC entry 4266 (class 0 OID 0)
-- Dependencies: 264
-- Name: tiendas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tiendas_id_seq OWNED BY public.tiendas.id;


--
-- TOC entry 265 (class 1259 OID 20681)
-- Name: usuarios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    password character varying(255) NOT NULL,
    rol character varying(20) DEFAULT 'vendedor'::character varying,
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    activo boolean DEFAULT true,
    direccion character varying(255),
    token_sesion text,
    intentos_fallidos integer DEFAULT 0,
    bloqueado_hasta timestamp without time zone,
    tienda_id integer,
    "currentHashedToken" text,
    currenthashedtoken text
);


ALTER TABLE public.usuarios OWNER TO postgres;

--
-- TOC entry 266 (class 1259 OID 20694)
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_id_seq OWNER TO postgres;

--
-- TOC entry 4268 (class 0 OID 0)
-- Dependencies: 266
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- TOC entry 267 (class 1259 OID 20695)
-- Name: ventas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ventas (
    id integer NOT NULL,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total numeric(10,2) NOT NULL,
    cliente_id integer DEFAULT 1,
    usuario_id integer,
    tienda_id integer
);


ALTER TABLE public.ventas OWNER TO postgres;

--
-- TOC entry 268 (class 1259 OID 20702)
-- Name: ventas_anuladas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ventas_anuladas (
    id integer NOT NULL,
    venta_original_id integer,
    fecha_venta timestamp without time zone,
    fecha_anulacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_anula_id integer,
    cliente_nombre character varying(100),
    total_venta numeric(10,2),
    detalles_json jsonb,
    pagos_json jsonb,
    motivo text,
    venta_json jsonb
);


ALTER TABLE public.ventas_anuladas OWNER TO postgres;

--
-- TOC entry 269 (class 1259 OID 20709)
-- Name: ventas_anuladas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ventas_anuladas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ventas_anuladas_id_seq OWNER TO postgres;

--
-- TOC entry 4271 (class 0 OID 0)
-- Dependencies: 269
-- Name: ventas_anuladas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ventas_anuladas_id_seq OWNED BY public.ventas_anuladas.id;


--
-- TOC entry 270 (class 1259 OID 20710)
-- Name: ventas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ventas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ventas_id_seq OWNER TO postgres;

--
-- TOC entry 4272 (class 0 OID 0)
-- Dependencies: 270
-- Name: ventas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ventas_id_seq OWNED BY public.ventas.id;


--
-- TOC entry 3800 (class 2604 OID 20711)
-- Name: auditoria id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria ALTER COLUMN id SET DEFAULT nextval('public.auditoria_id_seq'::regclass);


--
-- TOC entry 3803 (class 2604 OID 20712)
-- Name: botellas_estante id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.botellas_estante ALTER COLUMN id SET DEFAULT nextval('public.botellas_estante_id_seq'::regclass);


--
-- TOC entry 3811 (class 2604 OID 20713)
-- Name: cierres_caja id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cierres_caja ALTER COLUMN id SET DEFAULT nextval('public.cierres_caja_id_seq'::regclass);


--
-- TOC entry 3813 (class 2604 OID 20714)
-- Name: clientes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id SET DEFAULT nextval('public.clientes_id_seq'::regclass);


--
-- TOC entry 3815 (class 2604 OID 20715)
-- Name: compras_granel id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras_granel ALTER COLUMN id SET DEFAULT nextval('public.compras_granel_id_seq'::regclass);


--
-- TOC entry 3817 (class 2604 OID 20716)
-- Name: configuracion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configuracion ALTER COLUMN id SET DEFAULT nextval('public.configuracion_id_seq'::regclass);


--
-- TOC entry 3819 (class 2604 OID 20717)
-- Name: detalle_ventas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalle_ventas ALTER COLUMN id SET DEFAULT nextval('public.detalle_ventas_id_seq'::regclass);


--
-- TOC entry 3822 (class 2604 OID 20718)
-- Name: distribuciones_lote id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distribuciones_lote ALTER COLUMN id SET DEFAULT nextval('public.distribuciones_lote_id_seq'::regclass);


--
-- TOC entry 3825 (class 2604 OID 20719)
-- Name: formulas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.formulas ALTER COLUMN id SET DEFAULT nextval('public.formulas_id_seq'::regclass);


--
-- TOC entry 3919 (class 2604 OID 20995)
-- Name: historial_auto_composicion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_auto_composicion ALTER COLUMN id SET DEFAULT nextval('public.historial_auto_composicion_id_seq'::regclass);


--
-- TOC entry 3921 (class 2604 OID 21671)
-- Name: historial_cargas_inventario id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_cargas_inventario ALTER COLUMN id SET DEFAULT nextval('public.historial_cargas_inventario_id_seq'::regclass);


--
-- TOC entry 3841 (class 2604 OID 20720)
-- Name: historial_movimientos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_movimientos ALTER COLUMN id SET DEFAULT nextval('public.historial_movimientos_id_seq'::regclass);


--
-- TOC entry 3916 (class 2604 OID 20978)
-- Name: historial_sincronizacion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_sincronizacion ALTER COLUMN id SET DEFAULT nextval('public.historial_sincronizacion_id_seq'::regclass);


--
-- TOC entry 3908 (class 2604 OID 20961)
-- Name: importaciones_excel id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.importaciones_excel ALTER COLUMN id SET DEFAULT nextval('public.importaciones_excel_id_seq'::regclass);


--
-- TOC entry 3843 (class 2604 OID 20721)
-- Name: inventario_tiendas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario_tiendas ALTER COLUMN id SET DEFAULT nextval('public.inventario_tiendas_id_seq'::regclass);


--
-- TOC entry 3848 (class 2604 OID 20722)
-- Name: lotes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes ALTER COLUMN id SET DEFAULT nextval('public.lotes_id_seq'::regclass);


--
-- TOC entry 3852 (class 2604 OID 20723)
-- Name: lotes_maestros id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes_maestros ALTER COLUMN id SET DEFAULT nextval('public.lotes_maestros_id_seq'::regclass);


--
-- TOC entry 3857 (class 2604 OID 20724)
-- Name: notificaciones id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notificaciones ALTER COLUMN id SET DEFAULT nextval('public.notificaciones_id_seq'::regclass);


--
-- TOC entry 3928 (class 2604 OID 21766)
-- Name: ordenes_produccion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion ALTER COLUMN id SET DEFAULT nextval('public.ordenes_produccion_id_seq'::regclass);


--
-- TOC entry 3861 (class 2604 OID 20725)
-- Name: pagos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos ALTER COLUMN id SET DEFAULT nextval('public.pagos_id_seq'::regclass);


--
-- TOC entry 3862 (class 2604 OID 20726)
-- Name: pedidos_borradores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedidos_borradores ALTER COLUMN id SET DEFAULT nextval('public.pedidos_borradores_id_seq'::regclass);


--
-- TOC entry 3864 (class 2604 OID 20727)
-- Name: productos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos ALTER COLUMN id SET DEFAULT nextval('public.productos_id_seq'::regclass);


--
-- TOC entry 3881 (class 2604 OID 20728)
-- Name: promociones_combos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.promociones_combos ALTER COLUMN id SET DEFAULT nextval('public.promociones_combos_id_seq'::regclass);


--
-- TOC entry 3883 (class 2604 OID 20729)
-- Name: proveedores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores ALTER COLUMN id SET DEFAULT nextval('public.proveedores_id_seq'::regclass);


--
-- TOC entry 3884 (class 2604 OID 20730)
-- Name: recepciones_granel id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recepciones_granel ALTER COLUMN id SET DEFAULT nextval('public.recepciones_granel_id_seq'::regclass);


--
-- TOC entry 3887 (class 2604 OID 20731)
-- Name: sesiones_caja id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sesiones_caja ALTER COLUMN id SET DEFAULT nextval('public.sesiones_caja_id_seq'::regclass);


--
-- TOC entry 3894 (class 2604 OID 20732)
-- Name: tiendas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tiendas ALTER COLUMN id SET DEFAULT nextval('public.tiendas_id_seq'::regclass);


--
-- TOC entry 3898 (class 2604 OID 20733)
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- TOC entry 3903 (class 2604 OID 20734)
-- Name: ventas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ventas ALTER COLUMN id SET DEFAULT nextval('public.ventas_id_seq'::regclass);


--
-- TOC entry 3906 (class 2604 OID 20735)
-- Name: ventas_anuladas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ventas_anuladas ALTER COLUMN id SET DEFAULT nextval('public.ventas_anuladas_id_seq'::regclass);


--
-- TOC entry 3937 (class 2606 OID 20737)
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- TOC entry 3940 (class 2606 OID 20739)
-- Name: botellas_estante botellas_estante_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.botellas_estante
    ADD CONSTRAINT botellas_estante_pkey PRIMARY KEY (id);


--
-- TOC entry 3943 (class 2606 OID 20741)
-- Name: cierres_caja cierres_caja_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cierres_caja
    ADD CONSTRAINT cierres_caja_pkey PRIMARY KEY (id);


--
-- TOC entry 3945 (class 2606 OID 20743)
-- Name: clientes clientes_documento_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_documento_key UNIQUE (documento);


--
-- TOC entry 3947 (class 2606 OID 20745)
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- TOC entry 3949 (class 2606 OID 20747)
-- Name: compras_granel compras_granel_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras_granel
    ADD CONSTRAINT compras_granel_pkey PRIMARY KEY (id);


--
-- TOC entry 3951 (class 2606 OID 20749)
-- Name: configuracion configuracion_clave_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT configuracion_clave_key UNIQUE (clave);


--
-- TOC entry 3953 (class 2606 OID 20751)
-- Name: configuracion configuracion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT configuracion_pkey PRIMARY KEY (id);


--
-- TOC entry 3955 (class 2606 OID 20753)
-- Name: detalle_ventas detalle_ventas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_pkey PRIMARY KEY (id);


--
-- TOC entry 3957 (class 2606 OID 20755)
-- Name: distribuciones_lote distribuciones_lote_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distribuciones_lote
    ADD CONSTRAINT distribuciones_lote_pkey PRIMARY KEY (id);


--
-- TOC entry 3959 (class 2606 OID 20757)
-- Name: formulas formulas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.formulas
    ADD CONSTRAINT formulas_pkey PRIMARY KEY (id);


--
-- TOC entry 4012 (class 2606 OID 21005)
-- Name: historial_auto_composicion historial_auto_composicion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_auto_composicion
    ADD CONSTRAINT historial_auto_composicion_pkey PRIMARY KEY (id);


--
-- TOC entry 4014 (class 2606 OID 21682)
-- Name: historial_cargas_inventario historial_cargas_inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_cargas_inventario
    ADD CONSTRAINT historial_cargas_inventario_pkey PRIMARY KEY (id);


--
-- TOC entry 3961 (class 2606 OID 20759)
-- Name: historial_movimientos historial_movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_movimientos
    ADD CONSTRAINT historial_movimientos_pkey PRIMARY KEY (id);


--
-- TOC entry 4010 (class 2606 OID 20985)
-- Name: historial_sincronizacion historial_sincronizacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_sincronizacion
    ADD CONSTRAINT historial_sincronizacion_pkey PRIMARY KEY (id);


--
-- TOC entry 4008 (class 2606 OID 20968)
-- Name: importaciones_excel importaciones_excel_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.importaciones_excel
    ADD CONSTRAINT importaciones_excel_pkey PRIMARY KEY (id);


--
-- TOC entry 3965 (class 2606 OID 20761)
-- Name: inventario_tiendas inventario_tiendas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario_tiendas
    ADD CONSTRAINT inventario_tiendas_pkey PRIMARY KEY (id);


--
-- TOC entry 3971 (class 2606 OID 20763)
-- Name: lotes_maestros lotes_maestros_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes_maestros
    ADD CONSTRAINT lotes_maestros_pkey PRIMARY KEY (id);


--
-- TOC entry 3969 (class 2606 OID 20765)
-- Name: lotes lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_pkey PRIMARY KEY (id);


--
-- TOC entry 3974 (class 2606 OID 20767)
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- TOC entry 4016 (class 2606 OID 21781)
-- Name: ordenes_produccion ordenes_produccion_codigo_orden_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_codigo_orden_key UNIQUE (codigo_orden);


--
-- TOC entry 4018 (class 2606 OID 21779)
-- Name: ordenes_produccion ordenes_produccion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_pkey PRIMARY KEY (id);


--
-- TOC entry 3976 (class 2606 OID 20769)
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- TOC entry 3978 (class 2606 OID 20771)
-- Name: pedidos_borradores pedidos_borradores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedidos_borradores
    ADD CONSTRAINT pedidos_borradores_pkey PRIMARY KEY (id);


--
-- TOC entry 3981 (class 2606 OID 20773)
-- Name: productos productos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_codigo_key UNIQUE (codigo);


--
-- TOC entry 3983 (class 2606 OID 20775)
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id);


--
-- TOC entry 3985 (class 2606 OID 20777)
-- Name: promociones_combos promociones_combos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.promociones_combos
    ADD CONSTRAINT promociones_combos_pkey PRIMARY KEY (id);


--
-- TOC entry 3987 (class 2606 OID 20779)
-- Name: proveedores proveedores_documento_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_documento_key UNIQUE (documento);


--
-- TOC entry 3989 (class 2606 OID 20781)
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- TOC entry 3991 (class 2606 OID 20783)
-- Name: recepciones_granel recepciones_granel_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recepciones_granel
    ADD CONSTRAINT recepciones_granel_pkey PRIMARY KEY (id);


--
-- TOC entry 3993 (class 2606 OID 20785)
-- Name: sesiones_caja sesiones_caja_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sesiones_caja
    ADD CONSTRAINT sesiones_caja_pkey PRIMARY KEY (id);


--
-- TOC entry 3995 (class 2606 OID 20787)
-- Name: tiendas tiendas_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tiendas
    ADD CONSTRAINT tiendas_nombre_key UNIQUE (nombre);


--
-- TOC entry 3997 (class 2606 OID 20789)
-- Name: tiendas tiendas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tiendas
    ADD CONSTRAINT tiendas_pkey PRIMARY KEY (id);


--
-- TOC entry 3967 (class 2606 OID 20791)
-- Name: inventario_tiendas unique_producto_tienda; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario_tiendas
    ADD CONSTRAINT unique_producto_tienda UNIQUE (producto_id, tienda_id);


--
-- TOC entry 3999 (class 2606 OID 20793)
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- TOC entry 4001 (class 2606 OID 20795)
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- TOC entry 4006 (class 2606 OID 20797)
-- Name: ventas_anuladas ventas_anuladas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ventas_anuladas
    ADD CONSTRAINT ventas_anuladas_pkey PRIMARY KEY (id);


--
-- TOC entry 4004 (class 2606 OID 20799)
-- Name: ventas ventas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_pkey PRIMARY KEY (id);


--
-- TOC entry 3938 (class 1259 OID 20800)
-- Name: idx_auditoria_usuario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_auditoria_usuario ON public.auditoria USING btree (usuario_id);


--
-- TOC entry 3941 (class 1259 OID 20801)
-- Name: idx_botellas_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_botellas_estado ON public.botellas_estante USING btree (producto_id, estado);


--
-- TOC entry 3962 (class 1259 OID 20802)
-- Name: idx_inv_producto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_producto ON public.inventario_tiendas USING btree (producto_id);


--
-- TOC entry 3963 (class 1259 OID 20803)
-- Name: idx_inv_tienda; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_tienda ON public.inventario_tiendas USING btree (tienda_id);


--
-- TOC entry 3972 (class 1259 OID 20804)
-- Name: idx_notif_leido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notif_leido ON public.notificaciones USING btree (leido);


--
-- TOC entry 3979 (class 1259 OID 20805)
-- Name: idx_productos_estante; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_productos_estante ON public.productos USING btree (stock_estante);


--
-- TOC entry 4002 (class 1259 OID 20806)
-- Name: idx_ventas_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ventas_fecha ON public.ventas USING btree (fecha);


--
-- TOC entry 4019 (class 2606 OID 20807)
-- Name: auditoria auditoria_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4020 (class 2606 OID 20812)
-- Name: auditoria auditoria_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 4021 (class 2606 OID 20817)
-- Name: botellas_estante botellas_estante_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.botellas_estante
    ADD CONSTRAINT botellas_estante_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- TOC entry 4022 (class 2606 OID 20822)
-- Name: botellas_estante botellas_estante_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.botellas_estante
    ADD CONSTRAINT botellas_estante_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4023 (class 2606 OID 20827)
-- Name: cierres_caja cierres_caja_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cierres_caja
    ADD CONSTRAINT cierres_caja_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4024 (class 2606 OID 20832)
-- Name: clientes clientes_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4025 (class 2606 OID 20837)
-- Name: compras_granel compras_granel_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras_granel
    ADD CONSTRAINT compras_granel_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4026 (class 2606 OID 20842)
-- Name: detalle_ventas detalle_ventas_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id);


--
-- TOC entry 4027 (class 2606 OID 20847)
-- Name: detalle_ventas detalle_ventas_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- TOC entry 4028 (class 2606 OID 20852)
-- Name: detalle_ventas detalle_ventas_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id);


--
-- TOC entry 4029 (class 2606 OID 20857)
-- Name: distribuciones_lote distribuciones_lote_lote_maestro_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distribuciones_lote
    ADD CONSTRAINT distribuciones_lote_lote_maestro_id_fkey FOREIGN KEY (lote_maestro_id) REFERENCES public.lotes_maestros(id);


--
-- TOC entry 4030 (class 2606 OID 20862)
-- Name: distribuciones_lote distribuciones_lote_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distribuciones_lote
    ADD CONSTRAINT distribuciones_lote_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- TOC entry 4031 (class 2606 OID 20867)
-- Name: distribuciones_lote distribuciones_lote_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distribuciones_lote
    ADD CONSTRAINT distribuciones_lote_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4049 (class 2606 OID 21040)
-- Name: historial_sincronizacion fk_historial_sincronizacion_tiendas; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_sincronizacion
    ADD CONSTRAINT fk_historial_sincronizacion_tiendas FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id) ON DELETE SET NULL;


--
-- TOC entry 4032 (class 2606 OID 20872)
-- Name: formulas formulas_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.formulas
    ADD CONSTRAINT formulas_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4051 (class 2606 OID 21006)
-- Name: historial_auto_composicion historial_auto_composicion_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_auto_composicion
    ADD CONSTRAINT historial_auto_composicion_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- TOC entry 4033 (class 2606 OID 20877)
-- Name: historial_movimientos historial_movimientos_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_movimientos
    ADD CONSTRAINT historial_movimientos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- TOC entry 4034 (class 2606 OID 20882)
-- Name: historial_movimientos historial_movimientos_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_movimientos
    ADD CONSTRAINT historial_movimientos_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4050 (class 2606 OID 20986)
-- Name: historial_sincronizacion historial_sincronizacion_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_sincronizacion
    ADD CONSTRAINT historial_sincronizacion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 4048 (class 2606 OID 20969)
-- Name: importaciones_excel importaciones_excel_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.importaciones_excel
    ADD CONSTRAINT importaciones_excel_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 4035 (class 2606 OID 20887)
-- Name: inventario_tiendas inventario_tiendas_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario_tiendas
    ADD CONSTRAINT inventario_tiendas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- TOC entry 4036 (class 2606 OID 20892)
-- Name: inventario_tiendas inventario_tiendas_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario_tiendas
    ADD CONSTRAINT inventario_tiendas_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id) ON DELETE CASCADE;


--
-- TOC entry 4039 (class 2606 OID 20897)
-- Name: lotes_maestros lotes_maestros_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes_maestros
    ADD CONSTRAINT lotes_maestros_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4037 (class 2606 OID 20902)
-- Name: lotes lotes_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- TOC entry 4038 (class 2606 OID 20907)
-- Name: lotes lotes_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4040 (class 2606 OID 20912)
-- Name: notificaciones notificaciones_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4052 (class 2606 OID 21797)
-- Name: ordenes_produccion ordenes_produccion_formula_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id);


--
-- TOC entry 4053 (class 2606 OID 21802)
-- Name: ordenes_produccion ordenes_produccion_producto_base_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_producto_base_id_fkey FOREIGN KEY (producto_base_id) REFERENCES public.productos(id);


--
-- TOC entry 4054 (class 2606 OID 21807)
-- Name: ordenes_produccion ordenes_produccion_producto_final_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_producto_final_id_fkey FOREIGN KEY (producto_final_id) REFERENCES public.productos(id);


--
-- TOC entry 4055 (class 2606 OID 21782)
-- Name: ordenes_produccion ordenes_produccion_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4056 (class 2606 OID 21792)
-- Name: ordenes_produccion ordenes_produccion_usuario_cierre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_usuario_cierre_id_fkey FOREIGN KEY (usuario_cierre_id) REFERENCES public.usuarios(id);


--
-- TOC entry 4057 (class 2606 OID 21787)
-- Name: ordenes_produccion ordenes_produccion_usuario_creador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_produccion
    ADD CONSTRAINT ordenes_produccion_usuario_creador_id_fkey FOREIGN KEY (usuario_creador_id) REFERENCES public.usuarios(id);


--
-- TOC entry 4041 (class 2606 OID 20917)
-- Name: pagos pagos_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id);


--
-- TOC entry 4042 (class 2606 OID 20922)
-- Name: productos productos_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4043 (class 2606 OID 20927)
-- Name: promociones_combos promociones_combos_formula_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.promociones_combos
    ADD CONSTRAINT promociones_combos_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES public.formulas(id);


--
-- TOC entry 4044 (class 2606 OID 20932)
-- Name: sesiones_caja sesiones_caja_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sesiones_caja
    ADD CONSTRAINT sesiones_caja_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4045 (class 2606 OID 20937)
-- Name: usuarios usuarios_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4046 (class 2606 OID 20942)
-- Name: ventas ventas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- TOC entry 4047 (class 2606 OID 20947)
-- Name: ventas ventas_tienda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id);


--
-- TOC entry 4209 (class 3256 OID 21039)
-- Name: productos Aislamiento por tienda local; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Aislamiento por tienda local" ON public.productos USING (((tienda_id = public.get_user_tienda_id()) OR public.is_developer())) WITH CHECK (((tienda_id = public.get_user_tienda_id()) OR public.is_developer()));


--
-- TOC entry 4208 (class 3256 OID 21038)
-- Name: tiendas Aperturar tiendas local; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Aperturar tiendas local" ON public.tiendas FOR INSERT WITH CHECK (public.is_developer());


--
-- TOC entry 4207 (class 3256 OID 21037)
-- Name: tiendas Ver tiendas local; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Ver tiendas local" ON public.tiendas FOR SELECT USING (true);


--
-- TOC entry 4205 (class 0 OID 20609)
-- Dependencies: 253
-- Name: productos; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4206 (class 0 OID 20670)
-- Dependencies: 263
-- Name: tiendas; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tiendas ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4215 (class 0 OID 0)
-- Dependencies: 221
-- Name: TABLE auditoria; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auditoria TO authenticated;


--
-- TOC entry 4217 (class 0 OID 0)
-- Dependencies: 223
-- Name: TABLE botellas_estante; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.botellas_estante TO authenticated;


--
-- TOC entry 4219 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE cierres_caja; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cierres_caja TO authenticated;


--
-- TOC entry 4221 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE clientes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.clientes TO authenticated;


--
-- TOC entry 4223 (class 0 OID 0)
-- Dependencies: 229
-- Name: TABLE compras_granel; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.compras_granel TO authenticated;


--
-- TOC entry 4225 (class 0 OID 0)
-- Dependencies: 231
-- Name: TABLE configuracion; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.configuracion TO authenticated;


--
-- TOC entry 4227 (class 0 OID 0)
-- Dependencies: 233
-- Name: TABLE detalle_ventas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.detalle_ventas TO authenticated;


--
-- TOC entry 4229 (class 0 OID 0)
-- Dependencies: 235
-- Name: TABLE distribuciones_lote; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.distribuciones_lote TO authenticated;


--
-- TOC entry 4231 (class 0 OID 0)
-- Dependencies: 237
-- Name: TABLE formulas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.formulas TO authenticated;


--
-- TOC entry 4233 (class 0 OID 0)
-- Dependencies: 276
-- Name: TABLE historial_auto_composicion; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.historial_auto_composicion TO authenticated;


--
-- TOC entry 4236 (class 0 OID 0)
-- Dependencies: 239
-- Name: TABLE historial_movimientos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.historial_movimientos TO authenticated;


--
-- TOC entry 4238 (class 0 OID 0)
-- Dependencies: 274
-- Name: TABLE historial_sincronizacion; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.historial_sincronizacion TO authenticated;


--
-- TOC entry 4240 (class 0 OID 0)
-- Dependencies: 272
-- Name: TABLE importaciones_excel; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.importaciones_excel TO authenticated;


--
-- TOC entry 4242 (class 0 OID 0)
-- Dependencies: 241
-- Name: TABLE inventario_tiendas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.inventario_tiendas TO authenticated;


--
-- TOC entry 4244 (class 0 OID 0)
-- Dependencies: 243
-- Name: TABLE lotes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.lotes TO authenticated;


--
-- TOC entry 4246 (class 0 OID 0)
-- Dependencies: 245
-- Name: TABLE lotes_maestros; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.lotes_maestros TO authenticated;


--
-- TOC entry 4248 (class 0 OID 0)
-- Dependencies: 247
-- Name: TABLE notificaciones; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notificaciones TO authenticated;


--
-- TOC entry 4251 (class 0 OID 0)
-- Dependencies: 249
-- Name: TABLE pagos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pagos TO authenticated;


--
-- TOC entry 4253 (class 0 OID 0)
-- Dependencies: 251
-- Name: TABLE pedidos_borradores; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pedidos_borradores TO authenticated;


--
-- TOC entry 4255 (class 0 OID 0)
-- Dependencies: 253
-- Name: TABLE productos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.productos TO authenticated;


--
-- TOC entry 4257 (class 0 OID 0)
-- Dependencies: 255
-- Name: TABLE promociones_combos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.promociones_combos TO authenticated;


--
-- TOC entry 4259 (class 0 OID 0)
-- Dependencies: 257
-- Name: TABLE proveedores; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.proveedores TO authenticated;


--
-- TOC entry 4261 (class 0 OID 0)
-- Dependencies: 259
-- Name: TABLE recepciones_granel; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recepciones_granel TO authenticated;


--
-- TOC entry 4263 (class 0 OID 0)
-- Dependencies: 261
-- Name: TABLE sesiones_caja; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sesiones_caja TO authenticated;


--
-- TOC entry 4265 (class 0 OID 0)
-- Dependencies: 263
-- Name: TABLE tiendas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tiendas TO authenticated;


--
-- TOC entry 4267 (class 0 OID 0)
-- Dependencies: 265
-- Name: TABLE usuarios; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.usuarios TO authenticated;


--
-- TOC entry 4269 (class 0 OID 0)
-- Dependencies: 267
-- Name: TABLE ventas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ventas TO authenticated;


--
-- TOC entry 4270 (class 0 OID 0)
-- Dependencies: 268
-- Name: TABLE ventas_anuladas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ventas_anuladas TO authenticated;


-- Completed on 2026-07-21 02:24:45 -04

--
-- PostgreSQL database dump complete
--

\unrestrict yTfF3xYEFwiV1tNgSdVRkgLwh7KwmVEOEAEhcjbhVj7UGwpTqRxoUEdEUPjCwPZ

