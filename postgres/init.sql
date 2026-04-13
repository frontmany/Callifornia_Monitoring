-- Database name (monitoring)

-- =====================================================
-- Table 1: servers (Server list)
-- =====================================================
CREATE TABLE IF NOT EXISTS servers (
    id BIGSERIAL PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uk_servers_hostname UNIQUE (host)
);


-- =====================================================
-- Table 2: metrics (Metric kinds)
-- =====================================================
CREATE TABLE IF NOT EXISTS metrics (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    unit VARCHAR(20),
    
    CONSTRAINT uk_metrics_name UNIQUE (name)
);

COMMENT ON COLUMN metrics.unit IS 'Unit of measurement';


-- =====================================================
-- Table 3: metric_values (Metrics data)
-- =====================================================
CREATE TABLE IF NOT EXISTS metric_values (
    time TIMESTAMPTZ NOT NULL,
    server_id BIGINT NOT NULL,
    metric_id SMALLINT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    
    CONSTRAINT fk_metric_values_server FOREIGN KEY (server_id) 
        REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT fk_metric_values_metric FOREIGN KEY (metric_id) 
        REFERENCES metrics(id) ON DELETE RESTRICT
);


-- =====================================================
-- Table 4: reports (Report metadata)
-- =====================================================
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id BIGINT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    file_path TEXT,
    
    CONSTRAINT fk_reports_server FOREIGN KEY (server_id) 
        REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT chk_reports_period CHECK (period_start <= period_end),
    CONSTRAINT chk_reports_content CHECK (file_path IS NOT NULL)
);

INSERT INTO metrics (id, name, unit) VALUES
(1, 'cpu_usage', 'percent'),
(2, 'memory_used', 'bytes'),
(3, 'memory_available', 'bytes'),
(5, 'active_users', 'count');

INSERT INTO servers (host, port, is_active) VALUES
('80.93.63.213', '8081', true);

-- =====================================================
-- TimescaleDB: hypertable and compression
-- =====================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert metric_values table to hypertable
SELECT create_hypertable(
    'metric_values',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Compression for chunks older than 7 days
ALTER TABLE metric_values SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'server_id, metric_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('metric_values', INTERVAL '7 days');

-- Enable old data retention
SELECT add_retention_policy('metric_values', INTERVAL '90 days');