use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
  #[error("{0}")]
  Message(String),
  #[error("IO error: {0}")]
  Io(#[from] std::io::Error),
  #[error("YAML error: {0}")]
  Yaml(#[from] serde_yaml::Error),
  #[error("TOML error: {0}")]
  TomlDe(#[from] toml::de::Error),
  #[error("TOML error: {0}")]
  TomlSer(#[from] toml::ser::Error),
}

pub type AppResult<T> = Result<T, AppError>;

