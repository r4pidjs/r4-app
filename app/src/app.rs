use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};

use r4::app::routes::{routes, RoutesExt};
use r4::app::rpc::{rpc, RpcError, RpcRouter};
use r4::app::{
  app_with_state_and, islands_url, AppState, AssetServer, Cache, CspPolicy, Page, ROUTER_PATH,
};
use ts_rs::TS;

include!("generated/views.rs");

static STARTED_AT: OnceLock<Instant> = OnceLock::new();
static IMPORT_MAP: OnceLock<String> = OnceLock::new();

#[derive(Serialize)]
pub struct HomeProps {
  pub message: String,
}

#[derive(Serialize)]
pub struct AboutProps {}

#[derive(Serialize)]
pub struct NotFoundProps {
  pub path: String,
}

#[derive(Serialize)]
pub struct MainProps {
  pub dev: bool,
  #[serde(rename = "importMap")]
  pub import_map: String,
  pub router: String,
  pub islands: String,
  pub stylesheets: Vec<String>,
  pub title: String,
}

/* Prefer the crate directory during development. Containers have no source
 * tree at the build path, so fall back to the working directory copied into
 * the image. */
fn app_root() -> PathBuf {
  let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let candidates = [manifest, PathBuf::from(".")];

  for candidate in candidates {
    if candidate.join("web/pages").is_dir() && candidate.join("web/layouts").is_dir() {
      return candidate;
    }
  }

  PathBuf::from(".")
}

/* The import map compiles every asset under the app root, so build it once. */
fn shared_import_map(assets: &AssetServer) -> String {
  IMPORT_MAP
    .get_or_init(|| assets.import_map("/__assets"))
    .clone()
}

fn asset_server(state: &AppState) -> AssetServer {
  AssetServer::new(app_root()).with_dev(state.dev())
}

fn layout_props(state: &AppState, title: impl Into<String>) -> MainProps {
  let assets = asset_server(state);

  MainProps {
    dev: state.dev(),
    import_map: shared_import_map(&assets),
    router: ROUTER_PATH.to_owned(),
    islands: islands_url(&assets),
    stylesheets: assets.stylesheets("/__assets"),
    title: title.into(),
  }
}

async fn home(State(state): State<AppState>, uri: Uri) -> Response {
  Page::new(
    HomeProps {
      message: "Rendered by r4 on the Rust SSR runtime.".to_owned(),
    },
    layout_props(&state, "R4 + React"),
  )
  .cache(Cache {
    control: Some("public, max-age=120, stale-while-revalidate=300".to_owned()),
    ..Cache::default()
  })
  .send(&state, &uri)
  .await
}

async fn about(State(state): State<AppState>, uri: Uri) -> Response {
  Page::new(AboutProps {}, layout_props(&state, "About"))
    .cache(Cache {
      control: Some("public, max-age=600, stale-while-revalidate=300".to_owned()),
      ..Cache::default()
    })
    .send(&state, &uri)
    .await
}

/* React streaming: the V8 bundle renders a document with Suspense and emits
chunks through op_emit_chunk while Axum forwards them. */
async fn stream(State(state): State<AppState>, uri: Uri) -> Response {
  state.stream_page(&uri).await
}

/* Brand assets are embedded in the binary, so serving them never touches the
renderer. The SVGs under app/static are the source; scripts/brand.mjs renders
the raster icons from them. */
const FAVICON: &[u8] = include_bytes!("../static/favicon.ico");
const APPLE_TOUCH_ICON: &[u8] = include_bytes!("../static/apple-touch-icon.png");
const ICON_SVG: &[u8] = include_bytes!("../static/icon.svg");
const LOGO_SVG: &[u8] = include_bytes!("../static/logo.svg");

fn static_response(bytes: &'static [u8], content_type: &'static str) -> Response {
  Response::builder()
    .status(StatusCode::OK)
    .header(header::CONTENT_TYPE, content_type)
    .header(header::CACHE_CONTROL, "public, max-age=86400")
    .body(Body::from(bytes))
    .expect("valid static asset response")
}

async fn favicon() -> Response {
  static_response(FAVICON, "image/x-icon")
}

async fn apple_touch_icon() -> Response {
  static_response(APPLE_TOUCH_ICON, "image/png")
}

async fn icon_svg() -> Response {
  static_response(ICON_SVG, "image/svg+xml; charset=utf-8")
}

async fn logo_svg() -> Response {
  static_response(LOGO_SVG, "image/svg+xml; charset=utf-8")
}

async fn not_found(State(state): State<AppState>, uri: Uri) -> Response {
  Page::new(
    NotFoundProps {
      path: uri.path().to_owned(),
    },
    layout_props(&state, "Not found"),
  )
  .status(StatusCode::NOT_FOUND)
  .cache(Cache::no_store())
  .send(&state, &uri)
  .await
}

/* Native BFF routes. They run beside the SSR cell, share its state, and never
reach the renderer. */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
  status: &'static str,
  version: &'static str,
  uptime_seconds: u64,
  timestamp: u64,
}

async fn health() -> axum::Json<Health> {
  axum::Json(Health {
    status: "ok",
    version: env!("CARGO_PKG_VERSION"),
    uptime_seconds: STARTED_AT
      .get()
      .map(Instant::elapsed)
      .unwrap_or_default()
      .as_secs(),
    timestamp: unix_seconds(),
  })
}

