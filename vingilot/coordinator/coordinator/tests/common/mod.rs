pub async fn test_pool() -> Option<sqlx::PgPool> {
    let url = match std::env::var("COORD_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("SKIP: COORD_DATABASE_URL not set");
            return None;
        }
    };
    let pool = vingilot_coordinator::store::connect(&url).await.ok()?;
    vingilot_coordinator::store::migrate(&pool).await.ok()?;
    Some(pool)
}
