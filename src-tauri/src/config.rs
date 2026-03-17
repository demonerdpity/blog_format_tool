use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::models::{AppConfig, ConfigEnvelope};

pub fn config_file_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|e| AppError::Message(format!("无法获取配置目录：{e}")))?;
  Ok(dir.join("config.toml"))
}

pub fn load_or_default(app: &tauri::AppHandle) -> AppResult<ConfigEnvelope> {
  let path = config_file_path(app)?;
  let config = if path.exists() {
    let s = fs::read_to_string(&path)?;
    toml::from_str::<AppConfig>(&s)?
  } else {
    AppConfig::default()
  };
  Ok(ConfigEnvelope {
    config_path: path.to_string_lossy().to_string(),
    config,
  })
}

pub fn save(app: &tauri::AppHandle, config: AppConfig) -> AppResult<ConfigEnvelope> {
  let path = config_file_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let s = toml::to_string_pretty(&config)?;
  fs::write(&path, s)?;
  Ok(ConfigEnvelope {
    config_path: path.to_string_lossy().to_string(),
    config,
  })
}

