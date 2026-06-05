use std::{
    collections::{BTreeMap, HashSet},
    env, fs,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use etl::{
    config::{
        BatchConfig, InvalidatedSlotBehavior, MemoryBackpressureConfig, PgConnectionConfig,
        PipelineConfig, TableSyncCopyConfig, TcpKeepaliveConfig, TlsConfig,
    },
    destination::{Destination, DropTableForCopyResult, WriteEventsResult, WriteTableRowsResult},
    error::{ErrorKind, EtlResult},
    pipeline::Pipeline,
    store::MemoryStore,
    types::{
        ArrayCell, Cell, ColumnSchema, Event, OldTableRow, PartialTableRow, PgNumeric,
        ReplicatedTableSchema, TableName, TableRow, UpdatedTableRow,
    },
};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::{Client, StatusCode};
use serde_json::{json, Map, Value};

#[derive(Clone)]
struct RawTreeDestination {
    client: Client,
    api_url: String,
    api_key: String,
}

impl RawTreeDestination {
    fn new(api_url: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_url,
            api_key,
        }
    }

    async fn send_rows(&self, table: &str, rows: Vec<Value>) -> EtlResult<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let encoded_table = utf8_percent_encode(table, NON_ALPHANUMERIC);
        let url = format!(
            "{}/v1/tables/{}",
            self.api_url.trim_end_matches('/'),
            encoded_table
        );
        let response = self
            .client
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&rows)
            .send()
            .await
            .map_err(|err| {
                etl::etl_error!(
                    ErrorKind::DestinationConnectionFailed,
                    "RawTree request failed",
                    err.to_string()
                )
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| "".to_owned());
            return Err(etl::etl_error!(
                ErrorKind::DestinationQueryFailed,
                "RawTree ingest failed",
                format!("status={status} body={body}")
            ));
        }

        Ok(())
    }

    async fn delete_table(&self, table: &str) -> EtlResult<()> {
        let encoded_table = utf8_percent_encode(table, NON_ALPHANUMERIC);
        let url = format!(
            "{}/v1/tables/{}",
            self.api_url.trim_end_matches('/'),
            encoded_table
        );
        let response = self
            .client
            .delete(url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|err| {
                etl::etl_error!(
                    ErrorKind::DestinationConnectionFailed,
                    "RawTree request failed",
                    err.to_string()
                )
            })?;

        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            return Ok(());
        }

        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "".to_owned());
        Err(etl::etl_error!(
            ErrorKind::DestinationQueryFailed,
            "RawTree table delete failed",
            format!("status={status} body={body}")
        ))
    }
}

impl Destination for RawTreeDestination {
    fn name() -> &'static str {
        "rawtree"
    }

    async fn drop_table_for_copy(
        &self,
        replicated_table_schema: &ReplicatedTableSchema,
        async_result: DropTableForCopyResult<()>,
    ) -> EtlResult<()> {
        let table = rawtree_table_name(replicated_table_schema.name());
        let result = self.delete_table(&table).await;
        async_result.send(result.clone());
        result
    }

    async fn write_table_rows(
        &self,
        replicated_table_schema: &ReplicatedTableSchema,
        table_rows: Vec<TableRow>,
        async_result: WriteTableRowsResult<()>,
    ) -> EtlResult<()> {
        let rows = table_rows
            .iter()
            .map(|row| {
                let mut value = row_json(replicated_table_schema.column_schemas(), row);
                add_table_metadata(&mut value, "copy", replicated_table_schema);
                add_lsn_metadata(
                    &mut value,
                    etl::types::PgLsn::from(0),
                    etl::types::PgLsn::from(0),
                    0,
                );
                Value::Object(value)
            })
            .collect();

        let table = rawtree_table_name(replicated_table_schema.name());
        let result = self.send_rows(&table, rows).await;
        async_result.send(result.clone());
        result
    }

    async fn write_events(
        &self,
        events: Vec<Event>,
        async_result: WriteEventsResult<()>,
    ) -> EtlResult<()> {
        let mut rows_by_table = BTreeMap::<String, Vec<Value>>::new();

        for event in events {
            for (table, row) in table_event_rows(&event)? {
                rows_by_table.entry(table).or_default().push(row);
            }
        }

        let mut result = Ok(());
        for (table, rows) in rows_by_table {
            if let Err(err) = self.send_rows(&table, rows).await {
                result = Err(err);
                break;
            }
        }

        async_result.send(result.clone());
        result
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();

    // The ETL dependency graph enables multiple Rustls backends, so choose one.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    tracing_subscriber::fmt::init();

    let pg_connection = pg_connection_config()?;

    let config = PipelineConfig {
        id: env_u64("PIPELINE_ID", 1)?,
        publication_name: env_or("POSTGRES_PUBLICATION", "rawtree_publication"),
        pg_connection,
        store_pg_connection: None,
        batch: BatchConfig::default(),
        table_error_retry_delay_ms: PipelineConfig::DEFAULT_TABLE_ERROR_RETRY_DELAY_MS,
        table_error_retry_max_attempts: PipelineConfig::DEFAULT_TABLE_ERROR_RETRY_MAX_ATTEMPTS,
        max_table_sync_workers: PipelineConfig::DEFAULT_MAX_TABLE_SYNC_WORKERS,
        max_copy_connections_per_table: 1,
        memory_refresh_interval_ms: PipelineConfig::DEFAULT_MEMORY_REFRESH_INTERVAL_MS,
        memory_backpressure: Some(MemoryBackpressureConfig::default()),
        table_sync_copy: TableSyncCopyConfig::IncludeAllTables,
        invalidated_slot_behavior: InvalidatedSlotBehavior::Error,
    };

    let destination = RawTreeDestination::new(
        env_or("RAWTREE_API_URL", "https://api.rawtree.com"),
        required_env("RAWTREE_API_KEY")?,
    );

    let mut pipeline = Pipeline::new(config, MemoryStore::new(), destination);
    pipeline.start().await?;
    pipeline.wait().await?;

    Ok(())
}

