//! Coordinator HTTP server entry point.
//!
//! Boot order matters: the auth token is validated BEFORE the database is
//! touched or a listener is bound, so a misconfigured deployment fails
//! immediately and loudly rather than serving requests with no auth
//! (plan §Task 8: "the server REFUSES to start", ADR-002 fail-closed).

#[derive(Debug, thiserror::Error)]
enum MainError {
    #[error("COORD_DATABASE_URL must be set: {0}")]
    MissingDatabaseUrl(#[source] std::env::VarError),
    #[error(transparent)]
    Boot(#[from] vingilot_coordinator::http::HttpBootError),
    #[error(transparent)]
    Store(#[from] vingilot_coordinator::store::StoreError),
    #[error("failed to bind {addr}: {source}")]
    Bind {
        addr: String,
        #[source]
        source: std::io::Error,
    },
    #[error("server error: {0}")]
    Serve(#[source] std::io::Error),
}

#[tokio::main]
async fn main() -> Result<(), MainError> {
    tracing_subscriber::fmt::init();

    // Fail-closed: refuse to start before anything else happens.
    let auth_token = vingilot_coordinator::http::auth_token_from_env()?;

    let db_url = std::env::var("COORD_DATABASE_URL").map_err(MainError::MissingDatabaseUrl)?;
    let pool = vingilot_coordinator::store::connect(&db_url).await?;
    vingilot_coordinator::store::migrate(&pool).await?;

    // Wall-clock enforcement only happens if this loop is running — the HTTP
    // side of the server never pauses a Run on its own (ADR-002 §Reconciliation,
    // reconcile.rs). Detached rather than joined: `main` returns only through
    // `axum::serve`'s error path or process exit, at which point the whole
    // process (and this task with it) goes down anyway.
    tokio::spawn(vingilot_coordinator::reconcile::run_reconciler(
        pool.clone(),
        std::time::Duration::from_secs(5),
    ));

    let app = vingilot_coordinator::http::router(pool, auth_token);

    let addr = std::env::var("COORD_HTTP_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|source| MainError::Bind {
            addr: addr.clone(),
            source,
        })?;

    tracing::info!("coordinator listening on {addr}");
    axum::serve(listener, app).await.map_err(MainError::Serve)?;

    Ok(())
}
