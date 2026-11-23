use std::path::PathBuf;

use anyhow::{bail, Context, Result};

use r4::app::typegen::{self, TypegenOptions};

/*
 * This binary links the app crate so the #[rpc] metadata comes from the same
 * router that the server uses. The CLI runs it through cargo for any app root
 * that ships src/bin/typegen.rs.
 */
#[allow(dead_code)]
#[path = "../app.rs"]
mod app;

fn main() -> Result<()> {
  let (check, root) = parse_args(std::env::args().skip(1))?;
  let root = root
    .canonicalize()
    .with_context(|| format!("failed to resolve the typegen root {}", root.display()))?;
  let options = TypegenOptions::new(root);
  let files = typegen::generate(&app::rpc_router(), &options)?;

  if check {
    typegen::check(&files, &options)?;
    println!("typegen check passed");

    return Ok(());
  }

  typegen::write(&files, &options)?;

  for file in files {
    println!("wrote {}", file.path.display());
  }

  Ok(())
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<(bool, PathBuf)> {
  let mut args = args;
  let mut check = false;
  let mut root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

  while let Some(arg) = args.next() {
    match arg.as_str() {
      "--check" => check = true,
      "--root" => {
        root = PathBuf::from(
          args
            .next()
            .context("--root requires a path to the application root")?,
        );
      }
      "--help" | "-h" => {
        print_help();
        std::process::exit(0);
      }
      _ => {
        if let Some(value) = arg.strip_prefix("--root=") {
          root = PathBuf::from(value);
        } else {
          bail!("unknown argument: {arg}");
        }
      }
    }
  }

  Ok((check, root))
}

fn print_help() {
  println!("Usage: typegen [--check] [--root DIR]");
  println!();
  println!("Writes .r4/rpc.ts and web/bindings/index.ts for the app.");
}