fn table_event_rows(event: &Event) -> EtlResult<Vec<(String, Value)>> {
    match event {
        Event::Insert(event) => {
            let mut value = row_json(
                event.replicated_table_schema.column_schemas(),
                &event.table_row,
            );
            add_table_metadata(&mut value, "insert", &event.replicated_table_schema);
            add_lsn_metadata(
                &mut value,
                event.start_lsn,
                event.commit_lsn,
                event.tx_ordinal,
            );
            Ok(vec![(
                rawtree_table_name(event.replicated_table_schema.name()),
                Value::Object(value),
            )])
        }
        Event::Update(event) => {
            let mut value = match &event.updated_table_row {
                UpdatedTableRow::Full(row) => {
                    row_json(event.replicated_table_schema.column_schemas(), row)
                }
                UpdatedTableRow::Partial(row) => {
                    partial_row_json(&event.replicated_table_schema, row)
                }
            };
            add_table_metadata(&mut value, "update", &event.replicated_table_schema);
            add_lsn_metadata(
                &mut value,
                event.start_lsn,
                event.commit_lsn,
                event.tx_ordinal,
            );
            if let Some(old_row) = &event.old_table_row {
                value.insert(
                    "_etl_old".to_owned(),
                    Value::Object(old_row_json(&event.replicated_table_schema, old_row)),
                );
            }
            Ok(vec![(
                rawtree_table_name(event.replicated_table_schema.name()),
                Value::Object(value),
            )])
        }
        Event::Delete(event) => {
            let mut value = event
                .old_table_row
                .as_ref()
                .map(|old_row| old_row_json(&event.replicated_table_schema, old_row))
                .unwrap_or_default();
            add_table_metadata(&mut value, "delete", &event.replicated_table_schema);
            add_lsn_metadata(
                &mut value,
                event.start_lsn,
                event.commit_lsn,
                event.tx_ordinal,
            );
            Ok(vec![(
                rawtree_table_name(event.replicated_table_schema.name()),
                Value::Object(value),
            )])
        }
        Event::Truncate(event) => event
            .truncated_tables
            .iter()
            .map(|table| {
                let mut value = Map::new();
                value.insert("_etl_op".to_owned(), Value::String("truncate".to_owned()));
                value.insert(
                    "_etl_start_lsn".to_owned(),
                    Value::String(event.start_lsn.to_string()),
                );
                value.insert(
                    "_etl_commit_lsn".to_owned(),
                    Value::String(event.commit_lsn.to_string()),
                );
                value.insert(
                    "_etl_tx_ordinal".to_owned(),
                    Value::Number(event.tx_ordinal.into()),
                );
                value.insert("_etl_options".to_owned(), json!(event.options));
                value.insert(
                    "_etl_schema".to_owned(),
                    Value::String(table.name().schema.clone()),
                );
                value.insert(
                    "_etl_table".to_owned(),
                    Value::String(table.name().name.clone()),
                );
                value.insert(
                    "_etl_table_id".to_owned(),
                    Value::Number(table.id().into_inner().into()),
                );
                Ok((rawtree_table_name(table.name()), Value::Object(value)))
            })
            .collect(),
        _ => Ok(Vec::new()),
    }
}

