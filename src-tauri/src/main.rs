#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use blog_format_tool_lib::{config, converter};
use blog_format_tool_lib::models::{AnalyzeRequest, ConvertRequest, ConfigEnvelope};

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<ConfigEnvelope, String> {
  config::load_or_default(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: blog_format_tool_lib::models::AppConfig) -> Result<ConfigEnvelope, String> {
  config::save(&app, config).map_err(|e| e.to_string())
}

#[tauri::command]
fn analyze_markdown(request: AnalyzeRequest) -> Result<blog_format_tool_lib::models::AnalyzeResult, String> {
  converter::analyze_file(&request.md_path, &request.output_type, &request.config).map_err(|e| e.to_string())
}

#[tauri::command]
fn convert_markdown(request: ConvertRequest) -> Result<blog_format_tool_lib::models::ConvertReport, String> {
  converter::convert_file(&request.md_path, &request.output_type, &request.config, &request.meta).map_err(|e| e.to_string())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      load_config,
      save_config,
      analyze_markdown,
      convert_markdown
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