#[derive(Serialize)]
struct RendererStats {
  renders: usize,
  recycles: usize,
  rejected: usize,
  respawns: usize,
}

#[derive(Serialize)]
struct CacheStats {
  hits: usize,
  misses: usize,
  stale: usize,
  refreshes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metrics {
  renderer: RendererStats,
  cache: CacheStats,
}

async fn metrics(State(state): State<AppState>) -> axum::Json<Metrics> {
  let renderer = state.renderer().metrics();
  let cache = state.cache().metrics();

  axum::Json(Metrics {
    renderer: RendererStats {
      renders: renderer.renders,
      recycles: renderer.recycles,
      rejected: renderer.rejected,
      respawns: renderer.respawns,
    },
    cache: CacheStats {
      hits: cache.hits,
      misses: cache.misses,
      stale: cache.stale,
      refreshes: cache.refreshes,
    },
  })
}

#[derive(Deserialize)]
struct HelloQuery {
  name: Option<String>,
}

async fn hello(Query(query): Query<HelloQuery>) -> String {
  match query
    .name
    .as_deref()
    .map(str::trim)
    .filter(|name| !name.is_empty())
  {
    Some(name) => format!("Hello, {name}, from native Axum"),
    None => "Hello from native Axum".to_owned(),
  }
}

#[derive(Deserialize)]
struct EchoRequest {
  message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EchoResponse {
  message: String,
  length: usize,
  received_at: u64,
}

#[derive(Serialize)]
struct ApiError {
  error: ApiErrorBody,
}

#[derive(Serialize)]
struct ApiErrorBody {
  code: &'static str,
  message: String,
}

async fn echo(
  axum::Json(request): axum::Json<EchoRequest>,
) -> Result<axum::Json<EchoResponse>, (StatusCode, axum::Json<ApiError>)> {
  let message = request.message.trim().to_owned();

  if message.is_empty() {
    return Err((
      StatusCode::UNPROCESSABLE_ENTITY,
      axum::Json(ApiError {
        error: ApiErrorBody {
          code: "empty_message",
          message: "message must not be empty".to_owned(),
        },
      }),
    ));
  }

  Ok(axum::Json(EchoResponse {
    length: message.chars().count(),
    message,
    received_at: unix_seconds(),
  }))
}

fn unix_seconds() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|elapsed| elapsed.as_secs())
    .unwrap_or_default()
}

/* Typed RPC: the macro also feeds typegen, which writes .r4/rpc.ts and the
web/bindings types used by the islands. */

#[derive(Deserialize, Serialize, TS)]
pub struct GreetInput {
  pub name: String,
}

#[derive(Deserialize, Serialize, TS)]
pub struct GreetOutput {
  pub message: String,
  pub timestamp: u64,
}

#[rpc("bff.greet")]
pub async fn greet(input: GreetInput) -> Result<GreetOutput, RpcError> {
  let name = input.name.trim();

  if name.is_empty() {
    return Err(RpcError::bad_request("name must not be empty"));
  }

  Ok(GreetOutput {
    message: format!("Hello, {name}, from typed RPC"),
    timestamp: unix_seconds(),
  })
}

pub fn rpc_router() -> RpcRouter {
  RpcRouter::new(vec![greet_route()])
}

pub fn router(state: AppState) -> Router {
  STARTED_AT.set(Instant::now()).ok();

  let dev = state.dev();
  let assets = AssetServer::new(app_root()).with_dev(dev);
  let routes = routes! {
    home: get("/", pages::Home, home),
    about: get("/about", pages::About, about),
  };
  let import_map = shared_import_map(&assets);
  let state = state
    .with_rpc(rpc_router())
    .with_route_manifest(routes.manifest())
    .with_csp(CspPolicy::new().with_script_hash(&import_map));

  app_with_state_and(state, move |router| {
    let import_assets = assets.clone();
    let file_assets = assets;

    router
      .route("/api/health", get(health))
      .route("/api/metrics", get(metrics))
      .route("/api/hello", get(hello))
      .route("/api/echo", post(echo))
      .route("/stream", get(stream))
      .route("/favicon.ico", get(favicon))
      .route("/apple-touch-icon.png", get(apple_touch_icon))
      .route("/apple-touch-icon-precomposed.png", get(apple_touch_icon))
      .route("/icon.svg", get(icon_svg))
      .route("/logo.svg", get(logo_svg))
      .route(
        "/__assets/import-map.json",
        get(move || {
          let assets = import_assets.clone();

          async move {
            Response::builder()
              .status(StatusCode::OK)
              .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
              .header(
                header::CACHE_CONTROL,
                if dev { "no-store" } else { "no-cache" },
              )
              .body(Body::from(shared_import_map(&assets)))
              .expect("valid import map response")
          }
        }),
      )
      .route(
        "/__assets/{*path}",
        get(move |Path(path): Path<String>, headers: HeaderMap| {
          let assets = file_assets.clone();

          async move { assets.fetch(&path, &headers) }
        }),
      )
      .routes(routes)
      .fallback(not_found)
  })
}