fn rawtree_table_name(table_name: &TableName) -> String {
    let escaped_schema = table_name.schema.replace('_', "__");
    let escaped_table = table_name.name.replace('_', "__");

    format!("{escaped_schema}_{escaped_table}")
}

fn add_table_metadata(
    value: &mut Map<String, Value>,
    op: &str,
    replicated_table_schema: &ReplicatedTableSchema,
) {
    value.insert("_etl_op".to_owned(), Value::String(op.to_owned()));
    value.insert(
        "_etl_schema".to_owned(),
        Value::String(replicated_table_schema.name().schema.clone()),
    );
    value.insert(
        "_etl_table".to_owned(),
        Value::String(replicated_table_schema.name().name.clone()),
    );
    value.insert(
        "_etl_table_id".to_owned(),
        Value::Number(replicated_table_schema.id().into_inner().into()),
    );
}

fn add_lsn_metadata(
    value: &mut Map<String, Value>,
    start_lsn: etl::types::PgLsn,
    commit_lsn: etl::types::PgLsn,
    tx_ordinal: u64,
) {
    value.insert(
        "_etl_start_lsn".to_owned(),
        Value::String(start_lsn.to_string()),
    );
    value.insert(
        "_etl_commit_lsn".to_owned(),
        Value::String(commit_lsn.to_string()),
    );
    value.insert(
        "_etl_tx_ordinal".to_owned(),
        Value::Number(tx_ordinal.into()),
    );
}

fn row_json<'a>(
    columns: impl IntoIterator<Item = &'a ColumnSchema>,
    row: &TableRow,
) -> Map<String, Value> {
    columns
        .into_iter()
        .zip(row.values())
        .map(|(column, cell)| (column.name.clone(), cell_json(cell)))
        .collect()
}

fn partial_row_json(
    replicated_table_schema: &ReplicatedTableSchema,
    row: &PartialTableRow,
) -> Map<String, Value> {
    let missing = row
        .missing_column_indexes()
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    let columns = replicated_table_schema
        .column_schemas()
        .enumerate()
        .filter_map(|(index, column)| (!missing.contains(&index)).then_some(column));

    row_json(columns, row.table_row())
}

fn old_row_json(
    replicated_table_schema: &ReplicatedTableSchema,
    old_row: &OldTableRow,
) -> Map<String, Value> {
    match old_row {
        OldTableRow::Full(row) => row_json(replicated_table_schema.column_schemas(), row),
        OldTableRow::Key(row) => row_json(replicated_table_schema.identity_column_schemas(), row),
    }
}

fn cell_json(cell: &Cell) -> Value {
    match cell {
        Cell::Null => Value::Null,
        Cell::Bool(value) => Value::Bool(*value),
        Cell::String(value) => Value::String(value.clone()),
        Cell::I16(value) => Value::Number((*value).into()),
        Cell::I32(value) => Value::Number((*value).into()),
        Cell::U32(value) => Value::Number((*value).into()),
        Cell::I64(value) => Value::Number((*value).into()),
        Cell::F32(value) => float_json((*value).into()),
        Cell::F64(value) => float_json(*value),
        Cell::Numeric(value) => numeric_json(value),
        Cell::Date(value) => Value::String(value.to_string()),
        Cell::Time(value) => Value::String(value.to_string()),
        Cell::Timestamp(value) => Value::String(value.to_string()),
        Cell::TimestampTz(value) => Value::String(value.to_rfc3339()),
        Cell::Uuid(value) => Value::String(value.to_string()),
        Cell::Json(value) => value.clone(),
        Cell::Bytes(value) => Value::String(BASE64.encode(value)),
        Cell::Array(value) => array_json(value),
    }
}

fn array_json(array: &ArrayCell) -> Value {
    match array {
        ArrayCell::Bool(values) => optional_array_json(values, |value| Value::Bool(*value)),
        ArrayCell::String(values) => {
            optional_array_json(values, |value| Value::String(value.clone()))
        }
        ArrayCell::I16(values) => {
            optional_array_json(values, |value| Value::Number((*value).into()))
        }
        ArrayCell::I32(values) => {
            optional_array_json(values, |value| Value::Number((*value).into()))
        }
        ArrayCell::U32(values) => {
            optional_array_json(values, |value| Value::Number((*value).into()))
        }
        ArrayCell::I64(values) => {
            optional_array_json(values, |value| Value::Number((*value).into()))
        }
        ArrayCell::F32(values) => optional_array_json(values, |value| float_json((*value).into())),
        ArrayCell::F64(values) => optional_array_json(values, |value| float_json(*value)),
        ArrayCell::Numeric(values) => optional_array_json(values, numeric_json),
        ArrayCell::Date(values) => {
            optional_array_json(values, |value| Value::String(value.to_string()))
        }
        ArrayCell::Time(values) => {
            optional_array_json(values, |value| Value::String(value.to_string()))
        }
        ArrayCell::Timestamp(values) => {
            optional_array_json(values, |value| Value::String(value.to_string()))
        }
        ArrayCell::TimestampTz(values) => {
            optional_array_json(values, |value| Value::String(value.to_rfc3339()))
        }
        ArrayCell::Uuid(values) => {
            optional_array_json(values, |value| Value::String(value.to_string()))
        }
        ArrayCell::Json(values) => optional_array_json(values, Clone::clone),
        ArrayCell::Bytes(values) => {
            optional_array_json(values, |value| Value::String(BASE64.encode(value)))
        }
    }
}

