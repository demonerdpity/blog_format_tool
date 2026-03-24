use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputType {
  Blog,
  Essays,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageSubdirStrategy {
  Title,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CopyMode {
  Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileNameStrategy {
  Original,
  TitleSlug,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
  pub repo_root: String,
  pub blog_content_dir: String,
  pub essays_content_dir: String,
  pub images_dir: String,
  pub image_subdir_strategy: ImageSubdirStrategy,
  pub copy_mode: CopyMode,
  pub date_format: String,
  pub description_auto_length: usize,
  pub file_name_strategy: FileNameStrategy,
}

impl Default for AppConfig {
  fn default() -> Self {
    Self {
      repo_root: String::new(),
      blog_content_dir: "src/content/blog".to_string(),
      essays_content_dir: "src/content/essays".to_string(),
      images_dir: "public/images".to_string(),
      image_subdir_strategy: ImageSubdirStrategy::Title,
      copy_mode: CopyMode::Copy,
      date_format: "%Y-%m-%d".to_string(),
      description_auto_length: 80,
      file_name_strategy: FileNameStrategy::Original,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEnvelope {
  pub config_path: String,
  pub config: AppConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
  pub md_path: String,
  pub output_type: String,
  pub config: AppConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCounts {
  pub total: usize,
  pub local: usize,
  pub remote: usize,
  pub site: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResult {
  pub title: Option<String>,
  pub safe_title: Option<String>,
  pub image_counts: ImageCounts,
  pub output_markdown_path: Option<String>,
  pub output_exists: bool,
  pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetaWriteMode {
  Keep,
  Rewrite,
  Add,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaOptions {
  pub description_mode: MetaWriteMode,
  pub description: String,
  pub tags_mode: MetaWriteMode,
  pub tags: Vec<String>,
  pub hero_image_override: bool,
  pub hero_image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
  pub md_path: String,
  pub output_type: String,
  pub config: AppConfig,
  pub meta: MetaOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOp {
  pub source_path: String,
  pub final_path: String,
  pub final_site_path: String,
  pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertReport {
  pub output_markdown_path: String,
  pub images: Vec<ImageOp>,
  pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn app_config_uses_defaults_for_missing_fields() {
    let config: AppConfig = toml::from_str(
      r#"
repoRoot = "C:\\blog"
imagesDir = "assets/images"
"#,
    )
    .expect("config should deserialize");

    assert_eq!(config.repo_root, "C:\\blog");
    assert_eq!(config.blog_content_dir, "src/content/blog");
    assert_eq!(config.essays_content_dir, "src/content/essays");
    assert_eq!(config.images_dir, "assets/images");
    assert_eq!(config.date_format, "%Y-%m-%d");
    assert_eq!(config.description_auto_length, 80);
    assert!(matches!(config.file_name_strategy, FileNameStrategy::Original));
    assert!(matches!(config.image_subdir_strategy, ImageSubdirStrategy::Title));
    assert!(matches!(config.copy_mode, CopyMode::Copy));
  }
}
