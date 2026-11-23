use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::sync::broadcast;

use r4::app::{AppState, AssetManifest, AssetStore, RebuildConfig};
use r4::renderer::Renderer;
use r4::v8_renderer::{available_workers, V8Renderer, V8RendererOptions};

#[path = "../app.rs"]
mod app;

fn path_from_env(name: &str, fallback: PathBuf) -> PathBuf {
  std::env::var_os(name)
    .map(PathBuf::from)
    .unwrap_or(fallback)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
  let root = std::env::current_dir()?;
  let bundle_path = path_from_env("R4_BUNDLE_PATH", root.join("bundle.js"));
  let assets_dir = path_from_env("R4_ASSET_DIR", root.join("web/assets"));
  let manifest_path = path_from_env("R4_ASSET_MANIFEST", assets_dir.join("manifest.json"));
  let bundle = std::fs::read_to_string(&bundle_path)?;
  let manifest_source = std::fs::read_to_string(&manifest_path)?;
  let manifest: AssetManifest = serde_json::from_str(&manifest_source)?;
  let dev = std::env::var("R4_DEV").ok().as_deref() == Some("1");
  let workers = std::env::var("R4_RENDER_WORKERS")
    .ok()
    .and_then(|value| value.parse::<usize>().ok())
    .filter(|value| *value > 0)
    .unwrap_or_else(available_workers);
  let renderer: Arc<dyn Renderer> = Arc::new(
    V8Renderer::with_options(
      bundle,
      V8RendererOptions {
        queue_capacity: 64,
        recycle_after: 1000,
        request_handler: true,
        workers,
      },
    )?
    .with_stream_handler(),
  );
  let assets = AssetStore::new(assets_dir.clone(), manifest, dev);
  let rebuild = RebuildConfig {
    build_args: vec![root.join("web/build.mjs").to_string_lossy().into_owned()],
    build_command: "node".to_owned(),
    bundle_path: bundle_path.clone(),
    manifest_path,
  };
  let mut state = AppState::with_options(renderer, assets, dev, rebuild);

  if dev {
    let (sender, _) = broadcast::channel(16);

    /* The CLI supervisor rebuilds Rust and the web bundle, then posts to
     * /__r4/reload; this channel is the browser-facing dev stream. */
    state = state.with_events(sender);
  }

  let port = std::env::var("PORT")
    .ok()
    .and_then(|value| value.parse::<u16>().ok())
    .unwrap_or(3002);
  let address = SocketAddr::from(([127, 0, 0, 1], port));
  let listener = TcpListener::bind(address).await?;

  println!("r4 app listening on http://{address}");

  axum::serve(listener, app::router(state)).await?;

  Ok(())
}