fn optional_array_json<T>(values: &[Option<T>], convert: impl Fn(&T) -> Value) -> Value {
    Value::Array(
        values
            .iter()
            .map(|value| value.as_ref().map_or(Value::Null, &convert))
            .collect(),
    )
}

fn numeric_json(value: &PgNumeric) -> Value {
    Value::String(value.to_string())
}

fn float_json(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map_or_else(|| Value::String(value.to_string()), Value::Number)
}

fn required_env(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    env::var(name).map_err(|_| format!("missing required env var {name}").into())
}

fn pg_connection_config() -> Result<PgConnectionConfig, Box<dyn std::error::Error>> {
    if let Ok(database_url) = env::var("DATABASE_URL") {
        if !database_url.is_empty() {
            return pg_connection_config_from_url(&database_url);
        }
    }

    Ok(PgConnectionConfig {
        host: required_env("POSTGRES_HOST")?,
        hostaddr: None,
        port: env_u16("POSTGRES_PORT", 5432)?,
        name: env_or("POSTGRES_DATABASE", "postgres"),
        username: env_or("POSTGRES_USER", "postgres"),
        password: Some(required_env("POSTGRES_PASSWORD")?.into()),
        tls: TlsConfig {
            enabled: env_bool("POSTGRES_TLS", true)?,
            trusted_root_certs: trusted_root_certs()?,
        },
        keepalive: TcpKeepaliveConfig::default(),
    })
}

fn pg_connection_config_from_url(
    database_url: &str,
) -> Result<PgConnectionConfig, Box<dyn std::error::Error>> {
    let url = url::Url::parse(database_url)?;
    let sslmode = url
        .query_pairs()
        .find_map(|(key, value)| (key == "sslmode").then_some(value.into_owned()));

    Ok(PgConnectionConfig {
        host: url
            .host_str()
            .ok_or("DATABASE_URL must include a host")?
            .to_owned(),
        hostaddr: None,
        port: url.port().unwrap_or(5432),
        name: url.path().trim_start_matches('/').to_owned(),
        username: decode_url_part(url.username())?,
        password: url
            .password()
            .map(decode_url_part)
            .transpose()?
            .map(Into::into),
        tls: TlsConfig {
            enabled: !matches!(sslmode.as_deref(), Some("disable")),
            trusted_root_certs: trusted_root_certs()?,
        },
        keepalive: TcpKeepaliveConfig::default(),
    })
}

fn trusted_root_certs() -> Result<String, Box<dyn std::error::Error>> {
    if let Ok(certs) = env::var("POSTGRES_TLS_ROOT_CERTS") {
        if !certs.is_empty() {
            return Ok(certs);
        }
    }

    if let Ok(path) = env::var("POSTGRES_TLS_ROOT_CERT_PATH") {
        if !path.is_empty() {
            return Ok(fs::read_to_string(path)?);
        }
    }

    for path in [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/cert.pem",
    ] {
        if let Ok(certs) = fs::read_to_string(path) {
            return Ok(certs);
        }
    }

    Ok(String::new())
}

fn decode_url_part(value: &str) -> Result<String, Box<dyn std::error::Error>> {
    Ok(percent_encoding::percent_decode_str(value)
        .decode_utf8()?
        .into_owned())
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_owned())
}

fn env_u16(name: &str, default: u16) -> Result<u16, Box<dyn std::error::Error>> {
    env::var(name).map_or(Ok(default), |value| Ok(value.parse()?))
}

fn env_u64(name: &str, default: u64) -> Result<u64, Box<dyn std::error::Error>> {
    env::var(name).map_or(Ok(default), |value| Ok(value.parse()?))
}

fn env_bool(name: &str, default: bool) -> Result<bool, Box<dyn std::error::Error>> {
    env::var(name).map_or(Ok(default), |value| Ok(value.parse()?))
}
